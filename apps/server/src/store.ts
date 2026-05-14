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
  });

  return { id, url: `/wordle/${id}` };
}

export function getGame(id: string): GameState | undefined {
  return games.get(id);
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
