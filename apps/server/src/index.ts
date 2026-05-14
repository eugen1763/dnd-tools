import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
import path from 'path';
import { readFileSync } from 'fs';
import { createGame, getGame } from './store';
import { PORT } from './env';
import { startBot } from './discord';

const wordleDist = path.join(import.meta.dir, '../../../packages/wordle/dist');
const wordleHtml = readFileSync(path.join(wordleDist, 'index.html'), 'utf-8');

const app = new Elysia()
  .use(cors())
  .use(
    staticPlugin({
      assets: wordleDist,
      prefix: '/wordle'
    })
  )
  .get('/', () => {
    return new Response(
      `<html>
        <head><title>DnD Tools</title></head>
        <body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#eee">
          <div style="text-align:center">
            <h1>DnD Tools</h1>
            <p>Wordle game server</p>
            <p><a href="/wordle" style="color:#57F287">Play Wordle</a></p>
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
  .listen(PORT);

console.log(`Server running at http://localhost:${PORT}`);

startBot();
