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
          className="absolute left-0 h-2 w-8 rounded-[50%] border border-black/40"
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
      className="flex items-end gap-5 rounded-2xl bg-ink-950/45 px-5 py-3 ring-1 ring-brass/20 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-1">
        <ChipStack amount={pots.main} color="linear-gradient(#f6cd86,#c98f1e)" />
        <span className="text-[0.6rem] uppercase tracking-widest text-parchment/55">Main Pot</span>
        <CountUp value={pots.main} className="font-display text-lg font-semibold tabular-nums text-credit" />
      </div>
      <div className="h-12 w-px bg-brass/20" />
      <div className="flex flex-col items-center gap-1">
        <ChipStack amount={pots.sabacc} color="linear-gradient(#e7a06a,#a85a32)" />
        <span className="text-[0.6rem] uppercase tracking-widest text-[#e7a06a]/70">Sabacc Pot</span>
        <CountUp value={pots.sabacc} className="font-display text-lg font-semibold tabular-nums text-[#e7a06a]" />
      </div>
    </motion.div>
  );
}
