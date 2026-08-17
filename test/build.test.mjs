import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcRecencyScore,
  calcRecencyLevel,
  assignProjectColors,
  orderClientModules,
  MAX_AGE_MS,
  PALETTE,
} from '../build.mjs';

// ── orderClientModules — concat-order guard (TODO #6) ─────────────────────────

test('orderClientModules', async t => {
  await t.test('sorts NN-name.js files lexically (numeric order for 2-digit prefixes)', () => {
    assert.deepEqual(
      orderClientModules(['13-live-updates.js', '00-boot.js', '01-data.js', '00-core.js']),
      ['00-boot.js', '00-core.js', '01-data.js', '13-live-updates.js'],
    );
  });

  await t.test('throws on a name that breaks numeric ordering (e.g. 09b-)', () => {
    assert.throws(() => orderClientModules(['09-matrix.js', '09b-sneaky.js']), /09b-sneaky\.js/);
  });

  await t.test('throws on a missing two-digit prefix', () => {
    assert.throws(() => orderClientModules(['helpers.js']), /helpers\.js/);
  });

  await t.test('accepts every real client module', async () => {
    const fs = await import('node:fs');
    const real = fs.readdirSync(new URL('../experience/client', import.meta.url))
      .filter(f => f.endsWith('.js'));
    assert.deepEqual(orderClientModules(real), [...real].sort());
  });
});

// ── calcRecencyScore ──────────────────────────────────────────────────────────

test('calcRecencyScore', async t => {
  const now = Date.now();

  await t.test('returns 0 for null timestamp', () => {
    assert.equal(calcRecencyScore(null, now), 0);
  });
  await t.test('returns 0 for undefined timestamp', () => {
    assert.equal(calcRecencyScore(undefined, now), 0);
  });
  await t.test('returns 1 for timestamp equal to reference', () => {
    const ts = new Date(now).toISOString();
    assert.equal(calcRecencyScore(ts, now), 1);
  });
  await t.test('returns 0 for timestamp exactly at MAX_AGE_MS ago', () => {
    const ts = new Date(now - MAX_AGE_MS).toISOString();
    assert.equal(calcRecencyScore(ts, now), 0);
  });
  await t.test('returns 0 (clamped) for timestamp older than MAX_AGE_MS', () => {
    const ts = new Date(now - MAX_AGE_MS * 2).toISOString();
    assert.equal(calcRecencyScore(ts, now), 0);
  });
  await t.test('returns value between 0 and 1 for recent timestamp', () => {
    const ts = new Date(now - MAX_AGE_MS / 2).toISOString();
    const score = calcRecencyScore(ts, now);
    assert.ok(score > 0 && score < 1, `expected 0 < ${score} < 1`);
  });
  await t.test('score is approximately 0.5 for timestamp at half MAX_AGE_MS', () => {
    const ts = new Date(now - MAX_AGE_MS / 2).toISOString();
    const score = calcRecencyScore(ts, now);
    assert.ok(Math.abs(score - 0.5) < 0.001, `expected ~0.5, got ${score}`);
  });
  await t.test('future timestamp returns value > 1 (no upper clamp in the formula)', () => {
    // Math.max(0, …) only clamps at 0; a future ts makes the numerator negative
    // so 1 - (negative) > 1. Documenting observed behaviour.
    const ts = new Date(now + 60_000).toISOString();
    const score = calcRecencyScore(ts, now);
    assert.ok(score > 1, `expected > 1 for future ts, got ${score}`);
  });
});

// ── calcRecencyLevel ──────────────────────────────────────────────────────────

