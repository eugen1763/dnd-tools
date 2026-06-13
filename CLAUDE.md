# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Runtime is **Bun** (≥1.1), not Node. There is no test runner or linter configured.

```bash
bun install              # install all workspace deps
bun run build            # build BOTH frontends (build:wordle + build:sabacc)
bun run build:wordle     # build the Wordle frontend → packages/wordle/dist
bun run build:sabacc     # build the Sabacc frontend → packages/sabacc/dist
bun run start            # run the server (apps/server/src/index.ts)
bun run dev              # run the server with --watch (auto-reload)
bun run dev:wordle       # Vite dev server for the Wordle UI (HMR, standalone)
bun run dev:sabacc       # Vite dev server for the Sabacc UI (HMR, standalone)
```

**Both SPAs must be built before `start`/`dev`.** `apps/server/src/index.ts` reads
`packages/wordle/dist/index.html` **and** `packages/sabacc/dist/index.html`
synchronously at module load — if either build is missing the server crashes on
startup. Run `bun run build` (both) once, then rebuild the package you changed (or
use the matching `dev:*` server for UI-only iteration).

Type-check a frontend with `cd packages/<pkg> && bun run build` (runs `tsc`).
The server has `noEmit` TS config; run `cd apps/server && bunx tsc --noEmit` to
type-check it (note: the Wordle `index.ts`/`discord.ts` code has some pre-existing
implicit-any / WebSocket-type errors; the new `sabacc-*.ts` modules are clean).
Engine unit tests: `cd apps/server && bun test src/sabacc-engine.test.ts`.

### External binaries (must be on PATH)
- `yt-dlp` — all music downloads (`youtube.ts` spawns it)
- `ffmpeg` — **only** for seeking and non-unity volume; normal playback does not use it

## Architecture

Bun-workspace monorepo. **One server process** (`apps/server`) serves everything
on `PORT` (default 3000) and also logs in the Discord bot in-process. The Wordle
React app (`packages/wordle`) is built to static assets and served by that same
process.

Routes mounted in `apps/server/src/index.ts`:
- `/wordle/*` → built Wordle SPA (static + catch-all to index.html)
- `/ws/:gameId` → WebSocket for live Wordle play
- `/api/games*` → Wordle game create/fetch
- `/sabacc/*` → built Sabacc SPA (static + catch-all)
- `/ws/sabacc/:gameId` → WebSocket for live Sabacc play (`sabacc-ws.ts` plugin)
- `/api/sabacc/*` → Sabacc table create/summary (`sabacc-api.ts`, Elysia sub-app)
- `/api/music/*` → music control REST API (`music-api.ts`, Elysia sub-app)
- `/music` → music control panel UI (`webui/index.html`, a single ~1200-line file)

### Subsystems

**Wordle.** Discord `/game create type:wordle secret:…` → `POST /api/games` →
`store.ts` (in-memory `Map`) → shareable link `/wordle/:id`. The frontend opens
`/ws/:gameId`; the **server is authoritative** for guesses — it runs `computeGuess`
and broadcasts `guess_result` to every connected client, so all players see each
other's guesses in real time. Note: the guess-scoring logic is **duplicated** —
`store.ts` (`computeGuess`/`LetterState`, server-authoritative) and
`packages/wordle/src/word-utils.ts` (client-side, used only for solo play when the
URL has no gameId). Keep them in sync if you change scoring rules. `mode`
(numbers/letters/mixed) is auto-detected from the secret by regex.

**Sabacc** (Corellian Spike, a full multiplayer betting card game). Discord
`/game create type:sabacc [ante:N]` → `POST /api/sabacc/games` → `sabacc-store.ts`
(in-memory `Map`) → link `/sabacc/:id`. Frontend: `packages/sabacc/` (React + Vite
+ Tailwind + **framer-motion**, CSS-3D cards). Live play over `/ws/sabacc/:gameId`.
Server layering, all server-authoritative:
- **`sabacc-engine.ts`** — pure rules, no I/O (unit-tested in `sabacc-engine.test.ts`):
  62-card deck, hand evaluation + the full named-hand hierarchy via a single
  comparable `rankKey` tuple (`evaluateHand`/`compareHands`), and the
  Card→Betting→Dice × 3-round state machine (`startHand`, `applyCardAction`,
  `applyBetAction`, `rollDice`, `resolveShowdown`). Mutates a passed-in
  `SabaccGame` and returns `ServerEvent[]` for animations.
