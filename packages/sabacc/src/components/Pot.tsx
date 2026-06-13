import { motion } from 'framer-motion';
import { CountUp } from './CountUp';
import type { Pot as PotType } from '../types';

function ChipStack({ amount, color }: { amount: number; color: string }) {
  // A small visual stack that grows (capped) with the pot size.
  const chips = Math.max(0, Math.min(8, Math.round(amount / 4)));
  return (
    <div className="relative h-10 w-8">
      {Array.from({ length: chips }).map((_, i) => (
        <div
          key={i}
          className="absolute left-0 h-2 w-8 rounded-[50%] border border-black/30"
          style={{ bottom: i * 3, background: color }}
        />
      ))}
    </div>
  );
}

export function Pot({ pots }: { pots: PotType }) {
  return (
    <motion.div
      layout
      className="flex items-end gap-5 rounded-2xl bg-black/30 px-5 py-3 ring-1 ring-emerald-300/15 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-1">
        <ChipStack amount={pots.main} color="linear-gradient(#fbbf24,#d97706)" />
        <span className="text-[0.6rem] uppercase tracking-widest text-emerald-200/60">Main Pot</span>
        <CountUp value={pots.main} className="text-lg font-bold tabular-nums text-credit" />
      </div>
      <div className="h-12 w-px bg-emerald-300/15" />
      <div className="flex flex-col items-center gap-1">
        <ChipStack amount={pots.sabacc} color="linear-gradient(#38bdf8,#0369a1)" />
        <span className="text-[0.6rem] uppercase tracking-widest text-sky-200/60">Sabacc Pot</span>
        <CountUp value={pots.sabacc} className="text-lg font-bold tabular-nums text-sky-300" />
      </div>
    </motion.div>
  );
}
