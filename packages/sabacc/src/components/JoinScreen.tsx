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
        className="w-full max-w-sm rounded-2xl bg-ink-900/85 p-6 ring-1 ring-brass/25 shadow-lamp backdrop-blur-sm"
      >
        <h1 className="text-center font-display text-3xl font-semibold tracking-tight text-brass-light">Sabacc</h1>
        <p className="mt-1 text-center text-sm text-parchment/70">Corellian Spike — pull up a chair</p>

        {state && (
          <div className="mt-4 flex justify-center gap-4 text-xs text-parchment/55">
            <span>
              Seats: {state.players.length}/{state.config.maxPlayers}
            </span>
            <span>
              Ante: {state.config.anteMain} (+{state.config.anteSabacc})
            </span>
          </div>
        )}

        <label className="mt-5 block text-sm font-medium text-parchment/80">Your name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          autoFocus
          placeholder="Han Solo"
          className="mt-1 w-full rounded-lg border border-brass/20 bg-ink-950/60 px-3 py-2 text-parchment placeholder:text-parchment/30 outline-none focus:border-brass"
        />

        <label className="mt-4 block text-sm font-medium text-parchment/80">Starting credits</label>
        <input
          value={credits}
          onChange={(e) => setCredits(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          className="mt-1 w-full rounded-lg border border-brass/20 bg-ink-950/60 px-3 py-2 tabular-nums text-parchment outline-none focus:border-brass"
        />

        {joinError && <p className="mt-3 text-sm text-ember">{joinError}</p>}

        <button
          type="submit"
          disabled={!send || tableFull || !name.trim() || !(parseInt(credits, 10) > 0)}
          className="mt-5 w-full rounded-lg bg-brass py-2.5 font-semibold text-ink-950 transition hover:bg-brass-light disabled:cursor-not-allowed disabled:opacity-40"
        >
          {tableFull ? 'Table is full' : 'Sit down'}
        </button>
      </motion.form>
    </div>
  );
}