test('calcRecencyLevel', async t => {
  const now = Date.now();

  await t.test('returns 0 for null timestamp', () => {
    assert.equal(calcRecencyLevel(null, now), 0);
  });
  await t.test('returns 0 for undefined timestamp', () => {
    assert.equal(calcRecencyLevel(undefined, now), 0);
  });
  await t.test('returns 3 for timestamp 2 minutes ago (< 5 min)', () => {
    const ts = new Date(now - 2 * 60 * 1000).toISOString();
    assert.equal(calcRecencyLevel(ts, now), 3);
  });
  await t.test('returns 3 for timestamp just under 5 minutes ago', () => {
    const ts = new Date(now - 4 * 60 * 1000 - 59 * 1000).toISOString();
    assert.equal(calcRecencyLevel(ts, now), 3);
  });
  await t.test('returns 2 for timestamp 10 minutes ago (< 15 min, >= 5 min)', () => {
    const ts = new Date(now - 10 * 60 * 1000).toISOString();
    assert.equal(calcRecencyLevel(ts, now), 2);
  });
  await t.test('returns 1 for timestamp 12 hours ago (< 2 days, >= 15 min)', () => {
    const ts = new Date(now - 12 * 3600 * 1000).toISOString();
    assert.equal(calcRecencyLevel(ts, now), 1);
  });
  await t.test('returns 0 for timestamp 3 days ago', () => {
    const ts = new Date(now - 3 * 24 * 3600 * 1000).toISOString();
    assert.equal(calcRecencyLevel(ts, now), 0);
  });
  await t.test('boundary: exactly 5 minutes ago is level 2, not 3', () => {
    const ts = new Date(now - 5 * 60 * 1000).toISOString();
    assert.equal(calcRecencyLevel(ts, now), 2);
  });
  await t.test('boundary: exactly 15 minutes ago is level 1, not 2', () => {
    const ts = new Date(now - 15 * 60 * 1000).toISOString();
    assert.equal(calcRecencyLevel(ts, now), 1);
  });
  await t.test('boundary: exactly 2 days ago is level 0', () => {
    const ts = new Date(now - 2 * 24 * 3600 * 1000).toISOString();
    assert.equal(calcRecencyLevel(ts, now), 0);
  });
});

// ── assignProjectColors ───────────────────────────────────────────────────────

test('assignProjectColors', async t => {
  await t.test('assigns colors in alphabetical project id order', () => {
    const projects = [{ id: 'B--src-beta' }, { id: 'A--src-alpha' }];
    const { PROJECT_COLORS } = assignProjectColors(projects, PALETTE);
    assert.equal(PROJECT_COLORS['A--src-alpha'], PALETTE[0]);
    assert.equal(PROJECT_COLORS['B--src-beta'],  PALETTE[1]);
  });

  await t.test('does not mutate the input projects array', () => {
    const projects = [{ id: 'Z' }, { id: 'A' }];
    const original = [...projects];
    assignProjectColors(projects, PALETTE);
    assert.deepEqual(projects.map(p => p.id), original.map(p => p.id));
  });

  await t.test('wraps around palette when project count exceeds palette length', () => {
    const projects = Array.from(
      { length: PALETTE.length + 1 },
      (_, i) => ({ id: `proj-${String(i).padStart(2, '0')}` })
    );
    const { PROJECT_COLORS } = assignProjectColors(projects, PALETTE);
    assert.equal(PROJECT_COLORS['proj-00'], PALETTE[0]);
    assert.equal(PROJECT_COLORS[`proj-${String(PALETTE.length).padStart(2, '0')}`], PALETTE[0]);
  });

  await t.test('COLOR_TO_INDEX maps each palette color to its palette index', () => {
    const projects = [{ id: 'Z' }, { id: 'A' }];
    const { COLOR_TO_INDEX } = assignProjectColors(projects, PALETTE);
    assert.equal(COLOR_TO_INDEX[PALETTE[0]], 0);
    assert.equal(COLOR_TO_INDEX[PALETTE[1]], 1);
  });

  await t.test('handles empty project list without throwing', () => {
    const { PROJECT_COLORS, COLOR_TO_INDEX } = assignProjectColors([], PALETTE);
    assert.deepEqual(PROJECT_COLORS, {});
    assert.deepEqual(COLOR_TO_INDEX, {});
  });

  await t.test('single project gets first palette color', () => {
    const { PROJECT_COLORS } = assignProjectColors([{ id: 'solo' }], PALETTE);
    assert.equal(PROJECT_COLORS['solo'], PALETTE[0]);
  });
});

// ── loadClusterOverrides ──────────────────────────────────────────────────────

test('loadClusterOverrides', async t => {
  const { loadClusterOverrides } = await import('../build.mjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaaro-overrides-'));

  await t.test('returns null when the file is absent', () => {
    assert.equal(loadClusterOverrides(path.join(dir, 'nope.json')), null);
  });

  await t.test('returns the parsed object for a valid file', () => {
    const p = path.join(dir, 'valid.json');
    const obj = { version: 1, projects: { 'proj-a': { pin: ['s1'] } } };
    fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
    assert.deepEqual(loadClusterOverrides(p), obj);
  });

  await t.test('returns null (no throw) for malformed JSON', () => {
    const p = path.join(dir, 'broken.json');
    fs.writeFileSync(p, '{ not json', 'utf8');
    assert.equal(loadClusterOverrides(p), null);
  });

  await t.test('returns null (no throw) for schema-invalid content', () => {
    const p = path.join(dir, 'invalid.json');
    fs.writeFileSync(p, JSON.stringify({ version: 99 }), 'utf8');
    assert.equal(loadClusterOverrides(p), null);
  });
});
