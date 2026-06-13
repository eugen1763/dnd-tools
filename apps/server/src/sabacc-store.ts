// In-memory store for Corellian Spike Sabacc games — mirrors store.ts (Wordle).
//
// This module owns game identity and, critically, is the ONLY place reconnect
// tokens are generated and held. The engine (sabacc-engine.ts) never sees tokens
// or sockets; it only mutates the rules-relevant fields of a SabaccGame.

import { nanoid } from 'nanoid';
import { DEFAULT_CONFIG, type Player, type SabaccConfig, type SabaccGame } from './sabacc-engine';

const games = new Map<string, SabaccGame>();

export function createGame(config?: Partial<SabaccConfig>): { id: string; url: string } {
  const id = nanoid(10);
  // Coalesce each field so an explicit `undefined` from the caller can't clobber
  // a default (which would otherwise produce NaN in ante/pot math).
  const merged: SabaccConfig = {
    anteMain: config?.anteMain ?? DEFAULT_CONFIG.anteMain,
    anteSabacc: config?.anteSabacc ?? DEFAULT_CONFIG.anteSabacc,
    minPlayers: config?.minPlayers ?? DEFAULT_CONFIG.minPlayers,
    shiftRule: config?.shiftRule ?? DEFAULT_CONFIG.shiftRule,
    // Clamp the player cap to the rules range regardless of input.
    maxPlayers: Math.max(2, Math.min(8, config?.maxPlayers ?? DEFAULT_CONFIG.maxPlayers)),
  };

  const game: SabaccGame = {
    id,
    createdAt: new Date(),
    config: merged,
    phase: 'lobby',
    handNumber: 0,
    round: null,
    players: [],
    hostId: null,
    deck: [],
    discard: [],
    pots: { main: 0, sabacc: 0 },
    actorId: null,
    dealerSeatIndex: 0,
    betting: null,
    dice: { rolled: false, faces: null, isMatch: false },
    deltaSeq: 0,
    lastWinnerIds: [],
    lastWinDescription: null,
  };

  games.set(id, game);
  return { id, url: `/sabacc/${id}` };
}

export function getGame(id: string): SabaccGame | undefined {
  return games.get(id);
}

export function deleteGame(id: string): void {
  games.delete(id);
}

/** A hand is in progress (no joining/leaving the table mid-hand). */
function handInProgress(game: SabaccGame): boolean {
  return game.phase === 'card' || game.phase === 'betting' || game.phase === 'dice';
}

function lowestFreeSeat(game: SabaccGame): number | null {
  const taken = new Set(game.players.map((p) => p.seatIndex));
  for (let i = 0; i < game.config.maxPlayers; i++) {
    if (!taken.has(i)) return i;
  }
  return null;
}

export interface AddPlayerResult {
  player?: Player;
  token?: string;
  error?: string;
}

export function addPlayer(gameId: string, rawName: string, rawCredits: number): AddPlayerResult {
  const game = games.get(gameId);
  if (!game) return { error: 'Game not found.' };

  const name = (rawName ?? '').trim().slice(0, 24);
  if (!name) return { error: 'Please enter a name.' };

  const credits = Math.floor(rawCredits);
  if (!Number.isFinite(credits) || credits < 1) return { error: 'Enter a starting credit amount of at least 1.' };
  if (credits > 1_000_000) return { error: 'That is more credits than the table allows.' };

  if (game.players.length >= game.config.maxPlayers) return { error: 'The table is full.' };

  const seatIndex = lowestFreeSeat(game);
  if (seatIndex === null) return { error: 'The table is full.' };

  const id = nanoid(10);
  const token = nanoid(21);
  const isFirst = game.players.length === 0;

  const player: Player = {
    id,
    token,
    name,
    seatIndex,
    credits,
    hand: [],
    currentBet: 0,
    committedThisHand: 0,
    // If a hand is already running, the newcomer sits out until the next deal.
    status: handInProgress(game) ? 'folded' : 'active',
    acted: false,
    stood: false,
    connected: true,
    isHost: isFirst,
    joinedAt: Date.now(),
  };

  game.players.push(player);
  if (isFirst) game.hostId = id;

  return { player, token };
}

/** Reconnect: look a player up by their secret token and mark them connected. */
export function reclaimSeat(gameId: string, token: string): Player | undefined {
  const game = games.get(gameId);
  if (!game) return undefined;
  const player = game.players.find((p) => p.token === token);
  if (!player) return undefined;
  player.connected = true;
  return player;
}

export function setConnected(gameId: string, playerId: string, connected: boolean): void {
  const game = games.get(gameId);
  if (!game) return;
  const player = game.players.find((p) => p.id === playerId);
  if (player) player.connected = connected;
}

/**
 * Remove a player. In the lobby / between hands they leave the table outright;
 * mid-hand they are folded and marked disconnected but keep their seat so pot
 * accounting stays consistent (the seat frees up at the next deal).
 */
export function removePlayer(gameId: string, playerId: string): void {
  const game = games.get(gameId);
  if (!game) return;
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return;

  if (handInProgress(game)) {
    player.status = 'folded';
    player.connected = false;
  } else {
    game.players = game.players.filter((p) => p.id !== playerId);
  }
  reassignHostIfNeeded(game);
}

/** Drop seats left empty by disconnected players who never reclaimed them. */
export function pruneDisconnectedBetweenHands(game: SabaccGame): void {
  if (handInProgress(game)) return;
  game.players = game.players.filter((p) => p.connected);
  reassignHostIfNeeded(game);
}

export function reassignHostIfNeeded(game: SabaccGame): void {
  const host = game.hostId ? game.players.find((p) => p.id === game.hostId) : undefined;
  if (host && host.connected) return;
  if (host) host.isHost = false;
  const next = [...game.players].sort((a, b) => a.seatIndex - b.seatIndex).find((p) => p.connected);
  if (next) {
    next.isHost = true;
    game.hostId = next.id;
  } else {
    game.hostId = null;
  }
}

/** Cheap sweep of abandoned games (no connected players), called opportunistically. */
export function sweepEmptyGames(maxAgeMs = 6 * 60 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, game] of games) {
    const anyConnected = game.players.some((p) => p.connected);
    if (!anyConnected && now - game.createdAt.getTime() > maxAgeMs) {
      games.delete(id);
    }
  }
}
