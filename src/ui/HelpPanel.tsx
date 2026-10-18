import type { ReactNode } from 'react';
import {
  ANIMALS,
  BUILDINGS,
  BUILD_ORDER,
  DINOS,
  ENEMIES,
  PLANTS,
  PLANT_ORDER,
  RESOURCE_INFO,
  TAME,
  TRADE,
  TOOLS,
  costText,
  type ResourceKey,
} from '../../shared/constants';
import { useGame } from '../store';
import { DINO_ICON, DINO_KEYS, ELEMENT_COLOR } from './shared';

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look around (click the game to lock)'],
  ['Space', 'Jump · hold to fly (Pteranodon)'],
  ['Shift', 'Sprint'],
  ['Left click', 'Use selected tool'],
  ['Right click', 'Secondary action'],
  ['E', 'Interact · tend · harvest · feed · trade'],
  ['Q', 'Dino ability'],
  ['1 – 8', 'Select tool'],
  ['R', 'Cycle seed species / building'],
  ['T', 'Rotate building'],
  ['X', 'Demolish (hammer)'],
  ['F', 'Eat nectar to heal'],
  ['H', 'Toggle this help'],
  ['Enter', 'Chat'],
  ['Esc', 'Release mouse'],
];

const tradeEntries = Object.entries(TRADE) as [ResourceKey, Partial<Record<ResourceKey, number>>][];

export function HelpPanel() {
  const open = useGame((s) => s.helpOpen);
  if (!open) return null;
  return (
    <div className="help-backdrop">
      <div className="help panel">
        <button type="button" className="help-close" onClick={() => useGame.getState().set({ helpOpen: false })} aria-label="Close help">
          ✕
        </button>
        <h2 className="help-title">🦖 Dino Farm — Field Guide</h2>
        <p className="help-sub">
          Press <kbd>H</kbd> to close
        </p>

        <div className="help-cols">
          <Section title="🎮 Controls">
            <div className="help-controls">
              {CONTROLS.map(([k, v]) => (
                <div key={k} className="help-control">
                  <kbd>{k}</kbd>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            <div className="help-tools">
              {TOOLS.map((t, i) => (
                <span key={t.id} className="help-tool">
                  <kbd>{i + 1}</kbd> {t.icon} {t.name}
                </span>
              ))}
            </div>
          </Section>

          <Section title="🦕 Dino roles">
            <ul className="help-dinos">
              {DINO_KEYS.map((k) => {
                const d = DINOS[k];
                return (
                  <li key={k}>
                    <span className="hd-icon" style={{ background: d.color }}>
                      {DINO_ICON[k]}
                    </span>
                    <div>
                      <b>{d.name}</b>{' '}
                      <span className="tiny-badge" style={{ color: ELEMENT_COLOR[d.element] }}>
                        {d.element}
                      </span>
                      <div className="muted">
                        {d.perks.join(' · ')} · <i>Q</i> {d.ability.name}: {d.ability.desc}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        </div>

        <Section title="🌾 The farming loop">
          <ol className="help-steps">
            <li>
              <b>Shovel</b> clears rough or rocky ground and flattens it. <b>Right click</b> digs down (Shift raises) — dig
              below water level to make a <b>pond</b>.
            </li>
            <li>
              Tiles within <b>2 tiles of water</b> or <b>7m of a Well</b> are <span className="hl-blue">irrigated</span>{' '}
              and stay wet.
            </li>
            <li>
              The <b>Hoe</b> tills grass into soil. Pick a species with <kbd>R</kbd> and <b>plant seeds</b>.
            </li>
            <li>
              <b>Water</b> with the can (refill by using it on water). Plants <b>only grow while watered</b>.
            </li>
          </ol>
        </Section>

        <Section title="🐾 Taming plants">
          <p>
            Press <kbd>E</kbd> on a growing plant to <b>tend</b> it (+{TAME.TEND} tame). It must reach{' '}
            <b>100% tame before it ripens</b> — otherwise ~{TAME.FERAL_GRACE}s after ripening it goes{' '}
            <span className="hl-red">FERAL</span>. Neglected (dry) plants slowly lose tameness.
          </p>
          <p>
            <b>Wild plants</b> out in the world give <b>wild seeds</b> when you press <kbd>E</kbd> — careful, they bite!
            Harvesting <b>tamed</b> plants gives produce + <b>🌟 heirloom seeds</b>, which start {TAME.HEIRLOOM_START}% tame.
          </p>
          <div className="table-wrap">
            <table className="help-table">
              <thead>
                <tr>
                  <th>Plant</th>
                  <th>Grow</th>
                  <th>Produce</th>
                  <th className="hl-green">Tamed bonus</th>
                  <th className="hl-red">If feral</th>
                </tr>
              </thead>
              <tbody>
                {PLANT_ORDER.map((k) => {
                  const p = PLANTS[k];
                  return (
                    <tr key={k}>
                      <td>
                        <b>{p.name}</b>
                        <div className="muted small">{p.desc}</div>
                      </td>
                      <td className="nowrap">
                        {p.growTime}s{p.regrows ? ' ♻️' : ''}
                      </td>
                      <td className="nowrap">{costText(p.produce)}</td>
                      <td>{p.tamed}</td>
                      <td>{p.feral}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">♻️ regrows after harvest</p>
        </Section>

        <div className="help-cols">
          <Section title="🐔 Animals & trade">
            <p>
              Build a <b>{BUILDINGS.coop.name}</b> or <b>{BUILDINGS.barn.name}</b>, then feed the animals with <kbd>E</kbd>{' '}
              (costs {RESOURCE_INFO.food.icon} food). Fed animals produce:
            </p>
            <ul className="help-list">
              {(Object.keys(ANIMALS) as (keyof typeof ANIMALS)[]).map((k) => {
                const a = ANIMALS[k];
                return (
                  <li key={k}>
                    <b>{a.name}</b> → {RESOURCE_INFO[a.produce].icon} {RESOURCE_INFO[a.produce].name} every ~{a.interval}s
                  </li>
                );
              })}
            </ul>
            <p>
              Trade at the <b>{BUILDINGS.house.name}</b> with <kbd>E</kbd>:
            </p>
            <div className="trade-row">
              {tradeEntries.map(([from, to]) => (
                <span key={from} className="trade-chip">
                  1{RESOURCE_INFO[from].icon} → {costText(to)}
                </span>
              ))}
            </div>
          </Section>

          <Section title="🦎 Raids">
            <p>
              Every few minutes huge reptiles attack the farm. Walls and fences block them, Spike Traps and Ballista Towers
              fight back. There is no friendly fire — swing freely!
            </p>
            <ul className="help-list">
              <li>
                <b>{ENEMIES.megalania.name}</b> — fast monitor-lizard packs from the wilds
              </li>
              <li>
                <b>{ENEMIES.sarcosuchus.name}</b> — armoured crocs that crawl out of the lake
              </li>
              <li>
                <b>{ENEMIES.titanoboa.name}</b> — a colossal snake, every 3rd wave
              </li>
            </ul>
          </Section>
        </div>

        <Section title="🔨 Buildings (Hammer)">
          <div className="table-wrap">
            <table className="help-table">
              <thead>
                <tr>
                  <th>Building</th>
                  <th>Cost</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {BUILD_ORDER.map((k) => {
                  const b = BUILDINGS[k];
                  return (
                    <tr key={k}>
                      <td className="nowrap">
                        <b>{b.name}</b>
                      </td>
                      <td className="nowrap">{costText(b.cost)}</td>
                      <td>{b.desc}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <p className="help-foot">
          Press <kbd>H</kbd> to close
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="help-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
