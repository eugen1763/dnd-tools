import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
import path from 'path';
import { readFileSync } from 'fs';
import { createGame, getGame, addGuessToGame, LetterState, computeGuess } from './store';
import { PORT } from './env';
import { startBot } from './discord';
import { musicApi } from './music-api';

const wordleDist = path.join(import.meta.dir, '../../../packages/wordle/dist');
const wordleHtml = readFileSync(path.join(wordleDist, 'index.html'), 'utf-8');
const webUiDir = path.join(import.meta.dir, '../webui');

const gameClients = new Map<string, Set<WebSocket>>();

function broadcastToGame(gameId: string, data: unknown, excludeWs?: WebSocket) {
  const clients = gameClients.get(gameId);
  if (!clients) return;
  const message = JSON.stringify(data);
  for (const client of clients) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

const app = new Elysia()
  .use(cors())
  .use(
    staticPlugin({
      assets: wordleDist,
      prefix: '/wordle'
    })
  )
  .use(musicApi)
  .ws('/ws/:gameId', {
    open(ws) {
      const { gameId } = ws.data.params as { gameId: string };
      const game = getGame(gameId);

      if (!game) {
        ws.send(JSON.stringify({ type: 'error', message: 'Game not found' }));
        ws.close();
        return;
      }

      if (!gameClients.has(gameId)) {
        gameClients.set(gameId, new Set());
      }
      gameClients.get(gameId)!.add(ws.raw);

      ws.send(JSON.stringify({
        type: 'state',
        secret: game.secret,
        tries: game.tries,
        mode: game.mode,
        guesses: game.guesses,
        playerCount: gameClients.get(gameId)!.size,
      }));

      broadcastToGame(gameId, {
        type: 'player_count',
        count: gameClients.get(gameId)!.size,
      }, ws.raw);
    },
    message(ws, rawMessage) {
      const { gameId } = ws.data.params as { gameId: string };
      const data = rawMessage as { type: string; guess?: string };

      if (data.type === 'guess' && data.guess) {
        const game = getGame(gameId);
        if (!game) return;

        if (game.guesses.length >= game.tries) return;

        const lastGuess = game.guesses[game.guesses.length - 1];
        if (lastGuess && lastGuess.guess === game.secret) return;

        const guess = data.guess.toUpperCase();
        if (guess.length !== game.secret.length) return;

        const result = computeGuess(guess, game.secret);
        addGuessToGame(gameId, guess, result);

        const updatedGame = getGame(gameId);
        const clientSet = gameClients.get(gameId);
        broadcastToGame(gameId, {
          type: 'guess_result',
          guess,
          result,
          gameState: updatedGame!.guesses.length >= updatedGame!.tries ? 'lost' :
            result.every(r => r === LetterState.Match) ? 'won' : 'playing',
          playerCount: clientSet ? clientSet.size : 0,
        });
      }
    },
    close(ws) {
      const { gameId } = ws.data.params as { gameId: string };
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
  .get('/', () => {
    return new Response(
      `<html>
        <head><title>DnD Tools</title></head>
        <body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#eee">
          <div style="text-align:center">
            <h1>DnD Tools</h1>
            <p>Wordle game server &amp; DnD Music Bot</p>
            <p><a href="/wordle" style="color:#57F287">Play Wordle</a></p>
            <p><a href="/music" style="color:#1DB954">Music Control</a></p>
          </div>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  })
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
  .get('/wordle/*', () => {
    return new Response(wordleHtml, {
      headers: { 'Content-Type': 'text/html' }
    });
  })
  .get('/music', () => {
    // Serve the music control UI
    const musicHtml = readFileSync(path.join(webUiDir, 'index.html'), 'utf-8');
    return new Response(musicHtml, {
      headers: { 'Content-Type': 'text/html' }
    });
  })
  .listen(PORT);

console.log(`Server running at http://localhost:${PORT}`);

startBot();
