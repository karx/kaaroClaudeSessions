/**
 * test/event-types.test.mjs â€” TDD tests for lib/event-types.mjs
 *
 * Validates the Event Registry schema: every event type has required sonic
 * fields, families are valid, instrument values are strings, and the canonical
 * key sets are complete and consistent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_TYPES,
  TOOL_ACTION_KEYS,
  EVENT_TYPE_KEYS,
  FAMILIES,
} from '../experience/audio/event-registry.mjs';

const REQUIRED_SONIC = ['family', 'instrument', 'pan', 'sendAmt', 'brightness', 'volMult', 'octave', 'desc'];

test('EVENT_TYPES â€” every entry has all required sonic fields', () => {
  for (const [key, entry] of Object.entries(EVENT_TYPES)) {
    for (const field of REQUIRED_SONIC) {
      assert.ok(field in entry, `EVENT_TYPES['${key}'] missing field '${field}'`);
    }
  }
});

test('EVENT_TYPES â€” numeric fields are numbers', () => {
  const numericFields = ['pan', 'sendAmt', 'brightness', 'volMult', 'octave'];
  for (const [key, entry] of Object.entries(EVENT_TYPES)) {
    for (const field of numericFields) {
      assert.equal(typeof entry[field], 'number', `EVENT_TYPES['${key}'].${field} must be number`);
    }
  }
});

test('EVENT_TYPES â€” pan is in [-1, 1]', () => {
  for (const [key, entry] of Object.entries(EVENT_TYPES)) {
    assert.ok(entry.pan >= -1 && entry.pan <= 1, `EVENT_TYPES['${key}'].pan=${entry.pan} out of range`);
  }
});

test('EVENT_TYPES â€” sendAmt is in [0, 1]', () => {
  for (const [key, entry] of Object.entries(EVENT_TYPES)) {
    assert.ok(entry.sendAmt >= 0 && entry.sendAmt <= 1, `EVENT_TYPES['${key}'].sendAmt out of range`);
  }
});

test('EVENT_TYPES â€” instrument is a non-empty string', () => {
  for (const [key, entry] of Object.entries(EVENT_TYPES)) {
    assert.equal(typeof entry.instrument, 'string', `EVENT_TYPES['${key}'].instrument must be string`);
    assert.ok(entry.instrument.length > 0, `EVENT_TYPES['${key}'].instrument must be non-empty`);
  }
});

test('EVENT_TYPES â€” family is a known FAMILIES value', () => {
  for (const [key, entry] of Object.entries(EVENT_TYPES)) {
    assert.ok(FAMILIES.has(entry.family), `EVENT_TYPES['${key}'].family='${entry.family}' unknown`);
  }
});

test('EVENT_TYPES â€” desc is a non-empty string', () => {
  for (const [key, entry] of Object.entries(EVENT_TYPES)) {
    assert.equal(typeof entry.desc, 'string', `EVENT_TYPES['${key}'].desc must be string`);
    assert.ok(entry.desc.length > 0, `EVENT_TYPES['${key}'].desc must be non-empty`);
  }
});

test('TOOL_ACTION_KEYS â€” contains all 10 expected action sub-keys', () => {
  const expected = ['read','write','edit','grep_glob','agent','bash_git','bash_run','bash_other','web','other'];
  for (const k of expected) {
    assert.ok(TOOL_ACTION_KEYS.has(k), `TOOL_ACTION_KEYS missing '${k}'`);
  }
  assert.equal(TOOL_ACTION_KEYS.size, expected.length);
});

test('TOOL_ACTION_KEYS â€” every action key exists in EVENT_TYPES', () => {
  for (const k of TOOL_ACTION_KEYS) {
    assert.ok(k in EVENT_TYPES, `TOOL_ACTION_KEYS has '${k}' but not in EVENT_TYPES`);
  }
});

test('EVENT_TYPE_KEYS â€” equals Object.keys(EVENT_TYPES)', () => {
  const fromObj = new Set(Object.keys(EVENT_TYPES));
  assert.deepEqual(EVENT_TYPE_KEYS, fromObj);
});

test('EVENT_TYPE_KEYS â€” contains all canonical types including unknown', () => {
  const required = [
    // tool-action
    'read','write','edit','grep_glob','agent','bash_git','bash_run','bash_other','web','other',
    // cognitive/stream
    'tokens','words','chirp','human_turn','attachment','mode_shift',
    // structural
    'compact','permission','scaffold','tool_error','tool_result',
    // catch-all
    'unknown',
  ];
  for (const k of required) {
    assert.ok(EVENT_TYPE_KEYS.has(k), `EVENT_TYPE_KEYS missing required key '${k}'`);
  }
});

test('FAMILIES â€” is a Set containing expected family values', () => {
  const expected = ['file', 'system', 'ai', 'context', 'human', 'meta'];
  for (const f of expected) {
    assert.ok(FAMILIES.has(f), `FAMILIES missing '${f}'`);
  }
});

test('unknown â€” has lowest volMult among all types (catch-all is low-weight)', () => {
  const unknownVol = EVENT_TYPES.unknown.volMult;
  const allVols = Object.values(EVENT_TYPES).map(e => e.volMult);
  const minVol = Math.min(...allVols);
  assert.equal(unknownVol, minVol, 'unknown should have the lowest volMult');
});

test('compact â€” has lowest brightness (context limit is dark/heavy)', () => {
  assert.ok(EVENT_TYPES.compact.brightness <= 1500,
    `compact brightness=${EVENT_TYPES.compact.brightness} should be â‰¤1500`);
});

test('human_turn â€” family is human', () => {
  assert.equal(EVENT_TYPES.human_turn.family, 'human');
});

test('scaffold â€” family is system', () => {
  assert.equal(EVENT_TYPES.scaffold.family, 'system');
});

test('unknown â€” family is meta', () => {
  assert.equal(EVENT_TYPES.unknown.family, 'meta');
});

// â”€â”€ toolNameToKey â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { toolNameToKey } from '../experience/audio/event-registry.mjs';

test('toolNameToKey â€” CC tool names', () => {
  assert.equal(toolNameToKey('Read'),        'read');
  assert.equal(toolNameToKey('Write'),       'write');
  assert.equal(toolNameToKey('Edit'),        'edit');
  assert.equal(toolNameToKey('Grep'),        'grep_glob');
  assert.equal(toolNameToKey('Glob'),        'grep_glob');
  assert.equal(toolNameToKey('Agent'),       'agent');
  assert.equal(toolNameToKey('WebFetch'),    'web');
  assert.equal(toolNameToKey('WebSearch'),   'web');
  assert.equal(toolNameToKey('Bash', 'git'), 'bash_git');
  assert.equal(toolNameToKey('Bash', 'node'),'bash_run');
  assert.equal(toolNameToKey('Bash', 'other'),'bash_other');
  assert.equal(toolNameToKey('PowerShell', 'git'), 'bash_git');
  assert.equal(toolNameToKey('Skill'),       'other');
  assert.equal(toolNameToKey('TaskCreate'),  'other');
});

test('toolNameToKey â€” Antigravity tool names', () => {
  assert.equal(toolNameToKey('view_file'),          'read');
  assert.equal(toolNameToKey('write_to_file'),      'write');
  assert.equal(toolNameToKey('replace_file_content'),'edit');
  assert.equal(toolNameToKey('run_command', 'git'), 'bash_git');
  assert.equal(toolNameToKey('run_command', 'node'),'bash_run');
  assert.equal(toolNameToKey('run_command', 'other'),'bash_other');
  assert.equal(toolNameToKey('grep_search'),        'grep_glob');
  assert.equal(toolNameToKey('list_dir'),           'grep_glob');
  assert.equal(toolNameToKey('manage_task'),        'other');
  assert.equal(toolNameToKey('web_fetch'),          'web');
  assert.equal(toolNameToKey('web_search'),         'web');
});

test('toolNameToKey â€” Grok tool names', () => {
  assert.equal(toolNameToKey('Shell', 'git'),     'bash_git');
  assert.equal(toolNameToKey('Shell', 'node'),    'bash_run');
  assert.equal(toolNameToKey('StrReplace'),       'edit');
  assert.equal(toolNameToKey('EditNotebook'),     'edit');
  assert.equal(toolNameToKey('Web search:'),      'web');
});

test('toolNameToKey â€” Pi tool names', () => {
  assert.equal(toolNameToKey('bash', 'git'),  'bash_git');
  assert.equal(toolNameToKey('read'),         'read');
  assert.equal(toolNameToKey('write'),        'write');
  assert.equal(toolNameToKey('glob'),         'grep_glob');
});

test('toolNameToKey â€” unknown returns other', () => {
  assert.equal(toolNameToKey('UnknownTool'), 'other');
  assert.equal(toolNameToKey(''),            'other');
  assert.equal(toolNameToKey(null),          'other');
});
