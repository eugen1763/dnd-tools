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
        className="rounded-full bg-black/30 px-3 py-1 text-xs text-emerald-100/80 ring-1 ring-emerald-300/20 hover:bg-black/50"
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
              className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-felt-800 p-5 ring-1 ring-emerald-300/20"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold">Corellian Spike Sabacc</h2>
              <p className="mt-1 text-sm text-emerald-100/70">
                Build a hand summing as close to <b>zero</b> as possible. Each hand is 3 rounds of
                Card → Bet → Dice. Best hand wins the Main Pot; an exact zero also wins the Sabacc Pot.
              </p>
              <h3 className="mt-4 text-sm font-semibold uppercase tracking-wide text-emerald-200/70">
                Hand ranking (best → worst)
              </h3>
              <ol className="mt-2 space-y-1 text-sm">
                {RANKINGS.map((r, i) => (
                  <li key={r.name} className="flex justify-between gap-3 rounded px-2 py-1 odd:bg-black/15">
                    <span className="font-medium">
                      {i + 1}. {r.name}
                    </span>
                    <span className="text-emerald-100/60">{r.detail}</span>
                  </li>
                ))}
              </ol>
              <button
                onClick={() => setOpen(false)}
                className="mt-5 w-full rounded-lg bg-emerald-600 py-2 font-semibold hover:bg-emerald-500"
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
