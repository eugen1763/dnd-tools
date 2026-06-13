import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store';

export function JoinScreen() {
  const send = useStore((s) => s.send);
  const state = useStore((s) => s.state);
  const joinError = useStore((s) => s.joinError);

  const [name, setName] = useState('');
  const [credits, setCredits] = useState('100');

  const tableFull = !!state && state.players.length >= state.config.maxPlayers;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!send) return;
    send({ type: 'join', name: name.trim(), credits: parseInt(credits, 10) || 0 });
  }

  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm rounded-2xl bg-felt-800/90 p-6 ring-1 ring-emerald-300/20 shadow-xl"
      >
        <h1 className="text-center text-2xl font-bold tracking-tight">Sabacc</h1>
        <p className="mt-1 text-center text-sm text-emerald-100/70">Corellian Spike — take a seat at the table</p>

        {state && (
          <div className="mt-4 flex justify-center gap-4 text-xs text-emerald-100/60">
            <span>
              Seats: {state.players.length}/{state.config.maxPlayers}
            </span>
            <span>
              Ante: {state.config.anteMain} (+{state.config.anteSabacc})
            </span>
          </div>
        )}

        <label className="mt-5 block text-sm font-medium text-emerald-100/80">Your name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          autoFocus
          placeholder="Han Solo"
          className="mt-1 w-full rounded-lg border border-emerald-300/20 bg-black/30 px-3 py-2 outline-none focus:border-emerald-400"
        />

        <label className="mt-4 block text-sm font-medium text-emerald-100/80">Starting credits</label>
        <input
          value={credits}
          onChange={(e) => setCredits(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          className="mt-1 w-full rounded-lg border border-emerald-300/20 bg-black/30 px-3 py-2 tabular-nums outline-none focus:border-emerald-400"
        />

        {joinError && <p className="mt-3 text-sm text-rose-400">{joinError}</p>}

        <button
          type="submit"
          disabled={!send || tableFull || !name.trim() || !(parseInt(credits, 10) > 0)}
          className="mt-5 w-full rounded-lg bg-emerald-600 py-2.5 font-semibold transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {tableFull ? 'Table is full' : 'Sit down'}
        </button>
      </motion.form>
    </div>
  );
}
