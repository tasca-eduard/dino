import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import './ui.css';
import {
  BUILDINGS,
  BUILD_ORDER,
  CAN_CAPACITY,
  DINOS,
  PLANTS,
  PLANT_ORDER,
  RESOURCE_INFO,
  TAME,
  TOOLS,
  canAfford,
  costText,
  type ResourceKey,
} from '../../shared/constants';
import { sendChat } from '../net';
import { useGame } from '../store';
import { serverNow } from '../world';
import { HelpPanel } from './HelpPanel';
import { DINO_ICON, clamp01, mmss } from './shared';

const RES_KEYS = Object.keys(RESOURCE_INFO) as ResourceKey[];

export function Hud() {
  return (
    <div className="hud">
      <DamageFlash />

      <div className="hud-col hud-left">
        <ResourcesPanel />
        <SeedBag />
      </div>

      <div className="hud-top">
        <ClockPanel />
        <RaidBanner />
      </div>

      <div className="hud-col hud-right">
        <PartyList />
        <Toasts />
      </div>

      <Crosshair />

      <div className="hud-bottom-left">
        <Chat />
        <Vitals />
      </div>

      <div className="hud-bottom">
        <ToolContext />
        <Hotbar />
      </div>

      <ClickToPlay />
      <HelpPanel />
      <DeathOverlay />
    </div>
  );
}

// ---------------------------------------------------------------- Resources & seeds

function ResourcesPanel() {
  const res = useGame((s) => s.res);
  return (
    <div className="panel res-panel">
      {RES_KEYS.map((k) => (
        <div key={k} className={`res-chip${res[k] > 0 ? '' : ' zero'}`}>
          <span className="res-icon">{RESOURCE_INFO[k].icon}</span>
          <span className="res-num">{res[k]}</span>
          <span className="res-name">{RESOURCE_INFO[k].name}</span>
        </div>
      ))}
    </div>
  );
}

function SeedBag() {
  const seeds = useGame((s) => s.seeds);
  const active = useGame((s) => (TOOLS[s.tool]?.id === 'seeds' ? s.seedIdx : -1));
  return (
    <div className="panel seed-panel">
      <div className="panel-title">
        <span>🌱 Seed bag</span>
        <span className="seed-legend-head">
          wild · <span className="heir">🌟</span>
        </span>
      </div>
      {PLANT_ORDER.map((k, i) => {
        const st = seeds[k] ?? { wild: 0, heirloom: 0 };
        const empty = st.wild + st.heirloom === 0;
        return (
          <div key={k} className={`seed-row${i === active ? ' active' : ''}${empty ? ' zero' : ''}`}>
            <span className="seed-name">{PLANTS[k].name}</span>
            <span className="seed-num">{st.wild}</span>
            <span className={`seed-num heir${st.heirloom > 0 ? '' : ' none'}`}>🌟{st.heirloom}</span>
          </div>
        );
      })}
      <div className="seed-legend">🌟 Heirloom seeds come from tamed plants and start {TAME.HEIRLOOM_START}% tame.</div>
    </div>
  );
}

// ---------------------------------------------------------------- Clock & raid

function ClockPanel() {
  const { day, dayCount, rain } = useGame(useShallow((s) => ({ day: s.day, dayCount: s.dayCount, rain: s.rain })));
  const mins = Math.floor((((day % 1) + 1) % 1) * 24 * 60);
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  const night = day < 0.22 || day > 0.78;
  return (
    <div className={`panel clock-panel${night ? ' night' : ''}`}>
      <span className="clock-icon">{night ? '🌙' : '☀️'}</span>
      <span className="clock-day">Day {dayCount}</span>
      <span className="clock-time">
        {hh}:{mm}
      </span>
      {rain && (
        <span className="clock-rain" title="Raining — crops are watered">
          🌧️
        </span>
      )}
    </div>
  );
}

