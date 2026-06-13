import { motion } from 'framer-motion';
import type { Card, Suit } from '../types';

const SUIT_GLYPH: Record<Suit, string> = {
  circle: '●',
  triangle: '▲',
  square: '■',
};

type Size = 'sm' | 'md' | 'lg';
const SIZES: Record<Size, string> = {
  sm: 'w-10 h-[3.6rem] text-[0.6rem]',
  md: 'w-14 h-20 text-xs',
  lg: 'w-20 h-28 text-sm',
};
const VALUE_SIZE: Record<Size, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
};

function toneClasses(card: Card): string {
  if (card.kind === 'sylop') return 'from-amber-200 to-amber-400 text-amber-950 ring-amber-300';
  if (card.value > 0) return 'from-emerald-50 to-emerald-200 text-emerald-900 ring-emerald-300';
  return 'from-rose-50 to-rose-200 text-rose-900 ring-rose-300';
}

function CardFront({ card, size }: { card: Card; size: Size }) {
  const glyph = card.kind === 'sylop' ? '✦' : SUIT_GLYPH[card.suit ?? 'circle'];
  const label = card.kind === 'sylop' ? '0' : `${card.value > 0 ? '+' : ''}${card.value}`;
  return (
    <div
      className={`backface-hidden absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-gradient-to-br ring-1 shadow-md ${toneClasses(
        card,
      )}`}
    >
      <span className="absolute left-1 top-0.5 leading-none">{glyph}</span>
      <span className="absolute bottom-0.5 right-1 rotate-180 leading-none">{glyph}</span>
      <span className={`font-bold tabular-nums ${VALUE_SIZE[size]}`}>{label}</span>
      {card.kind === 'sylop' && <span className="mt-0.5 text-[0.55em] font-semibold uppercase tracking-wider">Sylop</span>}
    </div>
  );
}

function CardBack() {
  return (
    <div
      className="backface-hidden absolute inset-0 rounded-lg ring-1 ring-emerald-300/30 shadow-md"
      style={{
        transform: 'rotateY(180deg)',
        background:
          'repeating-linear-gradient(45deg, #134e3a 0 6px, #0c3528 6px 12px)',
      }}
    >
      <div className="absolute inset-1.5 rounded-md border border-emerald-300/20 flex items-center justify-center">
        <span className="text-emerald-200/40 text-lg">✦</span>
      </div>
    </div>
  );
}

export function PlayingCard({
  card,
  faceUp,
  size = 'md',
}: {
  card?: Card;
  faceUp: boolean;
  size?: Size;
}) {
  return (
    <div className={`scene-3d ${SIZES[size]}`}>
      <motion.div
        className="preserve-3d relative h-full w-full"
        initial={false}
        animate={{ rotateY: faceUp && card ? 0 : 180 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
      >
        {card && <CardFront card={card} size={size} />}
        <CardBack />
      </motion.div>
    </div>
  );
}
