// Corellian Spike Sabacc — pure game logic.
//
// This module is intentionally free of I/O, sockets, timers, and the games Map.
// It operates on a plain `SabaccGame` object (mutating it in place, mirroring the
// imperative style of store.ts / music-player.ts) and returns an array of
// `ServerEvent`s describing what just happened so the WebSocket layer can drive
// animations. The full authoritative state is always re-broadcast after each
// action, so events only need to carry the transient / animation-worthy details.
//
// Rules implemented (the Solo / Galaxy's Edge "Corellian Spike" variant):
//  - 62-card deck: 3 suits x (+1..+10, -1..-10) + 2 Sylops (value 0).
//  - Goal: hand sum closest to ZERO; exactly 0 is a "Sabacc".
//  - A hand = 3 rounds; each round: Card phase -> Betting phase -> Dice phase.
//  - Matching dice trigger a "Sabacc shift" (effect is house-variable, so it is
//    isolated in applySabaccShift and gated by config.shiftRule).
//  - Two pots: Main (best hand) + Sabacc (a hand of exactly 0 also wins this;
//    otherwise it carries over).
//  - Named hand hierarchy + tie-breakers per the official deck's reference card.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Suit = 'circle' | 'triangle' | 'square';
export type CardKind = 'suit' | 'sylop';

export interface Card {
  id: string; // stable & unique within a deck, e.g. "circle:+7" or "sylop#1"
  kind: CardKind;
  suit: Suit | null;
  value: number; // -10..-1, 1..10 for suit cards; 0 for sylop
}

export type PlayerStatus = 'active' | 'folded' | 'allIn';

export interface Player {
  id: string; // public, seat-stable
  token: string; // SECRET reconnect token — never broadcast
  name: string;
  seatIndex: number; // 0-based position around the table
  credits: number; // authoritative balance
  hand: Card[]; // hole cards — private until showdown
  currentBet: number; // chips matched in the CURRENT betting round
  committedThisHand: number; // total chips into pots this hand (future side pots)
  status: PlayerStatus;
  acted: boolean; // has acted in the current sub-phase (card OR betting)
  stood: boolean; // chose Stand this round (informational)
  connected: boolean;
  isHost: boolean;
  joinedAt: number;
}

export interface Pot {
  main: number;
  sabacc: number;
}

export type DiceSymbol = 'circle' | 'triangle' | 'square' | 'sylop' | 'starbird' | 'krayt';

export interface DiceState {
  rolled: boolean;
  faces: [DiceSymbol, DiceSymbol] | null;
  isMatch: boolean;
}

export type Phase = 'lobby' | 'card' | 'betting' | 'dice' | 'showdown' | 'handOver';

export interface BettingState {
  currentBet: number; // amount every active player must match
  lastRaiserId: string | null;
  minRaise: number; // minimum raise increment
  tableCap: number; // table-stakes ceiling for a bet/raise total (smallest stack)
}

export type DeltaReason =
  | 'ante'
  | 'bet'
  | 'call'
  | 'raise'
  | 'winMain'
  | 'winSabacc';

export interface CreditDelta {
  playerId: string;
  amount: number; // signed: negative = paid in, positive = received
  reason: DeltaReason;
  balanceAfter: number;
}

export interface DeltaEvent {
  seq: number;
  reason: DeltaReason | 'potResolution';
  deltas: CreditDelta[];
  potAfter: Pot;
}

export interface SabaccConfig {
  anteMain: number;
  anteSabacc: number;
  maxPlayers: number;
  minPlayers: number;
  shiftRule: 'discardRedraw' | 'none';
}

export interface SabaccGame {
  id: string;
  createdAt: Date;
  config: SabaccConfig;

  phase: Phase;
  handNumber: number;
  round: 1 | 2 | 3 | null;

  players: Player[]; // kept sorted by seatIndex
  hostId: string | null;

  deck: Card[]; // top of deck = last element (pop())
  discard: Card[];

  pots: Pot;

  actorId: string | null;
  dealerSeatIndex: number;
  betting: BettingState | null;

  dice: DiceState;

  deltaSeq: number;
  lastWinnerIds: string[];
  lastWinDescription: string | null;

  // Idle-cleanup bookkeeping (managed by the store, ignored by the engine):
  // the timestamp when the last connected player left, or null while occupied.
  emptySince?: number | null;
}

