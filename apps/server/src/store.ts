import { nanoid } from 'nanoid';

export enum LetterState {
  Miss = 0,
  Present = 1,
  Match = 2,
}

export type GameMode = 'numbers' | 'letters' | 'mixed';

export interface GuessResult {
  guess: string;
  result: LetterState[];
}

export interface GameState {
  secret: string;
  tries: number;
  mode: GameMode;
  createdAt: Date;
  guesses: GuessResult[];
  // Idle-cleanup bookkeeping: timestamp when the last client disconnected, or
  // null while at least one client is connected. Managed by the WS layer.
  emptySince?: number | null;
}

const games = new Map<string, GameState>();

export function createGame(secret: string, tries: number = 6): { id: string; url: string } {
  const mode: GameMode = /^\d+$/.test(secret) ? 'numbers' : /^[a-zA-Z]+$/.test(secret) ? 'letters' : 'mixed';

  const id = nanoid(10);
  games.set(id, {
    secret: secret.toUpperCase(),
    tries,
    mode,
    createdAt: new Date(),
    guesses: [],
    // Empty from birth, so an unopened game link is also cleaned up eventually.
    emptySince: Date.now(),
  });

  return { id, url: `/wordle/${id}` };
}

export function getGame(id: string): GameState | undefined {
  return games.get(id);
}

/**
 * Mark a game occupied/empty for idle cleanup. Stamps `emptySince` when the last
 * client leaves and clears it when a client connects (a reconnect within the
 * grace window cancels cleanup).
 */
export function setGameOccupied(id: string, occupied: boolean): void {
  const game = games.get(id);
  if (!game) return;
  game.emptySince = occupied ? null : game.emptySince ?? Date.now();
}

/**
 * Delete games that have sat empty longer than idleMs. When `hasConnections` is
 * supplied (the live WebSocket registry) it is authoritative: a game with ANY
 * open socket is never deleted (and its idle clock is reset); a game with no
 * sockets has its clock (re)started so a missed disconnect can't strand it.
 */
export function sweepIdleGames(idleMs = 30 * 60 * 1000, hasConnections?: (id: string) => boolean): void {
  const now = Date.now();
  for (const [id, game] of games) {
    if (hasConnections) {
      if (hasConnections(id)) {
        game.emptySince = null; // still occupied — never delete
        continue;
      }
      if (game.emptySince == null) {
        game.emptySince = now; // no sockets but clock wasn't running — start it
        continue;
      }
    }
    if (game.emptySince != null && now - game.emptySince > idleMs) {
      games.delete(id);
    }
  }
}

export function addGuessToGame(gameId: string, guess: string, result: LetterState[]): void {
  const game = games.get(gameId);
  if (game) {
    game.guesses.push({ guess, result });
  }
}

export function getGameGuesses(gameId: string): GuessResult[] {
  return games.get(gameId)?.guesses ?? [];
}

export function computeGuess(guess: string, answer: string): LetterState[] {
  const result: LetterState[] = new Array(guess.length).fill(LetterState.Miss);
  const answerChars = answer.split('');
  const guessChars = guess.split('');

  for (let i = 0; i < guessChars.length; i++) {
    if (guessChars[i] === answerChars[i]) {
      result[i] = LetterState.Match;
      answerChars[i] = '';
      guessChars[i] = '';
    }
  }

  for (let i = 0; i < guessChars.length; i++) {
    if (guessChars[i] === '') continue;
    const idx = answerChars.indexOf(guessChars[i]);
    if (idx !== -1) {
      result[i] = LetterState.Present;
      answerChars[idx] = '';
    }
  }

  return result;
}