function RaidBanner() {
  const raid = useGame((s) => s.raid);
  const enemies = useGame((s) => s.enemyIds.length);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);
  const left = raid.next - serverNow();

  if (raid.status === 'warn') {
    return (
      <div className="raid-banner warn">
        <div>
          ⚠️ Raid {raid.wave} incoming in {Math.max(0, Math.ceil(left))}s
        </div>
        {raid.wave % 3 === 0 && <div className="raid-sub">🐍 A Titanoboa is coming!</div>}
      </div>
    );
  }
  if (raid.status === 'active') {
    return (
      <div className="raid-banner active">
        <div>🦎 RAID {raid.wave} — defend the farm!</div>
        <div className="raid-sub">
          {enemies} {enemies === 1 ? 'raider' : 'raiders'} remaining
        </div>
      </div>
    );
  }
  if (!(raid.next > 0)) return null;
  return <div className="raid-banner calm">{left > 0 ? `Next raid in ${mmss(left)}` : 'Raid imminent…'}</div>;
}

// ---------------------------------------------------------------- Party & toasts

function PartyList() {
  const players = useGame((s) => s.players);
  const playerHp = useGame((s) => s.playerHp);
  const myId = useGame((s) => s.myId);
  const myHp = useGame((s) => s.hp);
  const list = Object.values(players).sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : a.id - b.id));
  if (!list.length) return null;
  return (
    <div className="panel party-panel">
      <div className="panel-title">
        <span>🦴 Herd</span>
        <span className="muted">{list.length}</span>
      </div>
      {list.map((p) => {
        const def = DINOS[p.dino];
        const max = def?.hp ?? 100;
        const hp = p.id === myId ? myHp : (playerHp[p.id] ?? max);
        const frac = clamp01(hp / max);
        return (
          <div key={p.id} className={`party-row${p.id === myId ? ' me' : ''}${hp <= 0 ? ' down' : ''}`}>
            <span className="party-dot" style={{ background: p.color }} />
            <div className="party-main">
              <div className="party-name">
                <span className="pn">{p.name}</span>
                {p.id === myId && <span className="you-tag">you</span>}
                <span className="party-dino">
                  {DINO_ICON[p.dino]} {def?.name}
                </span>
              </div>
              <div className="bar mini">
                <div className={`bar-fill hp${frac < 0.3 ? ' low' : ''}`} style={{ width: `${frac * 100}%` }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Crosshair

function Crosshair() {
  const prompt = useGame((s) => s.prompt);
  const info = useGame((s) => s.targetInfo);
  return (
    <div className="crosshair-wrap">
      <div className="crosshair" />
      {(prompt || info) && (
        <div className="target-box">
          {prompt && <div className="prompt">{prompt}</div>}
          {info && <div className="target-info">{info}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Hotbar

function Hotbar() {
  const tool = useGame((s) => s.tool);
  return (
    <div className="hotbar">
      {TOOLS.map((t, i) => (
        <div key={t.id} className={`slot${i === tool ? ' selected' : ''}`}>
          <span className="slot-key">{i + 1}</span>
          <span className="slot-icon">{t.icon}</span>
          <span className="slot-name">{t.name}</span>
        </div>
      ))}
    </div>
  );
}

function ToolContext() {
  const tool = useGame((s) => s.tool);
  const def = TOOLS[tool];
  if (!def) return null;
  let body;
  if (def.id === 'seeds') body = <SeedContext />;
  else if (def.id === 'hammer') body = <HammerContext />;
  else if (def.id === 'can') body = <CanContext />;
  else
    body = (
      <div className="ctx-line">
        <Mouse btn="L" /> {def.primary}
        {def.secondary && (
          <>
            <span className="sep">·</span>
            <Mouse btn="R" /> {def.secondary}
          </>
        )}
      </div>
    );
  return (
    <div className="panel tool-ctx">
      <div className="ctx-title">
        {def.icon} {def.name}
      </div>
      {body}
    </div>
  );
}

function Mouse({ btn }: { btn: 'L' | 'R' }) {
  return <span className="mouse-btn">{btn === 'L' ? 'LMB' : 'RMB'}</span>;
}

function SeedContext() {
  const seedIdx = useGame((s) => s.seedIdx);
  const sp = PLANT_ORDER[((seedIdx % PLANT_ORDER.length) + PLANT_ORDER.length) % PLANT_ORDER.length];
  const st = useGame(useShallow((s) => s.seeds[sp] ?? { wild: 0, heirloom: 0 }));
  const none = st.wild + st.heirloom === 0;
  return (
    <>
      <div className="ctx-line">
        <Mouse btn="L" /> Plant <b className="ctx-hl">{PLANTS[sp].name}</b>
        <span className="sep">·</span>
        <span className={none ? 'bad' : ''}>
          {st.wild} wild · 🌟{st.heirloom} heirloom
        </span>
        <span className="sep">·</span>
        <kbd>R</kbd> next
      </div>
      {none && <div className="ctx-sub bad">No seeds — press E on wild plants out in the world to gather some.</div>}
    </>
  );
}

const ROT_ARROWS = ['↑', '→', '↓', '←'];

function HammerContext() {
  const buildIdx = useGame((s) => s.buildIdx);
  const rot = useGame((s) => s.buildRot);
  const type = BUILD_ORDER[((buildIdx % BUILD_ORDER.length) + BUILD_ORDER.length) % BUILD_ORDER.length];
  const b = BUILDINGS[type];
  const affordable = useGame((s) => canAfford(s.res, b.cost));
  return (
    <>
      <div className="ctx-line">
        <Mouse btn="L" /> Build <b className="ctx-hl">{b.name}</b>
        <span className="sep">·</span>
        <span className={affordable ? 'good' : 'bad'}>{costText(b.cost)}</span>
        <span className="sep">·</span>
        <span className="muted">facing {ROT_ARROWS[((rot % 4) + 4) % 4]}</span>
      </div>
      <div className="ctx-sub">{b.desc}</div>
      <div className="ctx-sub muted">
        <kbd>R</kbd> next · <kbd>T</kbd> rotate · <kbd>X</kbd> demolish
      </div>
    </>
  );
}

function CanContext() {
  const water = useGame((s) => s.water);
  const infinite = useGame((s) => s.myDino === 'spino');
  const drops = Array.from({ length: CAN_CAPACITY }, (_, i) => i < water || infinite);
  return (
    <>
      <div className="ctx-line">
        <Mouse btn="L" /> Water soil
        <span className="sep">·</span>
        <span className="drops">
          {drops.map((full, i) => (
            <span key={i} className={`drop${full ? ' full' : ''}`} />
          ))}
        </span>
        <b className="ctx-hl">{infinite ? '∞' : `${water}/${CAN_CAPACITY}`}</b>
      </div>
      {!infinite && water <= 0 && <div className="ctx-sub bad">Empty! Use the can on water to refill.</div>}
      {!infinite && water > 0 && <div className="ctx-sub muted">Refill by using it on water</div>}
    </>
  );
}

// ---------------------------------------------------------------- Vitals & ability

function Vitals() {
  const { hp, maxHp, myDino, canHeal } = useGame(
    useShallow((s) => ({ hp: s.hp, maxHp: s.maxHp, myDino: s.myDino, canHeal: s.res.nectar > 0 && s.hp < s.maxHp && !s.dead })),
  );
  const d = DINOS[myDino];
  const frac = clamp01(hp / (maxHp || 1));
  return (
    <div className="panel vitals" style={{ '--dino': d.color } as CSSProperties}>
      <div className="vit-portrait">{DINO_ICON[myDino]}</div>
      <div className="vit-main">
        <div className="vit-head">
          <span className="vit-name">{d.name}</span>
          <span className="vit-hp">
            {Math.max(0, Math.ceil(hp))}
            <span className="muted"> / {maxHp}</span>
          </span>
        </div>
        <div className="bar big">
          <div className={`bar-fill hp${frac < 0.3 ? ' low' : ''}`} style={{ width: `${frac * 100}%` }} />
          <span className="bar-shine" />
        </div>
        {canHeal ? (
          <div className="heal-hint">
            <kbd>F</kbd> Heal (🍯 nectar)
          </div>
        ) : (
          <div className="heal-hint muted">❤️ Health</div>
        )}
      </div>
      <AbilityButton />
    </div>
  );
}

function AbilityButton() {
  const readyAt = useGame((s) => s.abilityReadyAt);
  const myDino = useGame((s) => s.myDino);
  const ab = DINOS[myDino].ability;
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = performance.now();
      setNow(t);
      if (t < readyAt) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [readyAt]);
  const remain = Math.max(0, readyAt - now);
  const frac = clamp01(remain / (ab.cd * 1000));
  const ready = remain <= 0;
  return (
    <div className={`ability${ready ? ' ready' : ''}`}>
      <div className="ab-ring" style={{ '--cd': `${frac * 360}deg` } as CSSProperties}>
        <span className="ab-icon">{DINO_ICON[myDino]}</span>
        {!ready && <span className="ab-count">{(remain / 1000).toFixed(remain < 1000 ? 1 : 0)}</span>}
        <kbd className="ab-key">Q</kbd>
      </div>
      <div className="ab-label">{ab.name}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Chat

const CHAT_VISIBLE_MS = 10000;

function Chat() {
  const chat = useGame((s) => s.chat);
  const open = useGame((s) => s.chatOpen);
  const seen = useRef(new Map<number, number>());
  const now = performance.now();
  for (const l of chat) if (!seen.current.has(l.id)) seen.current.set(l.id, now);
  if (seen.current.size > 120) {
    const keep = new Set(chat.map((l) => l.id));
    for (const id of seen.current.keys()) if (!keep.has(id)) seen.current.delete(id);
  }
  const lines = chat.slice(open ? -12 : -8);
  return (
    <div className={`chat${open ? ' open' : ''}`}>
      <div className="chat-lines">
        {lines.map((l) => {
          const at = seen.current.get(l.id) ?? now;
          const style = open ? undefined : { animationDelay: `${(at + CHAT_VISIBLE_MS - now) / 1000}s` };
          return (
            <div key={l.id} className={`chat-line${open ? '' : ' fading'}`} style={style}>
              <b style={{ color: l.color }}>{l.from}:</b> {l.text}
            </div>
          );
        })}
      </div>
      {open ? (
        <ChatInput />
      ) : (
        <div className="chat-hint">
          <kbd>Enter</kbd> to chat · <kbd>H</kbd> help
        </div>
      )}
    </div>
  );
}

function relockPointer() {
  const c = document.querySelector('canvas');
  if (!c) return;
  try {
    const p = c.requestPointerLock() as unknown;
    if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
  } catch {
    /* lock not allowed right now — the click-to-play overlay covers it */
  }
}

function ChatInput() {
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const closed = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  const close = (relock: boolean) => {
    if (closed.current) return;
    closed.current = true;
    useGame.getState().set({ chatOpen: false });
    if (relock) relockPointer();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const msg = text.trim();
      if (msg) sendChat(msg.slice(0, 200));
      close(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    }
  };
  return (
    <input
      ref={ref}
      className="chat-input"
      value={text}
      maxLength={200}
      placeholder="Say something to the herd…"
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setText(e.target.value)}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
      onBlur={() => close(false)}
    />
  );
}

// ---------------------------------------------------------------- Overlays

function ClickToPlay() {
  const show = useGame((s) => !s.pointerLocked && !s.chatOpen && !s.dead && !s.helpOpen);
  if (!show) return null;
  return (
    <div className="click-to-play">
      <div className="panel ctp-card">
        <div className="ctp-title">🖱️ Click to play</div>
        <div className="ctp-sub">
          <kbd>H</kbd> controls & field guide · <kbd>Esc</kbd> releases the mouse
        </div>
      </div>
    </div>
  );
}

function DeathOverlay() {
  const dead = useGame((s) => s.dead);
  const by = useGame((s) => s.deathBy);
  if (!dead) return null;
  return (
    <div className="death">
      <div className="death-card">
        <div className="death-skull">💫</div>
        <div className="death-title">You were knocked out{by ? ` by ${by}` : ''}</div>
        <div className="death-sub">
          Respawning at the hut<span className="dots" />
        </div>
      </div>
    </div>
  );
}

function DamageFlash() {
  const hp = useGame((s) => s.hp);
  const low = useGame((s) => !s.dead && s.hp > 0 && s.hp < s.maxHp * 0.3);
  const prev = useRef(hp);
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (hp < prev.current) setFlash((f) => f + 1);
    prev.current = hp;
  }, [hp]);
  return (
    <>
      {low && <div className="low-hp" />}
      {flash > 0 && <div key={flash} className="dmg-flash" />}
    </>
  );
}
