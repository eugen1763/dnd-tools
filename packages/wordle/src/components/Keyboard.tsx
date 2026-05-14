import type { GameMode } from '../store';

interface KeyboardProps {
  onKeyPress: (key: string) => void;
  mode: GameMode;
}

const LETTER_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Enter', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Backspace'],
];

const NUMBER_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['Enter', '0', 'Backspace'],
];

const MIXED_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Enter', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Backspace'],
];


function getLayout(mode: GameMode): string[][] {
  switch (mode) {
    case 'numbers':
      return NUMBER_ROWS;
    case 'mixed':
      return MIXED_ROWS;
    default:
      return LETTER_ROWS;
  }
}

export function Keyboard({ onKeyPress, mode }: KeyboardProps) {
  const layout = getLayout(mode);

  return (
    <div className="flex flex-col items-center gap-1.5 mt-4 w-full max-w-lg mx-auto">
      {layout.map((row, ri) => (
        <div key={ri} className="flex gap-1.5 justify-center">
          {row.map((key) => {
            const isSpecial = key === 'Enter' || key === 'Backspace';

            return (
              <button
                key={key}
                onClick={() => onKeyPress(key)}
                className={`flex items-center justify-center rounded font-semibold transition-colors duration-150 active:scale-95 ${
                  isSpecial ? 'px-3 min-w-[4rem] text-xs' : 'w-10'
                } h-14 bg-zinc-600 text-zinc-200 hover:brightness-110`}
                style={{ fontFamily: 'Geist Sans, sans-serif' }}
              >
                {key === 'Backspace' ? '⌫' : key}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
