import { useState, useCallback } from 'react';
import { useGameStore } from '../store';
import { isValidWord } from '../word-utils';
import type { GameMode } from '../store';

export function useGuess(secret: string, mode: GameMode) {
  const [guess, setGuess] = useState('');
  const [invalidGuess, setInvalidGuess] = useState(false);
  const submitGuess = useGameStore((s) => s.submitGuess);
  const gameState = useGameStore((s) => s.gameState);

  const addGuessLetter = useCallback(
    (key: string) => {
      if (gameState !== 'playing') return;

      if (key === 'Enter') {
        if (guess.length !== secret.length) {
          setInvalidGuess(true);
          setTimeout(() => setInvalidGuess(false), 500);
          return;
        }
        if (!isValidWord(guess, mode)) {
          setInvalidGuess(true);
          setTimeout(() => setInvalidGuess(false), 500);
          return;
        }
        submitGuess(guess);
        setGuess('');
        return;
      }

      if (key === 'Backspace') {
        setGuess((prev) => prev.slice(0, -1));
        return;
      }

      if (guess.length < secret.length) {
        setGuess((prev) => prev + key.toUpperCase());
      }
    },
    [guess, secret, mode, gameState, submitGuess],
  );

  return { guess, addGuessLetter, setGuess, invalidGuess };
}
