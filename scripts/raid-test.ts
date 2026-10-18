// Headless raid test: run the server with RAID_FIRST=3, join, idle near the hut and
// watch raiders spawn, approach and attack. Usage: npx tsx scripts/raid-test.ts [url] [seconds]
import WebSocket from 'ws';
import type { ServerMsg } from '../shared/protocol';

const url = process.argv[2] ?? 'ws://localhost:3000/ws';
const seconds = Number(process.argv[3] ?? 25);
const ws = new WebSocket(url);
let maxEnemies = 0;
let minDist = Infinity;
let hurt = 0;
const events: string[] = [];

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'RaidBot', dino: 'ankylo' })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString()) as ServerMsg;
  if (m.t === 's') {
    maxEnemies = Math.max(maxEnemies, m.e.length);
    for (const e of m.e) minDist = Math.min(minDist, Math.hypot(e[2], e[4]));
  }
  if (m.t === 'raid') events.push(`raid ${m.state} wave ${m.wave}`);
  if (m.t === 'msg') events.push(`msg: ${m.text}`);
  if (m.t === 'hurt' && m.dmg > 0) hurt++;
  if (m.t === 'buildingGone') events.push(`building ${m.id} destroyed`);
});

setTimeout(() => {
  console.log({ maxEnemies, closestEnemyToCenter: Math.round(minDist), timesHurt: hurt });
  console.log(events.join('\n'));
  const ok = maxEnemies > 0 && minDist < 30;
  console.log(ok ? 'OK' : 'FAIL: raiders never reached the farm');
  process.exit(ok ? 0 : 1);
}, seconds * 1000);
