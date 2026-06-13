import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store';
import { CountUp } from './CountUp';
import { PlayingCard } from './PlayingCard';
import type { PlayerView } from '../types';

function StatusBadge({ player, isActor }: { player: PlayerView; isActor: boolean }) {
  if (!player.connected) return <Tag className="bg-ink-700/80 text-parchment/60">away</Tag>;
  if (player.status === 'folded') return <Tag className="bg-ink-700/80 text-parchment/55">folded</Tag>;
  if (player.status === 'allIn') return <Tag className="bg-ember/85 text-ink-950">all-in</Tag>;
  if (isActor) return <Tag className="bg-brass text-ink-950">to act</Tag>;
  if (player.stood) return <Tag className="bg-oxblood/70 text-parchment">stood</Tag>;
  return null;
}

function Tag({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider ${className}`}>
      {children}
    </span>
  );
}

function FloatingDeltas({ playerId }: { playerId: string }) {
  const floats = useStore((s) => s.floatingDeltas).filter((d) => d.playerId === playerId);
  const dismiss = useStore((s) => s.dismissDelta);
  return (
    <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2">
      <AnimatePresence>
        {floats.map((d) => (
          <motion.div
            key={d.id}
            initial={{ y: 0, opacity: 0, scale: 0.8 }}
            animate={{ y: -46, opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            onAnimationComplete={() => dismiss(d.id)}
            className={`absolute whitespace-nowrap font-display text-base font-semibold tabular-nums drop-shadow ${
              d.amount >= 0 ? 'text-brass-light' : 'text-ember'
            }`}
          >
            {d.amount >= 0 ? '+' : ''}
            {d.amount}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function PlayerSeat({
  player,
  isYou,
  isActor,
  isDealer,
  isWinner,
  swapMode,
  setSwapMode,
}: {
  player: PlayerView;
  isYou: boolean;
  isActor: boolean;
  isDealer: boolean;
  isWinner: boolean;
  swapMode: boolean;
  setSwapMode: (b: boolean) => void;
}) {
  const send = useStore((s) => s.send);
  const cardSize = isYou ? 'lg' : 'sm';

  function onCardClick(cardId: string) {
    if (!isYou || !swapMode || !send) return;
    send({ type: 'card_action', action: 'swap', cardId });
    setSwapMode(false);
  }

  const faceUpCards = player.hand;
  const downCount = player.handCount;

  return (
    <div className="relative flex flex-col items-center gap-1.5">
      <FloatingDeltas playerId={player.id} />

      {/* Cards */}
      <div className="flex justify-center" style={{ minHeight: isYou ? 112 : 58 }}>
        {faceUpCards
          ? faceUpCards.map((c, i) => (
              <div
                key={c.id}
                onClick={() => onCardClick(c.id)}
                style={{ marginLeft: i === 0 ? 0 : -12 }}
                className={isYou && swapMode ? 'cursor-pointer transition-transform hover:-translate-y-2' : ''}
              >
                <PlayingCard card={c} faceUp size={cardSize} />
              </div>
            ))
          : Array.from({ length: downCount }).map((_, i) => (
              <div key={i} style={{ marginLeft: i === 0 ? 0 : -12 }}>
                <PlayingCard faceUp={false} size={cardSize} />
              </div>
            ))}
      </div>

      {/* Name plate */}
      <motion.div
        animate={isActor ? { scale: 1.04 } : { scale: 1 }}
        className={`relative min-w-[7.5rem] rounded-xl px-3 py-1.5 text-center ring-1 ${
          isWinner
            ? 'bg-brass/20 ring-brass'
            : isActor
            ? 'bg-ink-900/60 ring-brass animate-turnPulse'
            : 'bg-ink-900/55 ring-brass/15'
        }`}
      >
        {isDealer && (
          <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-parchment text-[0.6rem] font-bold text-ink-900 ring-1 ring-brass/40">
            D
          </span>
        )}
        <div className="flex items-center justify-center gap-1">
          <span className="max-w-[7rem] truncate text-sm font-semibold text-parchment">
            {player.name}
            {isYou && <span className="text-brass/80"> (you)</span>}
          </span>
          {player.isHost && <span title="Host" className="text-[0.7rem]">👑</span>}
        </div>
        <div className="font-display text-base font-semibold tabular-nums text-credit">
          <CountUp value={player.credits} /> <span className="text-[0.6rem] font-normal text-parchment/45">cr</span>
        </div>
        <div className="mt-0.5 flex min-h-[1rem] items-center justify-center gap-1">
          <StatusBadge player={player} isActor={isActor} />
          {player.currentBet > 0 && (
            <span className="rounded-full bg-brass/15 px-2 py-0.5 text-[0.6rem] font-semibold text-brass-light">
              bet {player.currentBet}
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}
