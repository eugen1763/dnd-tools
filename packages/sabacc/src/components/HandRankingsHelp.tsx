import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const RANKINGS: { name: string; detail: string }[] = [
  { name: 'Pure Sabacc', detail: 'Two Sylops (0, 0)' },
  { name: 'Full Sabacc', detail: '+10, +10, -10, -10, Sylop' },
  { name: 'Fleet', detail: 'Four of a kind + Sylop' },
  { name: 'Yee-Haa', detail: 'One pair + Sylop' },
  { name: 'Rhylet', detail: 'Three of a kind + a pair' },
  { name: 'Squadron', detail: 'Four of a kind' },
  { name: 'Gee Whiz', detail: '+1,+2,+3,+4,-10 (or mirror)' },
  { name: 'Straight Khyron', detail: 'Run of 4 consecutive values' },
  { name: "Bantha's Wild", detail: 'Three of a kind' },
  { name: 'Rule of Two', detail: 'Two pairs' },
  { name: 'Sabacc', detail: 'One pair (sums to 0)' },
];

export function HandRankingsHelp() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-ink-900/70 px-3 py-1 text-xs text-parchment/80 ring-1 ring-brass/20 hover:bg-ink-800"
      >
        Hands &amp; Rules
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-ink-900 p-5 ring-1 ring-brass/25 shadow-lamp"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="font-display text-xl font-semibold text-brass-light">Corellian Spike Sabacc</h2>
              <p className="mt-1 text-sm text-parchment/70">
                Build a hand summing as close to <b>zero</b> as possible. Each hand is 3 rounds of
                Card → Bet → Dice. Best hand wins the Main Pot; an exact zero also wins the Sabacc Pot.
              </p>
              <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-brass/75">
                Hand ranking (best → worst)
              </h3>
              <ol className="mt-2 space-y-1 text-sm">
                {RANKINGS.map((r, i) => (
                  <li key={r.name} className="flex justify-between gap-3 rounded px-2 py-1 odd:bg-ink-950/40">
                    <span className="font-medium text-parchment">
                      {i + 1}. {r.name}
                    </span>
                    <span className="text-parchment/55">{r.detail}</span>
                  </li>
                ))}
              </ol>
              <button
                onClick={() => setOpen(false)}
                className="mt-5 w-full rounded-lg bg-brass py-2 font-semibold text-ink-950 hover:bg-brass-light"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
