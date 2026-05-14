import { useGameStore } from '../store';
import type { GameMode } from '../store';

interface HeaderProps {
  mode: GameMode;
}

function formatMode(mode: GameMode): string {
  switch (mode) {
    case 'numbers':
      return 'Numbers';
    case 'letters':
      return 'Letters';
    case 'mixed':
      return 'Mixed';
  }
}

export function Header({ mode }: HeaderProps) {
  const rows = useGameStore((s) => s.rows);
  const tries = useGameStore((s) => s.tries);

  return (
    <header className="flex items-center justify-between w-full max-w-lg mx-auto px-2 py-4 border-b border-zinc-800">
      <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'Geist Sans, sans-serif' }}>
        Wordle
      </h1>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400 bg-zinc-800 px-2.5 py-1 rounded">
          {formatMode(mode)}
        </span>
        <span className="text-sm font-medium text-zinc-400">
          {rows.length}/{tries}
        </span>
      </div>
    </header>
  );
}