// --- Hand evaluation ---

export type HandCategory =
  | 'pureSabacc'
  | 'fullSabacc'
  | 'fleet'
  | 'yeeHaa'
  | 'rhylet'
  | 'squadron'
  | 'geeWhiz'
  | 'straightKhyron'
  | 'banthasWild'
  | 'ruleOfTwo'
  | 'sabaccPair'
  | 'plainZero'
  | 'nulrhek';

export interface HandEval {
  sum: number;
  category: HandCategory;
  isSabacc: boolean; // sum === 0
  rankKey: number[]; // smaller = better, compared lexicographically
  label: string; // human-readable, e.g. "Pure Sabacc", "Nulrhek (+2)"
}

// --- Events (the engine -> WS-layer animation contract) ---

export interface RevealEntry {
  playerId: string;
  cards: Card[];
  label: string;
  sum: number;
}

export type ServerEvent =
  | { type: 'hand_started'; handNumber: number; dealerSeatIndex: number }
  | { type: 'dealt'; hands: Record<string, Card[]>; counts: Record<string, number> }
  | { type: 'card_action_result'; playerId: string; action: CardActionKind }
  | { type: 'bet_action_result'; playerId: string; action: BetActionKind; amount: number }
  | { type: 'delta'; deltaEvent: DeltaEvent }
  | { type: 'dice_rolled'; faces: [DiceSymbol, DiceSymbol]; isMatch: boolean }
  | { type: 'sabacc_shift'; affectedPlayerIds: string[]; hands: Record<string, Card[]>; counts: Record<string, number> }
  | {
      type: 'showdown';
      reveals: RevealEntry[];
      winnerIds: string[];
      winDescription: string;
      sabaccPotWon: boolean;
    };

export type CardActionKind = 'stand' | 'gain' | 'swap';
export type BetActionKind = 'check' | 'bet' | 'call' | 'raise' | 'fold';

export class SabaccError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SUITS: Suit[] = ['circle', 'triangle', 'square'];
export const DICE_SYMBOLS: DiceSymbol[] = ['circle', 'triangle', 'square', 'sylop', 'starbird', 'krayt'];
export const MAX_HAND_SIZE = 5;
const ROUNDS = 3;

export const DEFAULT_CONFIG: SabaccConfig = {
  anteMain: 2,
  anteSabacc: 1,
  maxPlayers: 8,
  minPlayers: 2,
  shiftRule: 'discardRedraw',
};

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let v = 1; v <= 10; v++) {
      deck.push({ id: `${suit}:+${v}`, kind: 'suit', suit, value: v });
      deck.push({ id: `${suit}:-${v}`, kind: 'suit', suit, value: -v });
    }
  }
  deck.push({ id: 'sylop#1', kind: 'sylop', suit: null, value: 0 });
  deck.push({ id: 'sylop#2', kind: 'sylop', suit: null, value: 0 });
  return deck;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function reshuffleDiscardIntoDeck(game: SabaccGame, rng: () => number): void {
  if (game.discard.length === 0) return;
  game.deck = shuffle(game.deck.concat(game.discard), rng);
  game.discard = [];
}

function drawCard(game: SabaccGame, rng: () => number): Card | null {
  if (game.deck.length === 0) reshuffleDiscardIntoDeck(game, rng);
  return game.deck.pop() ?? null;
}

// ---------------------------------------------------------------------------
// Hand evaluation & ranking
// ---------------------------------------------------------------------------

function handSum(cards: Card[]): number {
  return cards.reduce((s, c) => s + c.value, 0);
}

function positiveSum(cards: Card[]): number {
  return cards.reduce((s, c) => (c.value > 0 ? s + c.value : s), 0);
}

function highestPositive(cards: Card[]): number {
  return cards.reduce((m, c) => (c.value > m ? c.value : m), 0);
}

/** Group suit cards by absolute value (magnitude). Sylops are excluded. */
function magnitudeGroupSizes(cards: Card[]): number[] {
  const counts = new Map<number, number>();
  for (const c of cards) {
    if (c.kind === 'sylop') continue;
    const m = Math.abs(c.value);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.values()].sort((a, b) => b - a);
}

function suitCards(cards: Card[]): Card[] {
  return cards.filter((c) => c.kind === 'suit');
}

function sylopCount(cards: Card[]): number {
  return cards.filter((c) => c.kind === 'sylop').length;
}

