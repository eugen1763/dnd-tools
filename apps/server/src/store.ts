import { nanoid } from 'nanoid';

export type GameMode = 'numbers' | 'letters' | 'mixed';

export interface GameState {
  secret: string;
  tries: number;
  mode: GameMode;
  createdAt: Date;
}

const games = new Map<string, GameState>();

export function createGame(secret: string, tries: number = 6): { id: string; url: string } {
  const mode: GameMode = /^\d+$/.test(secret) ? 'numbers' : /^[a-zA-Z]+$/.test(secret) ? 'letters' : 'mixed';

  const id = nanoid(10);
  games.set(id, { secret: secret.toUpperCase(), tries, mode, createdAt: new Date() });

  return { id, url: `/wordle/${id}` };
}

export function getGame(id: string): GameState | undefined {
  return games.get(id);
}
