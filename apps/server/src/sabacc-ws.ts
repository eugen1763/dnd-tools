// WebSocket layer for Sabacc — the live, synced, server-authoritative gameplay.
//
// Mounted as its own Elysia plugin at /ws/sabacc/:gameId (Wordle's /ws/:gameId
// handler is Wordle-specific and untouched). Unlike Wordle — where every client
// shares one board — Sabacc players have identity and PRIVATE hole cards, so:
//   * each socket is associated with a seated player (or a spectator),
//   * state is serialized PER RECIPIENT (`serializeFor`) so you only ever see
//     your own cards until showdown,
//   * the secret reconnect token is sent only in the 1:1 join/reconnect reply.

import { Elysia } from 'elysia';
import {
  addPlayer,
  getGame,
  reassignHostIfNeeded,
  reclaimSeat,
  removePlayer,
  setConnected,
} from './sabacc-store';
import {
  applyBetAction,
  applyCardAction,
  legalActions,
  startHand,
  SabaccError,
  type BetActionKind,
  type CardActionKind,
  type SabaccGame,
  type ServerEvent,
} from './sabacc-engine';

interface SabaccClient {
  raw: any; // underlying WebSocket (has .send / .readyState)
  playerId: string | null;
  gameId: string;
}

const clientsByGame = new Map<string, Set<SabaccClient>>();
const clientByRaw = new WeakMap<object, SabaccClient>();

/**
 * Whether a table currently has any OPEN WebSocket connection (seated player or
 * spectator). The idle sweep consults this so a game is never deleted while a
 * socket is still attached.
 */
export function hasActiveClients(gameId: string): boolean {
  const clients = clientsByGame.get(gameId);
  if (!clients) return false;
  for (const c of clients) {
    if (c.raw && c.raw.readyState === 1 /* OPEN */) return true;
  }
  return false;
}

function send(raw: any, obj: unknown): void {
  try {
    if (raw && raw.readyState === 1 /* OPEN */) raw.send(JSON.stringify(obj));
  } catch {
    /* socket went away mid-send */
  }
}

function handInProgress(game: SabaccGame): boolean {
  return game.phase === 'card' || game.phase === 'betting' || game.phase === 'dice';
}

// --- per-recipient state serialization -------------------------------------

function serializeFor(game: SabaccGame, viewerId: string | null) {
  const revealAll = game.phase === 'showdown';
  return {
    id: game.id,
    phase: game.phase,
    round: game.round,
    handNumber: game.handNumber,
    pots: game.pots,
    dice: game.dice,
    actorId: game.actorId,
    dealerSeatIndex: game.dealerSeatIndex,
    hostId: game.hostId,
    config: game.config,
    betting: game.betting
      ? { currentBet: game.betting.currentBet, minRaise: game.betting.minRaise, tableCap: game.betting.tableCap }
      : null,
    players: [...game.players]
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map((p) => ({
        id: p.id,
        name: p.name,
        seatIndex: p.seatIndex,
        credits: p.credits,
        status: p.status,
        connected: p.connected,
        isHost: p.isHost,
        currentBet: p.currentBet,
        committedThisHand: p.committedThisHand,
        stood: p.stood,
        handCount: p.hand.length,
        // Cards are private: only your own, until showdown reveals everyone.
        hand: p.id === viewerId || revealAll ? p.hand : undefined,
      })),
    you: viewerId ? { playerId: viewerId, legalActions: legalActions(game, viewerId) } : null,
    lastWinnerIds: game.lastWinnerIds,
    lastWinDescription: game.lastWinDescription,
  };
}

function broadcastState(gameId: string): void {
  const game = getGame(gameId);
  const clients = clientsByGame.get(gameId);
  if (!game || !clients) return;
  for (const client of clients) {
    send(client.raw, { type: 'state', state: serializeFor(game, client.playerId) });
  }
}

// Strip card data from engine events before broadcasting; the per-recipient
// state snapshot is the only place cards are exposed (filtered). Showdown
// reveals are public, so they pass through.
function toWire(e: ServerEvent): unknown | null {
  switch (e.type) {
    case 'dealt':
      return { type: 'dealt', counts: e.counts };
    case 'sabacc_shift':
      return { type: 'sabacc_shift', affectedPlayerIds: e.affectedPlayerIds, counts: e.counts };
    case 'hand_started':
    case 'card_action_result':
    case 'bet_action_result':
    case 'delta':
    case 'dice_rolled':
    case 'showdown':
      return e;
    default:
      return null;
  }
}

function broadcastEvents(gameId: string, events: ServerEvent[]): void {
  const clients = clientsByGame.get(gameId);
  if (!clients) return;
  for (const e of events) {
    const wire = toWire(e);
    if (!wire) continue;
    for (const client of clients) send(client.raw, wire);
  }
}

/** Run engine events out to clients, then re-broadcast the authoritative state. */
function dispatch(gameId: string, events: ServerEvent[]): void {
  broadcastEvents(gameId, events);
  broadcastState(gameId);
}