const CATEGORY_LABELS: Record<HandCategory, string> = {
  pureSabacc: 'Pure Sabacc',
  fullSabacc: 'Full Sabacc',
  fleet: 'Fleet',
  yeeHaa: 'Yee-Haa',
  rhylet: 'Rhylet',
  squadron: 'Squadron',
  geeWhiz: 'Gee Whiz',
  straightKhyron: 'Straight Khyron',
  banthasWild: "Bantha's Wild",
  ruleOfTwo: 'Rule of Two',
  sabaccPair: 'Sabacc',
  plainZero: 'Sabacc',
  nulrhek: 'Nulrhek',
};

// Tier order: lower index = stronger. plainZero sits just above nulrhek; both
// are weaker than every named specialty hand.
const TIER: Record<HandCategory, number> = {
  pureSabacc: 0,
  fullSabacc: 1,
  fleet: 2,
  yeeHaa: 3,
  rhylet: 4,
  squadron: 5,
  geeWhiz: 6,
  straightKhyron: 7,
  banthasWild: 8,
  ruleOfTwo: 9,
  sabaccPair: 10,
  plainZero: 11,
  nulrhek: 12,
};

function detectZeroCategory(cards: Card[]): HandCategory {
  const sc = suitCards(cards);
  const sy = sylopCount(cards);
  const groups = magnitudeGroupSizes(cards);
  const n = cards.length;

  // Pure Sabacc: exactly two Sylops.
  if (n === 2 && sy === 2) return 'pureSabacc';

  // Hands containing exactly one Sylop.
  if (sy === 1) {
    if (sc.length === 4) {
      const tens = sc.every((c) => Math.abs(c.value) === 10);
      const posTens = sc.filter((c) => c.value === 10).length;
      const negTens = sc.filter((c) => c.value === -10).length;
      if (tens && posTens === 2 && negTens === 2) return 'fullSabacc';
      if (groups.length === 1 && groups[0] === 4) return 'fleet';
    }
    if (sc.length === 2 && groups.length === 1 && groups[0] === 2) return 'yeeHaa';
  }

  // Sylop-free named hands.
  if (sy === 0) {
    if (sc.length === 5 && groups.length === 2 && groups[0] === 3 && groups[1] === 2) return 'rhylet';
    if (sc.length === 4 && groups.length === 1 && groups[0] === 4) return 'squadron';
    if (isGeeWhiz(sc)) return 'geeWhiz';
    if (sc.length === 4 && isStraightKhyron(sc)) return 'straightKhyron';
    if (groups[0] === 3 && groups[1] !== 2) return 'banthasWild';
    if (sc.length === 4 && groups.length === 2 && groups[0] === 2 && groups[1] === 2) return 'ruleOfTwo';
    if (sc.length === 2 && groups.length === 1 && groups[0] === 2) return 'sabaccPair';
  }

  return 'plainZero';
}

function isGeeWhiz(sc: Card[]): boolean {
  if (sc.length !== 5) return false;
  const vals = sc.map((c) => c.value).sort((a, b) => a - b);
  const positive = [1, 2, 3, 4, -10].sort((a, b) => a - b);
  const negative = [-1, -2, -3, -4, 10].sort((a, b) => a - b);
  return arraysEqual(vals, positive) || arraysEqual(vals, negative);
}

