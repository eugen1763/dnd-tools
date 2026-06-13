import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store';
import { PlayerSeat } from './PlayerSeat';
import { Pot } from './Pot';
import { Dice } from './Dice';
import { Controls } from './Controls';
import { Showdown } from './Showdown';
import { HandRankingsHelp } from './HandRankingsHelp';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Lobby',
  card: 'Card phase',
  betting: 'Betting',
  dice: 'Dice',
  showdown: 'Showdown',
  handOver: 'Hand over',
};

export function Table() {
  const state = useStore((s) => s.state)!;
  const youId = useStore((s) => s.youId);
  const send = useStore((s) => s.send);
  const diceNonce = useStore((s) => s.diceNonce);
  const shiftNonce = useStore((s) => s.shiftNonce);
  const errorMsg = useStore((s) => s.errorMsg);
  const clearError = useStore((s) => s.clearError);

  const [swapMode, setSwapMode] = useState(false);

  // Drop swap mode whenever it stops being our card-phase turn.
  useEffect(() => {
    const myTurnCard = state.actorId === youId && state.phase === 'card';
    if (!myTurnCard && swapMode) setSwapMode(false);
  }, [state.actorId, state.phase, youId, swapMode]);

  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(clearError, 3000);
    return () => clearTimeout(t);
  }, [errorMsg, clearError]);

  const seats = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  const youIdx = Math.max(0, seats.findIndex((p) => p.id === youId));
  const len = seats.length;

  const inPlay = state.phase === 'card' || state.phase === 'betting' || state.phase === 'dice';
  const isOver = state.phase === 'showdown' || state.phase === 'handOver';
  const isLobby = state.phase === 'lobby';

  const youHost = !!youId && state.hostId === youId;
  const enoughPlayers = state.players.filter((p) => p.credits > 0).length >= state.config.minPlayers;

  return (
    <div className="scene-3d relative h-full w-full select-none overflow-hidden">
      {/* Top bar */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-4 py-3">
        <div className="text-sm text-parchment/85">
          <span className="font-display text-base font-semibold tracking-wide text-brass-light">Sabacc</span>
          {state.handNumber > 0 && <span className="text-parchment/45"> · Hand {state.handNumber}</span>}
        </div>
        <div className="rounded-full bg-ink-900/70 px-3 py-1 text-xs font-medium text-parchment/80 ring-1 ring-brass/20">
          {PHASE_LABEL[state.phase] ?? state.phase}
          {inPlay && state.round ? ` · Round ${state.round}/3` : ''}
        </div>
        <HandRankingsHelp />
      </div>

      {/* Worn leather table + seats */}
      <div
        className="absolute inset-x-2 bottom-2 top-14 rounded-[48%] border border-brass/15"
        style={{
          background: 'radial-gradient(62% 62% at 50% 42%, #8a3f31 0%, #5e2823 52%, #3a1813 80%, #2a110f 100%)',
          boxShadow: 'inset 0 0 90px rgba(0,0,0,0.6), inset 0 0 0 6px rgba(226,169,81,0.06)',
          transform: 'rotateX(6deg)',
        }}
      />

      {seats.map((p) => {
        const pos = ((seats.indexOf(p) - youIdx + len) % len) / len;
        const theta = pos * Math.PI * 2;
        const x = 50 + 38 * Math.sin(theta);
        const y = 56 + 33 * Math.cos(theta);
        return (
          <div
            key={p.id}
            className="absolute z-10"
            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
          >
            <PlayerSeat
              player={p}
              isYou={p.id === youId}
              isActor={state.actorId === p.id}
              isDealer={p.seatIndex === state.dealerSeatIndex && state.handNumber > 0}
              isWinner={isOver && state.lastWinnerIds.includes(p.id)}
              swapMode={swapMode}
              setSwapMode={setSwapMode}
            />
          </div>
        );
      })}

      {/* Centre of the table */}
      <div className="absolute left-1/2 top-[42%] z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
        {(inPlay || isOver) && (state.pots.main > 0 || state.pots.sabacc > 0) && <Pot pots={state.pots} />}
        {inPlay && <Dice dice={state.dice} nonce={diceNonce} />}
        {isOver && <Showdown />}
        {isLobby && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-2 rounded-2xl bg-ink-900/60 px-6 py-4 text-center ring-1 ring-brass/20 shadow-lamp"
          >
            <span className="text-[0.65rem] uppercase tracking-[0.2em] text-brass/75">Waiting to start</span>
            <span className="text-sm text-parchment/80">
              {state.players.length} player{state.players.length === 1 ? '' : 's'} at the table
            </span>
            {youHost ? (
              <button
                onClick={() => send?.({ type: 'start_hand' })}
                disabled={!enoughPlayers}
                className="rounded-lg bg-brass px-5 py-2 font-semibold text-ink-950 transition hover:bg-brass-light disabled:opacity-40"
              >
                {enoughPlayers ? 'Deal first hand' : 'Need 2+ players'}
              </button>
            ) : (
              <span className="text-xs text-parchment/55">Waiting for the host…</span>
            )}
          </motion.div>
        )}
      </div>

      {/* Controls dock */}
      <div className="pointer-events-none absolute bottom-3 left-0 right-0 z-30 flex justify-center px-3">
        <Controls swapMode={swapMode} setSwapMode={setSwapMode} />
      </div>

      {/* Sabacc-shift flash */}
      {shiftNonce > 0 && (
        <div
          key={shiftNonce}
          className="animate-shiftFlash pointer-events-none absolute inset-0 z-40"
          style={{ background: 'radial-gradient(circle at 50% 45%, rgba(226,169,81,0.5), transparent 60%)' }}
        />
      )}

      {/* Error toast */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute left-1/2 top-16 z-50 -translate-x-1/2 rounded-lg bg-ember px-4 py-2 text-sm text-ink-950 shadow-lg"
          >
            {errorMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