// If the player on turn is disconnected, auto-act so the table never stalls.
// Stand in the card phase; check if free, else fold in the betting phase. Loops
// in case the next actor is also gone.
function autoActDisconnected(game: SabaccGame): ServerEvent[] {
  const out: ServerEvent[] = [];
  let guard = 0;
  while (guard++ < 64 && handInProgress(game) && game.actorId) {
    const actor = game.players.find((p) => p.id === game.actorId);
    if (!actor || actor.connected) break;
    try {
      if (game.phase === 'card') {
        out.push(...applyCardAction(game, actor.id, 'stand', undefined));
      } else if (game.phase === 'betting') {
        const opts = legalActions(game, actor.id);
        const toCall = opts.toCall ?? 0;
        out.push(...applyBetAction(game, actor.id, toCall > 0 ? 'fold' : 'check', undefined));
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return out;
}

// --- the route -------------------------------------------------------------

export const sabaccWs = new Elysia().ws('/ws/sabacc/:gameId', {
  open(ws) {
    const { gameId } = ws.data.params as { gameId: string };
    const game = getGame(gameId);
    if (!game) {
      send(ws.raw, { type: 'error', code: 'no_game', message: 'Table not found' });
      ws.close();
      return;
    }
    const client: SabaccClient = { raw: ws.raw, playerId: null, gameId };
    if (!clientsByGame.has(gameId)) clientsByGame.set(gameId, new Set());
    clientsByGame.get(gameId)!.add(client);
    clientByRaw.set(ws.raw, client);

    // Spectator view until they join or reconnect.
    send(ws.raw, { type: 'state', state: serializeFor(game, null) });
  },

  message(ws, raw) {
    const { gameId } = ws.data.params as { gameId: string };
    const game = getGame(gameId);
    const client = clientByRaw.get(ws.raw);
    if (!game || !client) return;

    const msg = (typeof raw === 'string' ? safeParse(raw) : raw) as { type?: string; [k: string]: any };
    if (!msg || typeof msg.type !== 'string') return;

    try {
      switch (msg.type) {
        case 'join': {
          const res = addPlayer(gameId, String(msg.name ?? ''), Number(msg.credits));
          if (res.error || !res.player) {
            send(ws.raw, { type: 'error', code: 'join_failed', message: res.error ?? 'Could not join' });
            return;
          }
          client.playerId = res.player.id;
          send(ws.raw, {
            type: 'joined',
            you: { playerId: res.player.id, token: res.token, seatIndex: res.player.seatIndex },
            state: serializeFor(game, res.player.id),
          });
          broadcastState(gameId);
          break;
        }

        case 'reconnect': {
          const player = reclaimSeat(gameId, String(msg.playerToken ?? ''));
          if (!player) {
            send(ws.raw, { type: 'error', code: 'reconnect_failed', message: 'Could not reclaim seat' });
            return;
          }
          client.playerId = player.id;
          send(ws.raw, {
            type: 'joined',
            you: { playerId: player.id, token: player.token, seatIndex: player.seatIndex },
            state: serializeFor(game, player.id),
          });
          broadcastState(gameId);
          break;
        }

        case 'start_hand': {
          if (!client.playerId || game.hostId !== client.playerId) {
            send(ws.raw, { type: 'error', code: 'not_host', message: 'Only the host can start a hand.' });
            return;
          }
          const events = startHand(game);
          dispatch(gameId, events);
          break;
        }

        case 'card_action': {
          if (!client.playerId) return;
          const events = applyCardAction(
            game,
            client.playerId,
            msg.action as CardActionKind,
            msg.cardId as string | undefined,
          );
          dispatch(gameId, events);
          break;
        }

        case 'bet_action': {
          if (!client.playerId) return;
          const events = applyBetAction(
            game,
            client.playerId,
            msg.action as BetActionKind,
            msg.amount !== undefined ? Number(msg.amount) : undefined,
          );
          dispatch(gameId, events);
          break;
        }

        case 'leave': {
          if (client.playerId) {
            removePlayer(gameId, client.playerId);
            client.playerId = null;
            broadcastState(gameId);
          }
          break;
        }
      }
    } catch (err) {
      if (err instanceof SabaccError) {
        send(ws.raw, { type: 'error', code: err.code, message: err.message });
      } else {
        console.error('Sabacc WS error:', err);
        send(ws.raw, { type: 'error', code: 'internal', message: 'Something went wrong.' });
      }
    }
  },

  close(ws) {
    const { gameId } = ws.data.params as { gameId: string };
    const client = clientByRaw.get(ws.raw);
    const clients = clientsByGame.get(gameId);
    if (clients && client) clients.delete(client);
    clientByRaw.delete(ws.raw);

    const game = getGame(gameId);
    if (game && client?.playerId) {
      setConnected(gameId, client.playerId, false);
      reassignHostIfNeeded(game);
      // Keep the table moving if the disconnected player was on turn.
      const events = autoActDisconnected(game);
      dispatch(gameId, events);
    }

    if (clients && clients.size === 0) {
      clientsByGame.delete(gameId);
      // The last player left; setConnected(false) above stamped the idle clock.
      // Actual deletion happens on the periodic sweep (index.ts) after the
      // grace window, so a quick reconnect keeps the table.
    }
  },
});

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