function isStraightKhyron(sc: Card[]): boolean {
  // Four cards whose magnitudes are 4 distinct consecutive integers.
  const mags = [...new Set(sc.map((c) => Math.abs(c.value)))].sort((a, b) => a - b);
  if (mags.length !== 4) return false;
  return mags[3] - mags[0] === 3 && mags[1] === mags[0] + 1 && mags[2] === mags[0] + 2;
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function evaluateHand(cards: Card[]): HandEval {
  const sum = handSum(cards);
  const isSabacc = sum === 0;
  const category: HandCategory = isSabacc ? detectZeroCategory(cards) : 'nulrhek';
  const tier = TIER[category];

  let rankKey: number[];
  let label = CATEGORY_LABELS[category];

  if (category === 'nulrhek') {
    // Closest to zero, then positive beats negative, then most cards, then
    // highest positive sum, then highest single positive card.
    const signRank = sum > 0 ? 0 : 1;
    rankKey = [tier, Math.abs(sum), signRank, -cards.length, -positiveSum(cards), -highestPositive(cards)];
    label = `Nulrhek (${sum > 0 ? '+' : ''}${sum})`;
  } else {
    // All zero-sum hands (named + plain): tie-break by most cards, then highest
    // positive sum, then highest single positive card.
    rankKey = [tier, -cards.length, -positiveSum(cards), -highestPositive(cards)];
  }

  return { sum, category, isSabacc, rankKey, label };
}

/** Negative => a is strictly better (sorts best-first). */
export function compareHands(a: HandEval, b: HandEval): number {
  const len = Math.max(a.rankKey.length, b.rankKey.length);
  for (let i = 0; i < len; i++) {
    const av = a.rankKey[i] ?? 0;
    const bv = b.rankKey[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export interface ShowdownRanking {
  ranked: { playerId: string; eval: HandEval }[];
  winnerIds: string[];
  winnerHitsZero: boolean;
  winDescription: string;
}

export function rankShowdown(players: Player[]): ShowdownRanking {
  const ranked = players
    .map((p) => ({ playerId: p.id, eval: evaluateHand(p.hand) }))
    .sort((a, b) => compareHands(a.eval, b.eval));

  const best = ranked[0].eval;
  const winnerIds = ranked.filter((r) => compareHands(r.eval, best) === 0).map((r) => r.playerId);
  return {
    ranked,
    winnerIds,
    winnerHitsZero: best.isSabacc,
    winDescription: best.label,
  };
}

// ---------------------------------------------------------------------------
// Seat / turn helpers
// ---------------------------------------------------------------------------

function bySeat(game: SabaccGame): Player[] {
  return [...game.players].sort((a, b) => a.seatIndex - b.seatIndex);
}

function playerById(game: SabaccGame, id: string | null): Player | undefined {
  if (!id) return undefined;
  return game.players.find((p) => p.id === id);
}

/** First player after `fromSeatIndex` (exclusive, wrapping) matching predicate. */
function nextSeat(game: SabaccGame, fromSeatIndex: number, predicate: (p: Player) => boolean): Player | null {
  const seats = bySeat(game); // sorted ascending by seatIndex
  if (seats.length === 0) return null;
  // Scan occupied seats in clockwise order beginning just after fromSeatIndex,
  // wrapping around exactly once.
  const after = seats.filter((p) => p.seatIndex > fromSeatIndex);
  const before = seats.filter((p) => p.seatIndex <= fromSeatIndex);
  for (const p of [...after, ...before]) {
    if (predicate(p)) return p;
  }
  return null;
}

const canCardAct = (p: Player) => p.status !== 'folded';
const canBet = (p: Player) => p.status === 'active';
const inHand = (p: Player) => p.status !== 'folded';

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

function makeDelta(
  game: SabaccGame,
  reason: DeltaEvent['reason'],
  deltas: CreditDelta[],
): DeltaEvent {
  game.deltaSeq += 1;
  return { seq: game.deltaSeq, reason, deltas, potAfter: { ...game.pots } };
}

/** Move chips from a player into the main pot, returning the signed delta. */
function payToMain(game: SabaccGame, p: Player, amount: number, reason: DeltaReason): CreditDelta {
  const pay = Math.min(amount, p.credits);
  p.credits -= pay;
  p.currentBet += pay;
  p.committedThisHand += pay;
  game.pots.main += pay;
  if (p.credits === 0 && p.status === 'active') p.status = 'allIn';
  return { playerId: p.id, amount: -pay, reason, balanceAfter: p.credits };
}

// ---------------------------------------------------------------------------
// Hand lifecycle
// ---------------------------------------------------------------------------

export function startHand(game: SabaccGame, rng: () => number = Math.random): ServerEvent[] {
  if (game.phase !== 'lobby' && game.phase !== 'showdown' && game.phase !== 'handOver') {
    throw new SabaccError('bad_phase', 'A hand is already in progress.');
  }

  const eligible = bySeat(game).filter((p) => p.credits > 0);
  if (eligible.length < game.config.minPlayers) {
    throw new SabaccError('not_enough_players', `Need at least ${game.config.minPlayers} players with credits.`);
  }

  // Reset per-hand player state. Players with no credits sit the hand out.
  for (const p of game.players) {
    p.hand = [];
    p.currentBet = 0;
    p.committedThisHand = 0;
    p.acted = false;
    p.stood = false;
    p.status = p.credits > 0 ? 'active' : 'folded';
  }

  game.handNumber += 1;
  game.deck = shuffle(buildDeck(), rng);
  game.discard = [];
  game.dice = { rolled: false, faces: null, isMatch: false };
  game.lastWinnerIds = [];
  game.lastWinDescription = null;

  // Rotate the dealer to the next eligible seat.
  const firstHand = game.handNumber === 1;
  const dealer = firstHand
    ? eligible[0]
    : nextSeat(game, game.dealerSeatIndex, (p) => p.status === 'active');
  game.dealerSeatIndex = (dealer ?? eligible[0]).seatIndex;

  const events: ServerEvent[] = [];
  events.push({ type: 'hand_started', handNumber: game.handNumber, dealerSeatIndex: game.dealerSeatIndex });

  // Ante into both pots.
  const anteDeltas: CreditDelta[] = [];
  for (const p of bySeat(game)) {
    if (p.status !== 'active') continue;
    const main = Math.min(game.config.anteMain, p.credits);
    p.credits -= main;
    p.committedThisHand += main;
    game.pots.main += main;
    const sab = Math.min(game.config.anteSabacc, p.credits);
    p.credits -= sab;
    p.committedThisHand += sab;
    game.pots.sabacc += sab;
    if (p.credits === 0) p.status = 'allIn';
    anteDeltas.push({ playerId: p.id, amount: -(main + sab), reason: 'ante', balanceAfter: p.credits });
  }
  events.push({ type: 'delta', deltaEvent: makeDelta(game, 'ante', anteDeltas) });

  // Deal two cards each.
  const hands: Record<string, Card[]> = {};
  const counts: Record<string, number> = {};
  for (let i = 0; i < 2; i++) {
    for (const p of bySeat(game)) {
      if (p.status === 'folded') continue;
      const c = drawCard(game, rng);
      if (c) p.hand.push(c);
    }
  }
  for (const p of game.players) {
    hands[p.id] = p.hand;
    counts[p.id] = p.hand.length;
  }
  events.push({ type: 'dealt', hands, counts });

  // Begin round 1 in the card phase.
  game.round = 1;
  beginCardPhase(game);

  return events;
}

function beginCardPhase(game: SabaccGame): void {
  game.phase = 'card';
  game.betting = null;
  for (const p of game.players) {
    p.acted = false;
    p.stood = false;
  }
  const first = nextSeat(game, game.dealerSeatIndex, canCardAct);
  game.actorId = first ? first.id : null;
  // If nobody can act (shouldn't happen), skip straight to betting.
  if (!game.actorId) beginBettingPhase(game);
}

export function applyCardAction(
  game: SabaccGame,
  playerId: string,
  action: CardActionKind,
  cardId: string | undefined,
  rng: () => number = Math.random,
): ServerEvent[] {
  if (game.phase !== 'card') throw new SabaccError('bad_phase', 'Not the card phase.');
  if (game.actorId !== playerId) throw new SabaccError('not_your_turn', 'It is not your turn.');
  const p = playerById(game, playerId);
  if (!p || !canCardAct(p)) throw new SabaccError('cannot_act', 'You cannot act.');

  const events: ServerEvent[] = [];

  if (action === 'stand') {
    p.stood = true;
  } else if (action === 'gain') {
    if (p.hand.length >= MAX_HAND_SIZE) throw new SabaccError('hand_full', 'Your hand is already full.');
    const c = drawCard(game, rng);
    if (c) p.hand.push(c);
  } else if (action === 'swap') {
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new SabaccError('no_such_card', 'You do not hold that card.');
    const [removed] = p.hand.splice(idx, 1);
    game.discard.push(removed);
    const c = drawCard(game, rng);
    if (c) p.hand.push(c);
  } else {
    throw new SabaccError('bad_action', 'Unknown card action.');
  }

  p.acted = true;
  events.push({ type: 'card_action_result', playerId, action });

  // Advance to the next player who still needs to take a card action.
  const next = nextSeat(game, p.seatIndex, (q) => canCardAct(q) && !q.acted);
  if (next) {
    game.actorId = next.id;
  } else {
    beginBettingPhase(game);
    events.push(...maybeAutoAdvanceBetting(game, rng));
  }
  return events;
}

function beginBettingPhase(game: SabaccGame): void {
  game.phase = 'betting';
  for (const p of game.players) {
    p.currentBet = 0;
    if (p.status === 'active') p.acted = false;
  }
  game.betting = {
    currentBet: 0,
    lastRaiserId: null,
    minRaise: Math.max(1, game.config.anteMain),
    tableCap: computeTableCap(game),
  };
  const first = nextSeat(game, game.dealerSeatIndex, canBet);
  game.actorId = first ? first.id : null;
}

function computeTableCap(game: SabaccGame): number {
  // Table stakes: cap a bet/raise total at the smallest active stack so every
  // active player can always call (v1: no side pots).
  const actives = game.players.filter((p) => p.status === 'active');
  if (actives.length === 0) return 0;
  return Math.min(...actives.map((p) => p.currentBet + p.credits));
}

/** If no active player can act (all all-in / one left), fast-forward the round. */
function maybeAutoAdvanceBetting(game: SabaccGame, rng: () => number): ServerEvent[] {
  if (game.phase !== 'betting') return [];
  const survivors = game.players.filter(inHand);
  if (survivors.length <= 1) {
    return endHand(game, rng);
  }
  if (isBettingRoundComplete(game)) {
    return endBettingPhase(game, rng);
  }
  return [];
}

export function isBettingRoundComplete(game: SabaccGame): boolean {
  if (!game.betting) return true;
  const actives = game.players.filter((p) => p.status === 'active');
  if (actives.length === 0) return true;
  // Every still-active player must have matched the current bet AND acted at
  // least once since the most recent bet/raise.
  return actives.every((p) => p.currentBet === game.betting!.currentBet && p.acted);
}

export function applyBetAction(
  game: SabaccGame,
  playerId: string,
  action: BetActionKind,
  amount: number | undefined,
  rng: () => number = Math.random,
): ServerEvent[] {
  if (game.phase !== 'betting' || !game.betting) throw new SabaccError('bad_phase', 'Not the betting phase.');
  if (game.actorId !== playerId) throw new SabaccError('not_your_turn', 'It is not your turn.');
  const p = playerById(game, playerId);
  if (!p || p.status !== 'active') throw new SabaccError('cannot_act', 'You cannot act.');

  const bet = game.betting;
  const toCall = bet.currentBet - p.currentBet;
  const events: ServerEvent[] = [];
  let resolvedAmount = 0;

  if (action === 'check') {
    if (toCall !== 0) throw new SabaccError('cannot_check', 'You must call, raise, or fold.');
  } else if (action === 'call') {
    if (toCall <= 0) throw new SabaccError('nothing_to_call', 'There is nothing to call.');
    const d = payToMain(game, p, toCall, 'call');
    resolvedAmount = -d.amount;
    events.push({ type: 'delta', deltaEvent: makeDelta(game, 'call', [d]) });
  } else if (action === 'bet') {
    if (bet.currentBet !== 0) throw new SabaccError('already_bet', 'There is already a bet; raise instead.');
    const target = Math.floor(amount ?? 0);
    if (target < bet.minRaise) throw new SabaccError('bet_too_small', `Minimum bet is ${bet.minRaise}.`);
    if (target > bet.tableCap) throw new SabaccError('bet_too_large', `Maximum bet is ${bet.tableCap}.`);
    const d = payToMain(game, p, target, 'bet');
    resolvedAmount = -d.amount;
    bet.currentBet = p.currentBet;
    bet.minRaise = target;
    bet.lastRaiserId = p.id;
    resetActedAfterAggression(game, p.id);
    events.push({ type: 'delta', deltaEvent: makeDelta(game, 'bet', [d]) });
  } else if (action === 'raise') {
    if (bet.currentBet === 0) throw new SabaccError('no_bet', 'Nothing to raise; bet instead.');
    const target = Math.floor(amount ?? 0); // new total currentBet for this player
    const increment = target - bet.currentBet;
    if (increment < bet.minRaise) throw new SabaccError('raise_too_small', `Minimum raise is ${bet.minRaise}.`);
    if (target > bet.tableCap) throw new SabaccError('raise_too_large', `Maximum total is ${bet.tableCap}.`);
    const d = payToMain(game, p, target - p.currentBet, 'raise');
    resolvedAmount = -d.amount;
    bet.currentBet = p.currentBet;
    bet.minRaise = increment;
    bet.lastRaiserId = p.id;
    resetActedAfterAggression(game, p.id);
    events.push({ type: 'delta', deltaEvent: makeDelta(game, 'raise', [d]) });
  } else if (action === 'fold') {
    p.status = 'folded';
  } else {
    throw new SabaccError('bad_action', 'Unknown bet action.');
  }

  p.acted = true;
  events.push({ type: 'bet_action_result', playerId, action, amount: resolvedAmount });

  // Lone survivor => award immediately.
  const survivors = game.players.filter(inHand);
  if (survivors.length === 1) {
    events.push(...endHand(game, rng));
    return events;
  }

  // Find the next active player who still needs to act (hasn't matched or
  // hasn't acted since the last raise).
  const next = nextSeat(game, p.seatIndex, (q) => q.status === 'active' && needsToAct(game, q));
  if (next) {
    game.actorId = next.id;
  } else {
    events.push(...endBettingPhase(game, rng));
  }
  return events;
}

function needsToAct(game: SabaccGame, p: Player): boolean {
  if (!game.betting) return false;
  if (p.currentBet !== game.betting.currentBet) return true;
  return !p.acted; // hasn't acted yet this betting round
}

function resetActedAfterAggression(game: SabaccGame, aggressorId: string): void {
  // After a bet/raise, every other active player must act again.
  for (const p of game.players) {
    if (p.status === 'active' && p.id !== aggressorId) p.acted = false;
  }
}

function endBettingPhase(game: SabaccGame, rng: () => number): ServerEvent[] {
  return enterDicePhase(game, rng);
}

function enterDicePhase(game: SabaccGame, rng: () => number): ServerEvent[] {
  game.phase = 'dice';
  const events: ServerEvent[] = [];
  events.push(...rollDice(game, rng));

  if (game.dice.isMatch && game.config.shiftRule === 'discardRedraw') {
    events.push(applySabaccShift(game, rng));
  }

  if (game.round !== null && game.round < ROUNDS) {
    game.round = (game.round + 1) as 1 | 2 | 3;
    beginCardPhase(game);
  } else {
    events.push(...resolveShowdown(game));
  }
  return events;
}

export function rollDice(game: SabaccGame, rng: () => number = Math.random): ServerEvent[] {
  const a = DICE_SYMBOLS[Math.floor(rng() * DICE_SYMBOLS.length)];
  const b = DICE_SYMBOLS[Math.floor(rng() * DICE_SYMBOLS.length)];
  game.dice = { rolled: true, faces: [a, b], isMatch: a === b };
  return [{ type: 'dice_rolled', faces: [a, b], isMatch: a === b }];
}

/**
 * The "Sabacc shift". The exact effect is house-variable and could not be
 * authoritatively confirmed, so it lives here behind config.shiftRule. Default:
 * every player still in the hand discards their whole hand and redraws the same
 * number of cards.
 */
export function applySabaccShift(game: SabaccGame, rng: () => number = Math.random): ServerEvent {
  const affected: string[] = [];
  const hands: Record<string, Card[]> = {};
  const counts: Record<string, number> = {};
  for (const p of bySeat(game)) {
    if (!inHand(p)) continue;
    const size = p.hand.length;
    game.discard.push(...p.hand);
    p.hand = [];
    for (let i = 0; i < size; i++) {
      const c = drawCard(game, rng);
      if (c) p.hand.push(c);
    }
    affected.push(p.id);
    hands[p.id] = p.hand;
    counts[p.id] = p.hand.length;
  }
  return { type: 'sabacc_shift', affectedPlayerIds: affected, hands, counts };
}

/** Award the main pot to the lone remaining player (everyone else folded). */
function endHand(game: SabaccGame, _rng: () => number): ServerEvent[] {
  const survivors = game.players.filter(inHand);
  const events: ServerEvent[] = [];
  if (survivors.length === 1) {
    const winner = survivors[0];
    const won = game.pots.main;
    winner.credits += won;
    game.pots.main = 0;
    const delta = makeDelta(game, 'winMain', [
      { playerId: winner.id, amount: won, reason: 'winMain', balanceAfter: winner.credits },
    ]);
    game.lastWinnerIds = [winner.id];
    game.lastWinDescription = 'Last player standing';
    game.actorId = null;
    game.phase = 'handOver';
    events.push({ type: 'delta', deltaEvent: delta });
    events.push({
      type: 'showdown',
      reveals: [],
      winnerIds: [winner.id],
      winDescription: 'Everyone else folded',
      sabaccPotWon: false,
    });
  }
  return events;
}

export function resolveShowdown(game: SabaccGame): ServerEvent[] {
  const participants = game.players.filter(inHand);
  const events: ServerEvent[] = [];

  if (participants.length <= 1) {
    return endHand(game, Math.random);
  }

  const ranking = rankShowdown(participants);
  const deltas: CreditDelta[] = [];

  // Split the main pot among the winners.
  const mainShare = Math.floor(game.pots.main / ranking.winnerIds.length);
  let mainRemainder = game.pots.main - mainShare * ranking.winnerIds.length;
  for (const id of ranking.winnerIds) {
    const p = playerById(game, id)!;
    let amt = mainShare;
    if (mainRemainder > 0) {
      amt += 1;
      mainRemainder -= 1;
    }
    p.credits += amt;
    deltas.push({ playerId: id, amount: amt, reason: 'winMain', balanceAfter: p.credits });
  }
  game.pots.main = 0;

  // The Sabacc pot is won only by a hand of exactly zero; otherwise it carries.
  let sabaccPotWon = false;
  if (ranking.winnerHitsZero && game.pots.sabacc > 0) {
    sabaccPotWon = true;
    const sabShare = Math.floor(game.pots.sabacc / ranking.winnerIds.length);
    let sabRemainder = game.pots.sabacc - sabShare * ranking.winnerIds.length;
    for (const id of ranking.winnerIds) {
      const p = playerById(game, id)!;
      let amt = sabShare;
      if (sabRemainder > 0) {
        amt += 1;
        sabRemainder -= 1;
      }
      p.credits += amt;
      deltas.push({ playerId: id, amount: amt, reason: 'winSabacc', balanceAfter: p.credits });
    }
    game.pots.sabacc = 0;
  }

  game.lastWinnerIds = ranking.winnerIds;
  game.lastWinDescription = ranking.winDescription;
  game.actorId = null;
  game.phase = 'showdown';

  const reveals: RevealEntry[] = ranking.ranked.map((r) => {
    const p = playerById(game, r.playerId)!;
    return { playerId: r.playerId, cards: p.hand, label: r.eval.label, sum: r.eval.sum };
  });

  events.push({ type: 'delta', deltaEvent: makeDelta(game, 'potResolution', deltas) });
  events.push({
    type: 'showdown',
    reveals,
    winnerIds: ranking.winnerIds,
    winDescription: ranking.winDescription,
    sabaccPotWon,
  });
  return events;
}

// ---------------------------------------------------------------------------
// Legal action introspection (for the UI of the current actor)
// ---------------------------------------------------------------------------

export interface ActionOptions {
  card?: CardActionKind[];
  bet?: BetActionKind[];
  toCall?: number;
  minRaiseTo?: number;
  maxBetTo?: number;
}

export function legalActions(game: SabaccGame, playerId: string): ActionOptions {
  if (game.actorId !== playerId) return {};
  const p = playerById(game, playerId);
  if (!p) return {};

  if (game.phase === 'card' && canCardAct(p)) {
    const card: CardActionKind[] = ['stand'];
    if (p.hand.length < MAX_HAND_SIZE) card.push('gain');
    if (p.hand.length > 0) card.push('swap');
    return { card };
  }

  if (game.phase === 'betting' && game.betting && p.status === 'active') {
    const bet = game.betting;
    const toCall = bet.currentBet - p.currentBet;
    const options: BetActionKind[] = ['fold'];
    if (toCall === 0) {
      options.push('check');
      if (p.credits >= bet.minRaise && bet.tableCap >= bet.minRaise) options.push('bet');
    } else {
      options.push('call');
      // Can raise only if there is room under the table cap and the player can
      // cover at least the minimum raise increment.
      const minRaiseTo = bet.currentBet + bet.minRaise;
      if (minRaiseTo <= bet.tableCap && p.currentBet + p.credits >= minRaiseTo) options.push('raise');
    }
    return {
      bet: options,
      toCall,
      minRaiseTo: bet.currentBet + bet.minRaise,
      maxBetTo: bet.tableCap,
    };
  }

  return {};
}
