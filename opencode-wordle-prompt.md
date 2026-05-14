# DnD Tools — Step 1: Wordle Game

We're building a DnD tools project at /home/finn/code/dnd-tools/. This is Step 1: create the monorepo structure and fork/modify a wordle clone.

## Task

Create the monorepo structure and a wordle game (forked from nexxeln/nexdle) that supports 3 modes (Numbers, Letters, Mixed) and custom number of tries.

## Detailed Instructions

### 1. Initialize monorepo root
Create `/home/finn/code/dnd-tools/package.json`:
```json
{
  "name": "dnd-tools",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev:wordle": "cd packages/wordle && bun run dev",
    "build:wordle": "cd packages/wordle && bun run build"
  }
}
```

### 2. Create the wordle game at `packages/wordle/`

#### package.json
Use bun, React 18, Vite 5, TypeScript 5, Tailwind CSS 3, Zustand 4.

#### vite.config.ts
Standard React plugin config.

#### tailwind.config.js
Content paths for index.html and src/**/*.{ts,tsx}.

#### postcss.config.js
tailwindcss + autoprefixer.

#### tsconfig.json
Strict mode, JSX react-jsx, ESNext, bundler module resolution.

#### index.html
Standard Vite HTML with `<div id="root">` and module script.

### 3. Source files

#### src/word-utils.ts
Core game logic:
- `detectMode(secret: string): 'numbers' | 'letters' | 'mixed'` — auto-detect mode from secret
- `LetterState` enum: Miss=0, Present=1, Match=2
- `computeGuess(guess: string, answer: string): LetterState[]` — compare guess to answer (standard wordle algorithm)
- `isValidWord(guess: string, mode: string): boolean` — validate based on mode

#### src/store.ts
Zustand store WITHOUT persist middleware. State:
- `secret: string`, `tries: number`, `mode: GameMode`
- `rows: { guess: string; result?: LetterState[] }[]`
- `gameState: 'playing' | 'won' | 'lost'`
- `keyboardLetterState: Record<string, LetterState>`
- `addGuess(guess: string): void`
- `initGame(secret: string, tries: number): void`

#### src/hooks/useGuess.ts
Hook managing current guess input:
- `guess: string`
- `addGuessLetter(key: string)` — append letter, handle backspace, handle enter
- `setGuess(g: string)` — reset guess
- Max length = secret.length

#### src/hooks/usePrevious.ts
Generic hook returning previous value of a state variable.

#### src/components/WordRow.tsx
Renders a row of character boxes. Each box shows letter + color:
- Match → green background
- Present → amber/yellow background  
- Miss → dark gray background
- Empty → transparent/border only

#### src/components/Keyboard.tsx
Three keyboard layouts based on mode:
- **numbers**: 0-9 numpad (3x4 grid with enter and backspace)
- **letters**: QWERTY (3 rows)
- **mixed**: QWERTY + number row on top
Keys show their current state color.

#### src/components/Header.tsx
Title "Wordle", mode badge, tries counter (e.g., "3/8")

#### src/components/GameOverModal.tsx
Overlay modal:
- "You Won!" or "Game Over!"
- Shows the answer if lost
- "Play Again" button that reloads the page

#### src/App.tsx
Main component:
- On mount, reads URL path to get gameId
- If gameId exists, fetches `/api/games/${gameId}` for config
- Falls back to random 5-letter word if no gameId
- Renders Header, WordRow grid (6 rows), Keyboard, GameOverModal
- Handles physical keyboard events
- Invalid guess shows brief shake animation

#### src/main.tsx
Standard React 18 createRoot.

#### src/index.css
Tailwind directives + dark theme:
- Geist font via @fontsource/geist-sans
- Dark background (zinc-900/zinc-950)
- Premium subtle styling, smooth transitions
- No emojis, no glowing UI

### 4. Build verification
```bash
cd /home/finn/code/dnd-tools
bun install
cd packages/wordle
bun run build
```

Build output goes to `packages/wordle/dist/`.

## Design Requirements
- Dark theme: zinc-900 bg, zinc-50 text
- Emerald-500 for correct letters, amber-500 for present, zinc-700 for miss
- Grid layout, clean spacing
- Geist sans font
- Smooth tile flip animations (CSS transitions)
- No emojis, no purple/blue aesthetic
- Responsive layout using min-h-[100dvh]
- No zustand persist middleware
- Secret always upper-cased for comparison
