import { motion } from 'framer-motion';
import type { DiceState, DiceSymbol } from '../types';

const GLYPH: Record<DiceSymbol, string> = {
  circle: '●',
  triangle: '▲',
  square: '■',
  sylop: '✦',
  starbird: '★',
  krayt: '☄',
};

function Die({ symbol, nonce, delay }: { symbol: DiceSymbol; nonce: number; delay: number }) {
  return (
    <motion.div
      key={`${nonce}-${delay}`}
      initial={{ rotate: -120, scale: 0.6, opacity: 0.4 }}
      animate={{ rotate: 0, scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 14, delay }}
      className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#f3e7cf] text-2xl text-ink-900 shadow-md ring-1 ring-black/20"
    >
      {GLYPH[symbol]}
    </motion.div>
  );
}

export function Dice({ dice, nonce }: { dice: DiceState; nonce: number }) {
  if (!dice.rolled || !dice.faces) return null;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-2">
        <Die symbol={dice.faces[0]} nonce={nonce} delay={0} />
        <Die symbol={dice.faces[1]} nonce={nonce} delay={0.08} />
      </div>
      {dice.isMatch && (
        <motion.span
          key={`match-${nonce}`}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="rounded-full bg-brass px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-widest text-ink-950"
        >
          Sabacc Shift!
        </motion.span>
      )}
    </div>
  );
}
