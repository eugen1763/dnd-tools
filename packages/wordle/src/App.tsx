import { useEffect, useRef, useState } from 'react';
import { useGameStore } from './store';
import { useGuess } from './hooks/useGuess';
import { getRandomWord } from './word-utils';
import { Header } from './components/Header';
import { WordRow } from './components/WordRow';
import { Keyboard } from './components/Keyboard';
import { GameOverModal } from './components/GameOverModal';

export default function App() {
  const [initialized, setInitialized] = useState(false);
  const initGame = useGameStore((s) => s.initGame);
  const secret = useGameStore((s) => s.secret);
  const tries = useGameStore((s) => s.tries);
  const mode = useGameStore((s) => s.mode);
  const rows = useGameStore((s) => s.rows);
  const gameState = useGameStore((s) => s.gameState);

  const { guess, addGuessLetter, invalidGuess } = useGuess(secret, mode);
  const addGuessLetterRef = useRef(addGuessLetter);
  addGuessLetterRef.current = addGuessLetter;

  useEffect(() => {
    const path = window.location.pathname;
    const gameId = path.split('/').filter(Boolean).pop();

    if (gameId) {
      fetch(`/api/games/${gameId}`)
        .then((res) => res.json())
        .then((data) => {
          initGame(data.secret, data.tries ?? 6);
          setInitialized(true);
        })
        .catch(() => {
          initGame(getRandomWord(), 6);
          setInitialized(true);
        });
    } else {
      initGame(getRandomWord(), 6);
      setInitialized(true);
    }
  }, [initGame]);

  useEffect(() => {
    if (!initialized) return;

    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') addGuessLetterRef.current('Enter');
      else if (e.key === 'Backspace') addGuessLetterRef.current('Backspace');
      else if (/^[a-zA-Z]$/.test(e.key)) addGuessLetterRef.current(e.key.toUpperCase());
      else if (/^[0-9]$/.test(e.key)) addGuessLetterRef.current(e.key);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [initialized]);

  if (!initialized) return null;

  const gridRows: React.ReactNode[] = [];

  for (let i = 0; i < rows.length; i++) {
    gridRows.push(
      <WordRow key={`row-${i}`} guess={rows[i].guess} result={rows[i].result} length={secret.length} />,
    );
  }

  if (gameState === 'playing') {
    gridRows.push(
      <WordRow key="current" guess={guess} length={secret.length} invalidGuess={invalidGuess} />,
    );
  }

  const emptyCount = tries - rows.length - (gameState === 'playing' ? 1 : 0);
  for (let i = 0; i < emptyCount; i++) {
    gridRows.push(<WordRow key={`empty-${i}`} length={secret.length} />);
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center bg-zinc-950">
      <Header mode={mode} />
      <main className="flex-1 flex flex-col items-center justify-center gap-1.5 py-4">
        {gridRows}
      </main>
      <Keyboard onKeyPress={addGuessLetter} mode={mode} />
      {gameState !== 'playing' && (
        <GameOverModal gameState={gameState} secret={secret} />
      )}
    </div>
  );
}
