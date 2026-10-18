import { useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import './ui.css';
import { DINOS, type DinoType } from '../../shared/constants';
import { connect } from '../net';
import { useGame } from '../store';
import { DINO_ICON, DINO_KEYS, ELEMENT_COLOR, ELEMENT_ICON, clamp01, isDino, loadPref, savePref } from './shared';

const NAME_KEY = 'dinofarm.name';
const DINO_KEY = 'dinofarm.dino';
const MAX_NAME = 16;

const HOW_TO: [string, string][] = [
  ['WASD', 'Move'],
  ['Mouse', 'Look (click to lock)'],
  ['Space', 'Jump / fly'],
  ['Shift', 'Sprint'],
  ['LMB', 'Use tool'],
  ['RMB', 'Secondary'],
  ['E', 'Interact'],
  ['Q', 'Ability'],
  ['1-8', 'Tools'],
  ['R', 'Cycle'],
  ['F', 'Nectar heal'],
  ['H', 'Help'],
  ['Enter', 'Chat'],
];

/** Keep the game's global key handler from reacting while typing in menu inputs. */
const stopKeys = (e: KeyboardEvent) => e.stopPropagation();

export function Menu() {
  const phase = useGame((s) => s.phase);
  const error = useGame((s) => s.error);
  const [name, setName] = useState(() => (loadPref(NAME_KEY) ?? '').slice(0, MAX_NAME));
  const [dino, setDino] = useState<DinoType>(() => {
    const v = loadPref(DINO_KEY);
    return isDino(v) ? v : 'raptor';
  });
  const connecting = phase === 'connecting';

  const pick = (k: DinoType) => {
    setDino(k);
    savePref(DINO_KEY, k);
  };

  const join = (e?: FormEvent) => {
    e?.preventDefault();
    if (connecting) return;
    const n = name.trim().slice(0, MAX_NAME);
    savePref(NAME_KEY, n);
    savePref(DINO_KEY, dino);
    connect(n || 'Dino', dino);
  };

  return (
    <div className="menu">
      <MenuScenery />
      <form className="menu-content" onSubmit={join}>
        <header className="menu-title">
          <h1>
            <span className="title-dino">🦖</span>
            Dino <span className="title-accent">Farm</span>
            <span className="title-sprout">🌱</span>
          </h1>
          <p className="menu-tagline">Tame wild plants. Raise dodos. Survive the raids — together.</p>
        </header>

        <section className="dino-grid" aria-label="Choose your dinosaur">
          {DINO_KEYS.map((k) => (
            <DinoCard key={k} id={k} selected={dino === k} onPick={pick} onJoin={join} />
          ))}
        </section>

        <div className="join-row">
          <label className="name-field">
            <span>Your name</span>
            <input
              value={name}
              maxLength={MAX_NAME}
              placeholder="Dino"
              spellCheck={false}
              autoComplete="off"
              disabled={connecting}
              onChange={(e) => setName(e.target.value.slice(0, MAX_NAME))}
              onKeyDown={stopKeys}
              onKeyUp={stopKeys}
            />
          </label>
          <button type="submit" className="join-btn" disabled={connecting}>
            {connecting ? (
              <>
                <span className="spinner" /> Connecting…
              </>
            ) : (
              <>
                Join the farm as {DINO_ICON[dino]} {DINOS[dino].name}
              </>
            )}
          </button>
        </div>
        {error && <div className="menu-error">⚠️ {error}</div>}

        <footer className="howto">
          <span className="howto-title">How to play</span>
          {HOW_TO.map(([k, v]) => (
            <span className="howto-item" key={k}>
              <kbd>{k}</kbd> {v}
            </span>
          ))}
        </footer>
      </form>
    </div>
  );
}

function DinoCard({
  id,
  selected,
  onPick,
  onJoin,
}: {
  id: DinoType;
  selected: boolean;
  onPick: (k: DinoType) => void;
  onJoin: () => void;
}) {
  const d = DINOS[id];
  const style = { '--dino': d.color, '--elem': ELEMENT_COLOR[d.element] } as CSSProperties;
  return (
    <button
      type="button"
      className={`dino-card${selected ? ' selected' : ''}`}
      style={style}
      aria-pressed={selected}
      onClick={() => onPick(id)}
      onDoubleClick={() => onJoin()}
    >
      {selected && <span className="dino-picked">✔ Chosen</span>}
      <div className="dino-art">
        <span className="dino-emoji">{DINO_ICON[id]}</span>
      </div>
      <div className="dino-head">
        <h2>{d.name}</h2>
        <span className="elem-badge">
          {ELEMENT_ICON[d.element]} {d.element}
        </span>
      </div>
      <p className="dino-desc">{d.desc}</p>
      <div className="stats">
        <StatBar label="Health" value={d.hp} frac={d.hp / 200} />
        <StatBar label="Speed" value={d.speed} frac={d.speed / 12} />
      </div>
      <div className="dino-ability">
        <div className="ab-name">
          <kbd>Q</kbd> {d.ability.name} <span className="ab-cd">{d.ability.cd}s</span>
        </div>
        <div className="ab-desc">{d.ability.desc}</div>
      </div>
      <ul className="perks">
        {d.perks.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </button>
  );
}

function StatBar({ label, value, frac }: { label: string; value: number; frac: number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-track">
        <span className="stat-fill" style={{ width: `${clamp01(frac) * 100}%` }} />
      </span>
      <span className="stat-val">{value}</span>
    </div>
  );
}

function MenuScenery() {
  return (
    <div className="scenery" aria-hidden>
      <div className="sun" />
      <div className="cloud c1" />
      <div className="cloud c2" />
      <div className="cloud c3" />
      <div className="volcano-wrap">
        <div className="volcano" />
        <div className="smoke s1" />
        <div className="smoke s2" />
        <div className="smoke s3" />
      </div>
      <div className="ptero-fly">🦅</div>
      <div className="hill h1" />
      <div className="hill h2" />
      <div className="hill h3" />
      <div className="meadow" />
      <div className="flora">
        <span style={{ left: '4%', fontSize: '5.5em' }}>🌴</span>
        <span style={{ left: '13%', fontSize: '3em' }}>🌿</span>
        <span style={{ left: '24%', fontSize: '2.2em' }}>🌻</span>
        <span style={{ left: '71%', fontSize: '2.4em' }}>🍄</span>
        <span style={{ left: '82%', fontSize: '3.2em' }}>🌿</span>
        <span style={{ left: '90%', fontSize: '6em' }}>🌴</span>
      </div>
    </div>
  );
}
