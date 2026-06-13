// REST surface for creating / inspecting Sabacc tables. Mounted as an Elysia
// sub-app (like music-api.ts). All live gameplay happens over the WebSocket
// route /ws/sabacc/:gameId; this is just creation + a public summary so the
// Discord bot can spawn a table the same way it spawns a Wordle game.

import { Elysia } from 'elysia';
import { createGame, getGame } from './sabacc-store';

export const sabaccApi = new Elysia({ prefix: '/api/sabacc' })
  // Create a table. Body is optional ante config; no secret/tries (Wordle-only).
  .post('/games', ({ body }) => {
    const b = (body ?? {}) as { anteMain?: number; anteSabacc?: number; maxPlayers?: number };

    const anteMain = b.anteMain !== undefined ? Math.floor(b.anteMain) : undefined;
    const anteSabacc = b.anteSabacc !== undefined ? Math.floor(b.anteSabacc) : undefined;

    if (anteMain !== undefined && (!Number.isFinite(anteMain) || anteMain < 1)) {
      return new Response(JSON.stringify({ error: 'anteMain must be at least 1' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (anteSabacc !== undefined && (!Number.isFinite(anteSabacc) || anteSabacc < 0)) {
      return new Response(JSON.stringify({ error: 'anteSabacc must be 0 or more' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { id, url } = createGame({ anteMain, anteSabacc, maxPlayers: b.maxPlayers });
    return { id, url };
  })

  // Public summary (no card/token data).
  .get('/games/:id', ({ params: { id } }) => {
    const game = getGame(id);
    if (!game) return new Response('Game not found', { status: 404 });
    return {
      id: game.id,
      phase: game.phase,
      playerCount: game.players.length,
      config: game.config,
    };
  });
