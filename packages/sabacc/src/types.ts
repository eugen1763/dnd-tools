// Mirror of the server's per-recipient serialized Sabacc state (sabacc-ws.ts
// `serializeFor`) and the engine's public shapes (sabacc-engine.ts).

export type Suit = 'circle' | 'triangle' | 'square';
export type CardKind = 'suit' | 'sylop';

export interface Card {
  id: string;
  kind: CardKind;
  suit: Suit | null;
  value: number;
}

export type PlayerStatus = 'active' | 'folded' | 'allIn';

export interface PlayerView {
  id: string;
  name: string;
  seatIndex: number;
  credits: number;
  status: PlayerStatus;
  connected: boolean;
  isHost: boolean;
  currentBet: number;
  committedThisHand: number;
  stood: boolean;
  handCount: number;
  hand?: Card[]; // present only for yourself, or for everyone at showdown
}

export type Phase = 'lobby' | 'card' | 'betting' | 'dice' | 'showdown' | 'handOver';

export type DiceSymbol = 'circle' | 'triangle' | 'square' | 'sylop' | 'starbird' | 'krayt';

export interface DiceState {
  rolled: boolean;
  faces: [DiceSymbol, DiceSymbol] | null;
  isMatch: boolean;
}

export interface Pot {
  main: number;
  sabacc: number;
}

export interface SabaccConfig {
  anteMain: number;
  anteSabacc: number;
  maxPlayers: number;
  minPlayers: number;
  shiftRule: 'discardRedraw' | 'none';
}

export type CardActionKind = 'stand' | 'gain' | 'swap';
export type BetActionKind = 'check' | 'bet' | 'call' | 'raise' | 'fold';

export interface ActionOptions {
  card?: CardActionKind[];
  bet?: BetActionKind[];
  toCall?: number;
  minRaiseTo?: number;
  maxBetTo?: number;
}

export interface BettingView {
  currentBet: number;
  minRaise: number;
  tableCap: number;
}

export interface GameState {
  id: string;
  phase: Phase;
  round: 1 | 2 | 3 | null;
  handNumber: number;
  pots: Pot;
  dice: DiceState;
  actorId: string | null;
  dealerSeatIndex: number;
  hostId: string | null;
  config: SabaccConfig;
  betting: BettingView | null;
  players: PlayerView[];
  you: { playerId: string; legalActions: ActionOptions } | null;
  lastWinnerIds: string[];
  lastWinDescription: string | null;
}

export interface RevealEntry {
  playerId: string;
  cards: Card[];
  label: string;
  sum: number;
}

export interface FloatDelta {
  id: number;
  playerId: string;
  amount: number;
  reason: string;
}
