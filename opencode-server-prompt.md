# DnD Tools — Step 2: Backend Server + Discord Bot

Build a Bun Elysia backend server with game state management and a Discord.js v14 bot at `/home/finn/code/dnd-tools/`.

## Architecture

The server runs on port 3000. The wordle game is already built at `packages/wordle/dist/` and needs to be served statically. The Discord bot connects via WebSocket to Discord and registers slash commands.

## Files to Create

### 1. `apps/server/package.json`
```json
{
  "name": "@dnd-tools/server",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts"
  },
  "dependencies": {
    "elysia": "^1.2.0",
    "discord.js": "^14.18.0",
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "bun-types": "^1.1.0"
  }
}
```

### 2. `apps/server/tsconfig.json`
Standard strict TypeScript config for Bun. `"types": ["bun-types"]`

### 3. `apps/server/src/store.ts`
In-memory game state store:

```typescript
import { nanoid } from 'nanoid';

export type GameMode = 'numbers' | 'letters' | 'mixed';

export interface GameState {
  secret: string;
  tries: number;
  mode: GameMode;
  createdAt: Date;
}

const games = new Map<string, GameState>();

export function createGame(secret: string, tries: number = 6): { id: string; url: string } {
  // Auto-detect mode
  const mode: GameMode = /^\d+$/.test(secret) ? 'numbers' : /^[a-zA-Z]+$/.test(secret) ? 'letters' : 'mixed';
  
  const id = nanoid(10);
  games.set(id, { secret: secret.toUpperCase(), tries, mode, createdAt: new Date() });
  
  return { id, url: `/wordle/${id}` };
}

export function getGame(id: string): GameState | undefined {
  return games.get(id);
}
```

### 4. `apps/server/src/index.ts`
Main Elysia server:

```typescript
import { Elysia } from 'elysia';
import { staticPlugin } from '@elysiajs/static';  // Wait — Elysia 1.x has built-in static serving
import { createGame, getGame } from './store';

// Actually for Elysia 1.x, use Elysia.static or serve manually
// Let me use the built-in Bun.serve approach or Elysia with manual handling

import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';

const app = new Elysia()
  .use(cors())
  
  // API routes
  .post('/api/games', ({ body }) => {
    const { secret, tries } = body as { secret: string; tries?: number };
    if (!secret || secret.length < 1) {
      return new Response('Missing secret', { status: 400 });
    }
    const game = createGame(secret, tries);
    return { id: game.id, url: game.url };
  })
  
  .get('/api/games/:id', ({ params: { id } }) => {
    const game = getGame(id);
    if (!game) return new Response('Game not found', { status: 404 });
    return { secret: game.secret, tries: game.tries, mode: game.mode };
  })
  
  // Serve wordle static files
  .get('/wordle/*', ({ params: { '*': path } }) => {
    // Actually we need to serve the SPA for wordle routes
    // The wordle SPA at packages/wordle/dist/ should be served
    // For any /wordle/xyz route, serve index.html (SPA fallback)
  })
  
  .listen(3000);

console.log(`🦊 Server running at http://localhost:3000`);
```

Actually, let me think about this more carefully. I need to:
1. Serve the wordle dist folder for `/wordle/` routes
2. Handle SPA routing (always serve index.html for /wordle/* routes)
3. API routes

For Elysia 1.x, I can use the static plugin. Or I can use Bun.serve directly.

Let me go with a simpler approach using Elysia properly.

### Server Implementation

Use Elysia with `@elysiajs/static` for serving static files and `@elysiajs/cors` for CORS.

Actually, let me check what @elysiajs/static does. For Elysia 1.x, static file serving can be done with:

```typescript
import { staticPlugin } from '@elysiajs/static';
import { Elysia } from 'elysia';

