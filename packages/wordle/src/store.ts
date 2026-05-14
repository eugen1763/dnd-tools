import { create } from 'zustand';
import { LetterState, computeGuess, detectMode } from './word-utils';

export type GameMode = 'numbers' | 'letters' | 'mixed';

interface GameRow {
  guess: string;
  result: LetterState[];
}

interface GameState {
  secret: string;
  tries: number;
  mode: GameMode;
  rows: GameRow[];
  gameState: 'playing' | 'won' | 'lost';
  keyboardLetterState: Record<string, LetterState>;
  connected: boolean;
  playerCount: number;
  wsSend: ((data: string) => void) | null;
  addGuess: (guess: string) => void;
  applyRemoteGuess: (guess: string, result: LetterState[]) => void;
  submitGuess: (guess: string) => void;
  setWsSend: (send: ((data: string) => void) | null) => void;
  setConnectionStatus: (connected: boolean) => void;
  setPlayerCount: (count: number) => void;
  initGame: (secret: string, tries: number) => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  secret: '',
  tries: 6,
  mode: 'letters',
  rows: [],
  gameState: 'playing',
  keyboardLetterState: {},
  connected: false,
  playerCount: 1,
  wsSend: null,

  addGuess: (guess: string) => {
    const state = get();
    const result = computeGuess(guess, state.secret);
    const newKeyboardLetterState = { ...state.keyboardLetterState };

    for (let i = 0; i < guess.length; i++) {
      const letter = guess[i];
      const currentState = newKeyboardLetterState[letter];
      const newState = result[i];
      if (currentState === undefined || newState > currentState) {
        newKeyboardLetterState[letter] = newState;
      }
    }

    const won = result.every((r) => r === LetterState.Match);
    const lost = state.rows.length + 1 >= state.tries;

    set({
      rows: [...state.rows, { guess, result }],
      keyboardLetterState: newKeyboardLetterState,
      gameState: won ? 'won' : lost ? 'lost' : 'playing',
    });
  },

  applyRemoteGuess: (guess: string, result: LetterState[]) => {
    const state = get();
    const newKeyboardLetterState = { ...state.keyboardLetterState };

    for (let i = 0; i < guess.length; i++) {
      const letter = guess[i];
      const currentState = newKeyboardLetterState[letter];
      const newState = result[i];
      if (currentState === undefined || newState > currentState) {
        newKeyboardLetterState[letter] = newState;
      }
    }

    const won = result.every((r) => r === LetterState.Match);
    const lost = state.rows.length + 1 >= state.tries;

    set({
      rows: [...state.rows, { guess, result }],
      keyboardLetterState: newKeyboardLetterState,
      gameState: won ? 'won' : lost ? 'lost' : 'playing',
    });
  },

  submitGuess: (guess: string) => {
    const { wsSend } = get();
    if (wsSend) {
      wsSend(JSON.stringify({ type: 'guess', guess }));
    } else {
      get().addGuess(guess);
    }
  },

  setWsSend: (send) => set({ wsSend: send }),

  setConnectionStatus: (connected) => set({ connected }),

  setPlayerCount: (count) => set({ playerCount: count }),

  initGame: (secret: string, tries: number) => {
    set({
      secret: secret.toUpperCase(),
      tries,
      mode: detectMode(secret),
      rows: [],
      gameState: 'playing',
      keyboardLetterState: {},
    });
  },
}));
