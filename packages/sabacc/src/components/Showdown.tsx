import { motion } from 'framer-motion';
import { useStore } from '../store';

/** Centre-of-table result card shown after a hand resolves. */
export function Showdown() {
  const state = useStore((s) => s.state)!;
  const youId = useStore((s) => s.youId);
  const send = useStore((s) => s.send);

  const winners = state.players.filter((p) => state.lastWinnerIds.includes(p.id));
  const youHost = !!youId && state.hostId === youId;
  const enoughPlayers = state.players.filter((p) => p.credits > 0).length >= state.config.minPlayers;

  return (
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="flex flex-col items-center gap-2 rounded-2xl bg-black/55 px-6 py-4 text-center ring-1 ring-amber-300/30 backdrop-blur"
    >
      <span className="text-[0.65rem] uppercase tracking-[0.2em] text-amber-200/70">Hand over</span>
      <div className="text-lg font-bold text-credit">
        {winners.length ? winners.map((w) => w.name).join(' & ') : 'No winner'}
      </div>
      {state.lastWinDescription && (
        <div className="text-sm text-emerald-100/80">{state.lastWinDescription}</div>
      )}

      {youHost ? (
        <button
          onClick={() => send?.({ type: 'start_hand' })}
          disabled={!enoughPlayers}
          className="mt-1 rounded-lg bg-emerald-500 px-5 py-2 font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
        >
          {enoughPlayers ? 'Deal next hand' : 'Need 2+ players'}
        </button>
      ) : (
        <div className="mt-1 text-xs text-emerald-100/60">Waiting for the host to deal…</div>
      )}
    </motion.div>
  );
}
