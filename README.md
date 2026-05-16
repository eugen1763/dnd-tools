# DnD Tools

A collection of tools for Dungeons & Dragons sessions — a multiplayer Wordle clone and a Discord music bot, all behind a single web server.

## Features

- **Multiplayer Wordle** — 3 modes (Numbers / Letters / Mixed). Create a game via Discord (`/game create`) and share the link with your players. Real-time updates via WebSocket.
- **Discord Bot** — Slash commands for game creation and music session control.
- **Music Player** — Join a voice channel and play downloaded YouTube audio. Queue management, volume, loop, shuffle — all controlled from a web UI.

## Requirements

- [Bun](https://bun.sh) >= 1.1
- `yt-dlp` (for music downloads)
- `ffmpeg` (for audio playback in Discord)

## Getting Started

```bash
# Install dependencies
bun install

# Build the Wordle frontend
bun run build:wordle

# Start the server
bun run start
```

The server runs on `http://localhost:3000` by default.

## Discord Bot

Set `DISCORD_TOKEN` to enable the bot. The bot registers `/game` and `/music` slash commands in every guild it joins.

### Commands

| Command | Description |
|---|---|
| `/game create wordle <secret> [tries]` | Create a Wordle game and get a shareable link |
| `/music start` | Join your voice channel and start playing |
| `/music stop` | Leave the voice channel and end the session |

### Music Web UI

Once a music session is started, the bot replies with a control panel link. Open it to manage the queue, add YouTube tracks, and control playback.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DISCORD_TOKEN` | — | Discord bot token (omit to skip bot login) |
| `PORT` | `3000` | HTTP server port |
| `MUSIC_CONTROL_BASE_URL` | `http://localhost:3000` | Public URL for music control panel links |
| `GAME_BASE_URL` | `http://localhost:3000` | Public URL for game links in Discord embeds |

## Project Structure

```
dnd-tools/
├── apps/server/          # Backend (Elysia + Bun)
│   ├── src/
│   │   ├── index.ts      # HTTP server & WebSocket game handler
│   │   ├── discord.ts    # Discord bot client & slash commands
│   │   ├── env.ts        # Environment variables
│   │   ├── store.ts      # In-memory game state
│   │   ├── music-store.ts # File-based music metadata store
│   │   ├── music-player.ts# Discord voice connection & playback
│   │   ├── music-api.ts  # REST API for music control UI
│   │   └── youtube.ts    # yt-dlp wrapper for downloads
│   └── webui/            # Music control panel frontend
├── packages/wordle/      # Wordle frontend (React + Vite + Tailwind)
└── package.json          # Workspace root
```
