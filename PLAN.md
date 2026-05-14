# DnD Tools — Implementation Plan

## Overview
DnD Tools is a suite of minigames for D&D sessions, hosted at `0x1763.dev`.
A Discord bot lets admins create games, and players join via generated links.

## Architecture

```
dnd-tools/
├── apps/
│   └── server/               # Bun Elysia web server (port 3000)
│       ├── src/
│       │   ├── index.ts      # Server entry — Elysia app
│       │   ├── discord.ts    # Discord bot (discord.js v14)
│       │   ├── store.ts      # In-memory game state store (Map<id, GameState>)
│       │   └── routes/
│       │       ├── games.ts  # Game CRUD routes
│       │       └── wordle.ts # Wordle-specific route (loads game config)
│       ├── public/
│       │   └── wordle/       # Built wordle static files (served by Elysia)
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   └── wordle/               # React wordle game (forked from nexxeln/nexdle)
│       ├── src/
│       │   ├── components/
│       │   │   ├── WordRow.tsx
│       │   │   ├── Keyboard.tsx
│       │   │   ├── Header.tsx
│       │   │   ├── Instructions.tsx
│       │   │   └── GameOverModal.tsx
│       │   ├── hooks/
│       │   │   ├── useGuess.ts
│       │   │   └── usePrevious.ts
│       │   ├── store.ts       # Zustand store — accepts config via URL params
│       │   ├── word-utils.ts  # Game logic — supports numbers/letters/mixed
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   └── index.css
│       ├── index.html
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       ├── postcss.config.js
│       └── tsconfig.json
├── package.json               # Workspace root
└── idea.md
```

## Step 1 — Set Up Project Structure
- Initialize bun workspace monorepo
- Create `packages/wordle/` with Vite + React + TypeScript + Tailwind
- Create `apps/server/` with Bun + Elysia + TypeScript
- Set up tsconfig files

## Step 2 — Fork and Modify Wordle Game (from nexxeln/nexdle)

### Source fork: https://github.com/nexxeln/nexdle
Fork the nexxeln/nexdle React wordle clone. Core logic from `word-utils.ts`:
- `computeGuess(guess, answer) → LetterState[]` — compares guess to answer
- `isValidWord(guess) → boolean` — checks if guess is valid (for letters)
- `LETTER_LENGTH = 5` — fixed length (keep for letters, variable for numbers)

### Modifications needed:

#### a) Three game modes
- **Numbers**: secret is a number string (e.g. "12345"). Input restricted to `[0-9]`. Use a custom keypad (0-9 + backspace + enter).
- **Letters**: standard wordle (A-Z). Use QWERTY keyboard.
- **Mixed**: alphanumeric (A-Z + 0-9). Use combined keyboard.

The mode is auto-detected from the secret:
- If secret is all digits → Numbers mode
- If secret is all letters → Letters mode
- If secret is mixed → Mixed mode

#### b) Custom number of tries
- Instead of fixed `GUESS_LENGTH = 6`, accept `tries` parameter
- Passed via URL query params: `?secret=abcde&tries=8`

#### c) Configurable via URL
- App reads `secret` and `tries` from URL search params on mount
- If no params, use defaults (random word, 6 tries)

#### d) Design improvements (design-taste-frontend)
- Apply design skill: dark theme with zinc/gray palette
- Use Geist font (via @fontsource/geist-sans)
- Premium animations (spring physics on keyboard, smooth transitions)
- Proper loading/error/empty states
- No emojis, no Inter font, no clichéd UI patterns
- Responsive layout with `min-h-[100dvh]`

## Step 3 — Build Backend Server (Bun + Elysia)

### API Endpoints

```
POST /api/games
  Body: { secret: string, tries?: number }
  Creates a game, returns { id: string, url: string }
  
GET /api/games/:id
  Returns game config: { secret, tries, mode, createdAt }
  The wordle frontend calls this on load

GET /wordle/:id
  Serves the wordle SPA with game ID embedded
```

### Game Store (in-memory)
- `Map<string, GameState>` where `GameState = { secret, tries, mode, createdAt }`
- Generate game IDs using nanoid or crypto.randomUUID()
- Games auto-expire after 24 hours (optional)

## Step 4 — Build Discord Bot (discord.js v14)

### Command: `/game create wordle`

```
Options:
  secret (string, required): The word/number to guess
  tries (integer, optional, default 6): Number of allowed guesses
```

### Behavior:
1. Bot receives the slash command
2. Calls `POST /api/games` on the backend
3. Replies with an embed containing:
   - Game type: Wordle
   - Mode: (auto-detected from secret)
   - Number of tries
   - Link: `https://0x1763.dev/wordle/<gameId>`
   - "Share this link with your players!"

## Implementation Order
1. Initialize project structure (package.json files, tsconfigs, workspace)
2. Fork wordle game into packages/wordle/ — modify for 3 modes + custom tries
3. Build server in apps/server/ — Elysia routes, game store, static serving
4. Build discord bot in apps/server/ — slash command registration + handler
5. Wire everything together, test the flow
