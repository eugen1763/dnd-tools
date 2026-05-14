import { LetterState } from '../word-utils';

interface WordRowProps {
  guess?: string;
  result?: LetterState[];
  invalidGuess?: boolean;
  length: number;
}

const stateStyles: Record<LetterState, string> = {
  [LetterState.Miss]: 'bg-zinc-700 border-zinc-700 text-zinc-50',
  [LetterState.Present]: 'bg-amber-500 border-amber-500 text-zinc-50',
  [LetterState.Match]: 'bg-emerald-500 border-emerald-500 text-zinc-50',
};

export function WordRow({ guess = '', result, invalidGuess, length }: WordRowProps) {
  return (
    <div
      className={`flex gap-1.5 ${invalidGuess ? 'animate-[shake_0.3s_ease-in-out]' : ''}`}
      style={{ fontFamily: 'Geist Sans, sans-serif' }}
    >
      {Array.from({ length }).map((_, i) => {
        const char = guess[i] || '';
        const hasResult = result && result[i] !== undefined;
        const style = hasResult ? stateStyles[result![i]] : '';
        const filled = char !== '';

        return (
          <div
            key={i}
            className={`w-14 h-14 flex items-center justify-center text-2xl font-bold border-2 rounded transition-all duration-300 ${
              filled
                ? 'border-zinc-600 bg-zinc-800'
                : 'border-zinc-700'
            } ${style || (filled ? '' : '')}`}
            style={{
              perspective: '1000px',
              transformStyle: 'preserve-3d',
            }}
          >
            <span>{char}</span>
          </div>
        );
      })}
    </div>
  );
}
