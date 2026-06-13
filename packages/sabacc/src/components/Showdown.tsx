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
      className="flex flex-col items-center gap-2 rounded-2xl bg-ink-950/65 px-6 py-4 text-center ring-1 ring-brass/35 shadow-lamp backdrop-blur"
    >
      <span className="text-[0.65rem] uppercase tracking-[0.2em] text-brass/75">Hand over</span>
      <div className="font-display text-xl font-semibold text-credit">
        {winners.length ? winners.map((w) => w.name).join(' & ') : 'No winner'}
      </div>
      {state.lastWinDescription && (
        <div className="text-sm text-parchment/80">{state.lastWinDescription}</div>
      )}

      {youHost ? (
        <button
          onClick={() => send?.({ type: 'start_hand' })}
          disabled={!enoughPlayers}
          className="mt-1 rounded-lg bg-brass px-5 py-2 font-semibold text-ink-950 transition hover:bg-brass-light disabled:opacity-40"
        >
          {enoughPlayers ? 'Deal next hand' : 'Need 2+ players'}
        </button>
      ) : (
        <div className="mt-1 text-xs text-parchment/55">Waiting for the host to deal…</div>
      )}
    </motion.div>
  );
}