- **`sabacc-store.ts`** — the `Map`, identity, and the **only** place reconnect
  tokens (`nanoid(21)`) are minted/held.
- **`sabacc-ws.ts`** — the WS plugin. Unlike Wordle (one shared board), Sabacc
  players have identity and **private hole cards**, so state is serialized
  **per recipient** (`serializeFor`): you only ever see your own `hand` until
  `phase==='showdown'`, and the secret token is sent only in the 1:1
  `joined`/`reconnect` reply (clients store it in `localStorage` to reclaim a seat).
- Key v1 simplifications, flagged in code: **table-stakes, no side pots** (a raise
  can't exceed the smallest active stack); the **Sabacc shift** effect (matching
  dice) is isolated behind `config.shiftRule` (default `discardRedraw`) because the
  real-world rule is unconfirmed. First player to join is the host (starts each
  hand); a disconnected actor is auto-stood/checked/folded so the table never stalls.

**Music.** Discord `/music start` → `joinAndStartSession` (`music-player.ts`)
opens a voice connection and mints a `nanoid(32)` **control token**, returned to
the user as `/music?token=…`. The web UI sends that token in the
`x-control-token` header on every `/api/music/*` call; the token maps to a
`guildId`, and there is **one session per guild**. Stopping the session (or losing
the connection) invalidates the token.

### State & persistence (all in-memory; see exceptions)
- **Wordle games** (`store.ts`) and **Sabacc tables** (`sabacc-store.ts`):
  in-memory only — lost on restart. Both auto-clean: each game stamps an idle
  clock (`emptySince`) when its last client disconnects and clears it on
  reconnect; a periodic sweep in `index.ts` (every 5 min) deletes games idle
  >30 min. The WS layers set occupancy (`setGameOccupied` for Wordle;
  `recomputeEmpty` via the store mutators for Sabacc).
- **Music sessions / connections / players / ffmpeg procs** (`music-player.ts`):
  separate in-memory `Map`s keyed by `guildId` — lost on restart.
- **Music library** (track + category metadata, `music-store.ts`): loaded from
  `apps/server/music/metadata.json` **once** at startup into an in-memory object;
  all reads are pure memory access. Writes mutate memory and schedule a
  **debounced (250ms) atomic** write-back (temp file + rename). `flushNow()` runs
  on SIGTERM/SIGINT/beforeExit. This service is assumed to be the **single
  writer** — external edits to `metadata.json` while running are not picked up.
- **Audio files**: `apps/server/music/tracks/*.opus` (gitignored).

### Audio playback (`music-player.ts`) — the subtle part
- **Default path is Opus passthrough**: the file's Ogg/Opus packets stream
  straight to Discord (`StreamType.OggOpus`) with **no ffmpeg and no re-encode**.
- ffmpeg is spawned **only** when seeking (`-ss … -c:a copy`) or applying a
  non-unity volume (`-af volume=… -c:a libopus`). There is **no live volume**: a
  volume/seek change *reloads the current track from its current position*.
- Playback position for the UI progress bar is derived, not sampled:
  `getPositionSeconds` = `positionMs + (now - startedAtMs)` while playing.
- The voice-connection `stateChange` handler is adapted from the official
  `@discordjs/voice` example: handles Discord's forced reconnects, the 4014
  close code (moved-vs-kicked), rejoin backoff, and destroys cleanly when truly
  gone. There's also a fast-failure guard (`MAX_FAILURES` within a window) that
  stops playback instead of respawning into a tight loop on a corrupt track.

### Discord interaction timing (important constraint)
Discord requires an ack within ~3s. Handlers `deferReply()`/`reply()` immediately,
then do slow work (joining voice, downloading) and `editReply`. Blocking the event
loop will silently break slash commands — this is the documented reason the music
library is cached in memory rather than re-read per call. The bot registers `/game`
and `/music` per-guild (instant) on ready and on `guildCreate`. Without
`DISCORD_TOKEN` set, the bot login is skipped and the rest of the server still runs.

## Environment variables
`DISCORD_TOKEN` (omit to skip bot), `PORT` (3000), `MUSIC_CONTROL_BASE_URL` and
`GAME_BASE_URL` (both default to `http://localhost:$PORT`; set these to the public
URL in production so Discord links resolve). See `apps/server/.env.example`.
