# WebSocket Multiplayer for DnD Wordle

Add real-time multiplayer to the wordle game so multiple players on the same game link see each other's guesses instantly.

## Architecture

When a player opens `https://0x1763.dev/wordle/abc123`:
1. Frontend connects to `wss://0x1763.dev/ws/abc123`
2. Server sends full game state (all previous guesses)
3. When any player submits a guess, it goes via WebSocket
4. Server validates, computes result, broadcasts to all connected clients
5. New joiners get the full history

## Files to Modify

### 1. `apps/server/src/store.ts` — Add shared guesses storage

Add to `GameState`:
```typescript
export interface GuessResult {
  guess: string;
  result: LetterState[];
}

export interface GameState {
  secret: string;
  tries: number;
  mode: GameMode;
  createdAt: Date;
  guesses: GuessResult[];
}
```

Add functions:
```typescript
export function addGuessToGame(gameId: string, guess: string, result: LetterState[]): void
export function getGameGuesses(gameId: string): GuessResult[]
export function getGameState(gameId: string): GameState | undefined
```

Also export the `LetterState` type from word-utils or redefine it here.

### 2. `apps/server/src/index.ts` — Add WebSocket endpoint

Add `@elysiajs/websocket` dependency (or use Bun's built-in WebSocket).

Since Elysia 1.x has built-in WS support via `@elysiajs/websocket`:

```typescript
import { ws } from '@elysiajs/websocket';

// Track connected clients per game
const gameClients = new Map<string, Set<WebSocket>>();

const app = new Elysia()
  .use(cors())
  .use(ws({}))
  .ws('/ws/:gameId', {
    open(ws) {
      const { gameId } = ws.data.params;
      const game = getGame(gameId);
      
      if (!game) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game not found' }));
        ws.close();
        return;
      }
      
      // Track this client
      if (!gameClients.has(gameId)) {
        gameClients.set(gameId, new Set());
      }
      gameClients.get(gameId)!.add(ws.raw);
      
      // Send full current state to new joiner
      ws.send(JSON.stringify({
        type: 'state',
        secret: game.secret,
        tries: game.tries,
        mode: game.mode,
        guesses: game.guesses,
        playerCount: gameClients.get(gameId)!.size,
      }));
      
      // Broadcast updated player count
      broadcastToGame(gameId, {
        type: 'player_count',
        count: gameClients.get(gameId)!.size,
      }, ws.raw);
    },
    message(ws, rawMessage) {
      const { gameId } = ws.data.params;
      const data = JSON.parse(rawMessage as string);
      
      if (data.type === 'guess') {
        const game = getGame(gameId);
        if (!game) return;
        
        // Check if game is already over
        if (game.guesses.length >= game.tries) return;
        
        // Check if already won
        const lastGuess = game.guesses[game.guesses.length - 1];
        if (lastGuess && lastGuess.guess === game.secret) return;
        
        const guess = data.guess.toUpperCase();
        
        // Validate guess length
        if (guess.length !== game.secret.length) return;
        
        // Compute result
        const result = computeGuess(guess, game.secret);
        
        // Store the guess
        addGuessToGame(gameId, guess, result);
        
        // Broadcast to ALL clients (including sender)
        const updatedGame = getGame(gameId);
        const clientSet = gameClients.get(gameId);
        broadcastToGame(gameId, {
          type: 'guess_result',
          guess,
          result,
          gameState: updatedGame!.guesses.length >= updatedGame!.tries ? 'lost' :
            result.every(r => r === 2) ? 'won' : 'playing',
          playerCount: clientSet ? clientSet.size : 0,
        });
      }
    },
    close(ws) {
      const { gameId } = ws.data.params;
      const clients = gameClients.get(gameId);
      if (clients) {
        clients.delete(ws.raw);
        if (clients.size === 0) {
          gameClients.delete(gameId);
        } else {
          broadcastToGame(gameId, {
            type: 'player_count',
            count: clients.size,
          });
        }
      }
    },
  })
  // ... rest of existing routes

// Helper function
function broadcastToGame(gameId: string, data: any, excludeWs?: WebSocket) {
  const clients = gameClients.get(gameId);
  if (!clients) return;
  const message = JSON.stringify(data);
  for (const client of clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
```

**Important**: For Elysia WS, check what API is available. Elysia 1.x uses `@elysiajs/websocket`. The `ws` method takes a path and handlers with `open`, `message`, `close`, `drain`. The `ws.raw` is the underlying WebSocket.

### 3. `packages/wordle/src/store.ts` — Add WebSocket-aware state

The store already has `addGuess` and `initGame`. I need to:
- Keep the existing local logic
- Add a way to apply remote guesses (skip validation since server already did it)
- Add connection status tracking

```typescript
export interface GameState {
  // ... existing fields
  connected: boolean;
  playerCount: number;
  applyRemoteGuess: (guess: string, result: LetterState[]) => void;
  setConnectionStatus: (connected: boolean) => void;
  setPlayerCount: (count: number) => void;
}
```

Add `applyRemoteGuess` which works like `addGuess` but takes pre-computed result (doesn't call computeGuess again).

### 4. `packages/wordle/src/App.tsx` — Add WebSocket connection

On mount, if there's a game ID:
1. Fetch game config via HTTP (existing)
2. Connect WebSocket to `wss://0x1763.dev/ws/${gameId}` (or `ws://` for local dev)
3. On `state` message: initialize game and populate all existing guesses
4. On `guess_result` message: apply the remote guess to the store
5. On `player_count` message: update count display
6. On local guess submission: send via WebSocket instead of just local

For the guess submission flow:
- User types a guess and presses Enter
- The guess is sent to the server via WebSocket: `{ type: "guess", guess: "TRAIN" }`
- The server validates, computes result, and broadcasts
- ALL clients (including sender) apply the result from the broadcast
- This ensures consistency

So `addGuessLetter` for Enter should:
1. If WebSocket is connected, send the guess via WS (don't call addGuess locally)
2. If WebSocket is NOT connected (offline), fall back to local addGuess

When a `guess_result` message arrives via WS:
1. Call `applyRemoteGuess(guess, result)` on the store

### 5. `packages/wordle/src/components/Header.tsx` — Show connection status

Add a small indicator:
- Green dot + "3 players" when connected
- Red dot + "Offline" when disconnected
- Gray dot + "Connecting..." during initial connection

## WS Messages Format

### Server → Client
```typescript
// Full state on connect
{ type: "state", secret: string, tries: number, mode: string, guesses: GuessResult[], playerCount: number }

// New guess broadcast
{ type: "guess_result", guess: string, result: number[], gameState: "playing"|"won"|"lost", playerCount: number }

// Player count update
{ type: "player_count", count: number }

// Error
{ type: "error", message: string }
```

### Client → Server
```typescript
// Submit a guess
{ type: "guess", guess: string }
```

## Implementation Order

1. Update `apps/server/src/store.ts` — add guesses array, addGuessToGame, etc.
2. Add `@elysiajs/websocket` to server deps and install
3. Update `apps/server/src/index.ts` — add WS endpoint
4. Update `packages/wordle/src/store.ts` — add applyRemoteGuess, connection status
5. Update `packages/wordle/src/App.tsx` — add WebSocket connection logic
6. Update `packages/wordle/src/components/Header.tsx` — add player count badge
7. Rebuild wordle, restart server, test

## Important Notes
- Use wss:// for production (same domain via Cloudflare), ws:// for local dev
- The WS URL should be dynamically determined based on the page protocol (window.location.protocol === 'https:' ? 'wss:' : 'ws:')
- All guess validation happens server-side; clients trust the server broadcast
- If WebSocket disconnects, fall back to local-only mode (show "Offline" indicator)
- LetterState enum values: Miss=0, Present=1, Match=2
- The secret is sent to clients in the initial state so they can display it at game end
- The `result` in `guess_result` is a number[] (LetterState values)
