// Headless smoke test: boots a client against a running server, joins, farms a tile,
// plants a seed and checks the server's responses. Usage: npx tsx scripts/smoke.ts [url]
import WebSocket from 'ws';
import type { ServerMsg } from '../shared/protocol';
import { tileAt } from '../shared/terrain';

const url = process.argv[2] ?? 'ws://localhost:3000/ws';
const ws = new WebSocket(url);
const seen = new Map<string, number>();
const toasts: string[] = [];
let welcome: Extract<ServerMsg, { t: 'welcome' }> | null = null;

const send = (m: object) => ws.send(JSON.stringify(m));

ws.on('open', () => send({ t: 'join', name: 'SmokeBot', dino: 'spino' }));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString()) as ServerMsg;
  seen.set(m.t, (seen.get(m.t) ?? 0) + 1);
  if (m.t === 'msg') toasts.push(m.text);
  if (m.t === 'welcome') {
    welcome = m;
    const [x, , z] = m.spawn;
    send({ t: 'state', x, y: m.spawn[1], z, ry: 0, anim: 0 });
    // the starting farm has a tilled patch at around (-8..-2, 4..6)
    const [tx, tz] = tileAt(-8, 4);
    send({ t: 'state', x: -8, y: 1.5, z: 2, ry: 0, anim: 0 });
    send({ t: 'act', act: { a: 'water', tx, tz } });
    send({ t: 'act', act: { a: 'plant', tx, tz, sp: 'snapjaw' } });
    const [gx, gz] = tileAt(-4, 0);
    send({ t: 'act', act: { a: 'till', tx: gx, tz: gz } });
    send({ t: 'act', act: { a: 'attack', tool: 'sling', dir: [0, 0.2, 1] } });
    send({ t: 'act', act: { a: 'ability', dir: [0, 0, 1] } });
    send({ t: 'chat', text: 'hello farm' });
  }
});

setTimeout(() => {
  const w = welcome;
  const problems: string[] = [];
  if (!w) problems.push('no welcome');
  else {
    console.log(`welcome: ${w.heights.length} heights, ${w.tiles.length} tiles, ${w.plants.length} plants, ${w.buildings.length} buildings, ${w.nodes.length} nodes`);
  }
  for (const t of ['s', 'plant', 'seeds', 'tiles', 'chat', 'fx']) if (!seen.get(t)) problems.push(`never received '${t}'`);
  console.log('message counts:', Object.fromEntries(seen));
  console.log('toasts:', toasts);
  if (problems.length) {
    console.error('FAIL:', problems.join('; '));
    process.exit(1);
  }
  console.log('OK');
  process.exit(0);
}, 2500);