app.use(
  staticPlugin({
    assets: path.join(import.meta.dir, '../../packages/wordle/dist'),
    prefix: '/wordle'
  })
);
```

But this won't handle SPA fallback (serving index.html for unknown paths under /wordle/).

Better approach: serve statically and add a fallback route that catches all /wordle/* paths and returns index.html.

Actually, the simplest approach: serve the wordle SPA at `/` during development, and use API routes. Since the actual deployment will use nginx or similar to route.

Let me do it clean:

```
GET  /api/games           → list games
POST /api/games           → create game
GET  /api/games/:id       → get game details
GET  /wordle/:id          → serve wordle SPA (index.html)
```

The wordle frontend, when loaded at `/wordle/:id`, will fetch `/api/games/:id` to get the game config.

Let me just write this out in the opencode prompt.

### Discord Bot

The bot needs:
1. Log in via Discord token (from env var: `DISCORD_TOKEN`)
2. Register a slash command: `/game create wordle [secret] [tries]`
3. When the command is used:
   - Call POST /api/games on the local server
   - Reply with a Discord embed containing the game link

### Env vars
```
DISCORD_TOKEN=your_bot_token_here
PORT=3000
```

## What to build

Create these files in apps/server/:

### `apps/server/package.json`
With elysia, @elysiajs/cors, @elysiajs/static, discord.js, nanoid

### `apps/server/tsconfig.json`
Strict TS for Bun

### `apps/server/src/store.ts`
In-memory game store (as described above)

### `apps/server/src/index.ts`
Elysia server with:
- POST /api/games → creates a game
- GET /api/games/:id → returns game details
- GET /wordle/:id → serves wordle SPA (index.html for all /wordle/* paths)
- Also serves / to show a simple landing page

For serving the wordle SPA:
```typescript
import { readFileSync } from 'fs';
import path from 'path';

const wordleDist = path.join(import.meta.dir, '../../packages/wordle/dist');
const wordleHtml = readFileSync(path.join(wordleDist, 'index.html'), 'utf-8');

// In Elysia:
app.get('/wordle/*', () => {
  return new Response(wordleHtml, {
    headers: { 'Content-Type': 'text/html' }
  });
});
```

Also serve static assets from the wordle dist folder:
```typescript
app.get('/assets/*', ({ params: { '*': filepath } }) => {
  const file = Bun.file(path.join(wordleDist, 'assets', filepath));
  if (await file.exists()) return file;
  return new Response('Not found', { status: 404 });
});
```

### `apps/server/src/discord.ts`
Discord.js v14 bot:
- Uses Client with GatewayIntentBits.Guilds
- On ready, registers slash command:
  ```ts
  const command = new SlashCommandBuilder()
    .setName('game')
    .setDescription('DnD game commands')
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a new game')
      .addStringOption(opt => opt
        .setName('type')
        .setDescription('Game type')
        .setRequired(true)
        .addChoices({ name: 'wordle', value: 'wordle' })
      )
      .addStringOption(opt => opt
        .setName('secret')
        .setDescription('The word/number to guess')
        .setRequired(true)
      )
      .addIntegerOption(opt => opt
        .setName('tries')
        .setDescription('Number of allowed guesses')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(20)
      )
    );
  ```
- On interactionCreate:
  - If it's the /game create wordle command:
    - Extract secret and tries
    - Call POST /api/games (localhost:3000)
    - Reply with an embed:
      - Title: "🎲 Wordle Game Created!"
      - Fields: Mode (auto-detected), Tries, Link
      - Color: Discord green
      - "Share this link with your players!"

### `apps/server/src/env.ts`
Load environment variables:
```typescript
export const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
export const PORT = parseInt(process.env.PORT || '3000');

if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN environment variable is required');
  process.exit(1);
}
```

### Root `package.json` update
Add a script: `"dev": "bun run --watch apps/server/src/index.ts"`
Update the build:wordle script to output to `apps/server/public/wordle/` or just read from packages/wordle/dist.

## Verify
1. `bun install` at root
2. `bun run dev` starts the server
3. Server responds at localhost:3000 with API routes
4. Bot logs in (won't fully work without DISCORD_TOKEN, but should start)

Note: The wordle frontend should be accessible at /wordle/:gameId. When no gameId is given, it should show a default random wordle game for testing.
