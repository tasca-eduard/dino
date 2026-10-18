import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game';
import type { ClientMsg } from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 3000);
const DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../dist');
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

// Serves the production build (npm run build) so one process hosts everything.
const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, players: game.playerCount }));
    return;
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Dino Farm game server is running. In development open the Vite client at http://localhost:5173');
    return;
  }
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(DIST, url));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

// RAID_FIRST=30 makes the first raid arrive after 30 s (handy for testing defenses)
const game = new Game(Number(process.env.SEED ?? 20261018), { raidFirst: Number(process.env.RAID_FIRST) || undefined });
const wss = new WebSocketServer({ server: http, path: '/ws' });

wss.on('connection', (ws) => {
  let playerId: number | null = null;
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      if (msg.t === 'join') {
        if (playerId === null) playerId = game.addPlayer(ws, msg.name, msg.dino);
      } else if (playerId !== null) {
        game.handle(playerId, msg);
      }
    } catch (err) {
      // one bad message must never take the whole farm down
      console.error('Error handling message', msg, err);
    }
  });
  ws.on('close', () => {
    if (playerId !== null) game.removePlayer(playerId);
  });
});

http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n✖ Port ${PORT} is already in use — another Dino Farm server (or other app) is running.`);
    console.error('  Stop it, or run with a different port: set PORT=3001 for both the server and Vite.\n');
    process.exit(1);
  }
  throw err;
});

game.start();
http.listen(PORT, () => console.log(`Dino Farm server on http://localhost:${PORT} (ws path /ws)`));
