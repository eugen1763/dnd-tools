import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store';

function Btn({
  children,
  onClick,
  tone = 'neutral',
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'neutral' | 'go' | 'danger' | 'gold';
  disabled?: boolean;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-emerald-700 hover:bg-emerald-600',
    go: 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950',
    danger: 'bg-rose-700 hover:bg-rose-600',
    gold: 'bg-amber-500 hover:bg-amber-400 text-amber-950',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2 text-sm font-semibold shadow transition disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

export function Controls({
  swapMode,
  setSwapMode,
}: {
  swapMode: boolean;
  setSwapMode: (b: boolean) => void;
}) {
  const state = useStore((s) => s.state);
  const send = useStore((s) => s.send);
  const youId = useStore((s) => s.youId);

  const opts = state?.you?.legalActions ?? {};
  const isYourTurn = !!state && state.actorId === youId;

  const minTo = opts.minRaiseTo ?? 0;
  const maxTo = opts.maxBetTo ?? 0;
  const [amount, setAmount] = useState(minTo);

  useEffect(() => {
    setAmount((a) => Math.min(Math.max(a, minTo), Math.max(minTo, maxTo)));
  }, [minTo, maxTo]);

  if (!state || !send) return null;
  if (!isYourTurn) return null;

  const card = opts.card;
  const bet = opts.bet;

  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-black/55 px-4 py-3 ring-1 ring-emerald-300/25 backdrop-blur"
    >
      {card && (
        <>
          {card.includes('stand') && (
            <Btn onClick={() => send({ type: 'card_action', action: 'stand' })}>Stand</Btn>
          )}
          {card.includes('gain') && (
            <Btn tone="go" onClick={() => send({ type: 'card_action', action: 'gain' })}>
              Gain (draw)
            </Btn>
          )}
          {card.includes('swap') && (
            <Btn
              tone={swapMode ? 'gold' : 'neutral'}
              onClick={() => setSwapMode(!swapMode)}
            >
              {swapMode ? 'Tap a card to swap…' : 'Swap'}
            </Btn>
          )}
        </>
      )}

      {bet && (
        <>
          {bet.includes('fold') && (
            <Btn tone="danger" onClick={() => send({ type: 'bet_action', action: 'fold' })}>
              Fold
            </Btn>
          )}
          {bet.includes('check') && (
            <Btn onClick={() => send({ type: 'bet_action', action: 'check' })}>Check</Btn>
          )}
          {bet.includes('call') && (
            <Btn tone="go" onClick={() => send({ type: 'bet_action', action: 'call' })}>
              Call {opts.toCall}
            </Btn>
          )}
          {(bet.includes('bet') || bet.includes('raise')) && maxTo > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-black/30 px-3 py-1.5">
              <input
                type="range"
                min={minTo}
                max={Math.max(minTo, maxTo)}
                value={amount}
                onChange={(e) => setAmount(parseInt(e.target.value, 10))}
                className="accent-amber-400"
              />
              <span className="w-10 text-center text-sm font-bold tabular-nums text-credit">{amount}</span>
              <Btn
                tone="gold"
                onClick={() =>
                  send({
                    type: 'bet_action',
                    action: bet.includes('raise') ? 'raise' : 'bet',
                    amount,
                  })
                }
              >
                {bet.includes('raise') ? 'Raise to' : 'Bet'}
              </Btn>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
