interface GameOverModalProps {
  gameState: 'won' | 'lost';
  secret: string;
}

export function GameOverModal({ gameState, secret }: GameOverModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center max-w-sm w-full mx-4"
        style={{ fontFamily: 'Geist Sans, sans-serif' }}
      >
        <h2 className="text-3xl font-bold text-zinc-50 mb-2">
          {gameState === 'won' ? 'You Won!' : 'Game Over!'}
        </h2>
        {gameState === 'lost' && (
          <p className="text-zinc-400 text-lg mb-6">
            The answer was{' '}
            <span className="font-bold text-zinc-50">{secret}</span>
          </p>
        )}
        <button
          onClick={() => window.location.reload()}
          className="mt-6 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 font-semibold rounded-lg transition-colors duration-150"
        >
          Play Again
        </button>
      </div>
    </div>
  );
}
