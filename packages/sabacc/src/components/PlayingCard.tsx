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

// An heirloom deck: warm parchment faces with indigo ink for positives, oxblood
// for negatives, and a gilt face for the special Sylop.
function toneClasses(card: Card): string {
  if (card.kind === 'sylop') return 'from-[#f7d98a] to-[#dca23f] text-[#4a2f12] ring-[#f0d090]';
  if (card.value > 0) return 'from-[#f6ecd6] to-[#e7d4af] text-[#2d3a63] ring-[#caa15f]';
  return 'from-[#f6ecd6] to-[#e7d4af] text-[#8a2b22] ring-[#caa15f]';
}

function CardFront({ card, size }: { card: Card; size: Size }) {
  const glyph = card.kind === 'sylop' ? '✦' : SUIT_GLYPH[card.suit ?? 'circle'];
  const label = card.kind === 'sylop' ? '0' : `${card.value > 0 ? '+' : ''}${card.value}`;
  return (
    <div
      className={`backface-hidden absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-gradient-to-br font-display ring-1 shadow-md ${toneClasses(
        card,
      )}`}
    >
      <span className="absolute left-1 top-0.5 leading-none">{glyph}</span>
      <span className="absolute bottom-0.5 right-1 rotate-180 leading-none">{glyph}</span>
      <span className={`font-semibold tabular-nums ${VALUE_SIZE[size]}`}>{label}</span>
      {card.kind === 'sylop' && <span className="mt-0.5 text-[0.55em] font-semibold uppercase tracking-wider">Sylop</span>}
    </div>
  );
}

function CardBack() {
  return (
    <div
      className="backface-hidden absolute inset-0 rounded-lg ring-1 ring-brass/40 shadow-md"
      style={{
        transform: 'rotateY(180deg)',
        background: 'repeating-linear-gradient(45deg, #5e2622 0 6px, #4a1d1a 6px 12px)',
      }}
    >
      <div className="absolute inset-1.5 rounded-md border border-brass/30 flex items-center justify-center">
        <span className="text-brass/60 text-lg">✦</span>
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
