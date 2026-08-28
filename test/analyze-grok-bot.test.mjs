/**
 * test/analyze-grok-bot.test.mjs → hooks/analyzers/analyze-grok-bot.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseGrokBotRecords, scanGrokBotSessions, grokBotRoot, readGrokBotProfile,
} from '../hooks/analyzers/analyze-grok-bot.mjs';
import { locateGrokBotSession } from '../hooks/session-locators.mjs';
import { getHarness } from '../hooks/registry.mjs';

const SESSION_ID = '348c59d5-3636-4efd-aac2-465d3881629c';

const GOLDEN_LINES = [
  '{"role":"user","message":{"content":[{"type":"text","text":"Check D:/src/kaaroSessions and add grok-bot harness support"}]}}',
  '{"role":"assistant","message":{"content":[{"type":"text","text":"Looking at the harness layout first."}]}}',
  '{"role":"assistant","message":{"content":[{"type":"tool_use","name":"send_message","input":{"text":{"content":"On it. Looking at kaaroSessions first."}}}]}}',
  '{"role":"tool","message":{"content":[{"type":"tool_result","name":"send_message","result":{"success":{"timestamp":"1787860893175","messageId":"t0s0"}}}]}}',
  '{"role":"assistant","message":{"content":[{"type":"tool_use","name":"shell","input":{"command":"git status -sb","workingDirectory":"D:/src/kaaroSessions","description":"Check git status"}}]}}',
  '{"role":"tool","message":{"content":[{"type":"tool_result","name":"shell","result":{"success":{"command":"git status -sb","workingDirectory":"D:/src/kaaroSessions","stdout":"## kaaro/feat/add-grok-bot","executionTime":200},"isBackground":false}}]}}',
  '{"role":"assistant","message":{"content":[{"type":"tool_use","name":"read","input":{"path":"docs/harnesses.md"}}]}}',
  '{"role":"tool","message":{"content":[{"type":"tool_result","name":"read","result":{"error":{"errorMessage":"Path is outside the allowed local-exec root"}}}]}}',
];

function makeAgentData(prefix) {
  const root = join(tmpdir(), prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  mkdirSync(join(root, 'agent-transcripts', SESSION_ID), { recursive: true });
  mkdirSync(join(root, 'agents', SESSION_ID), { recursive: true });
  mkdirSync(join(root, 'agent-transcripts', 'sand-subagent-deadbeef-0000-0000-0000-000000000000'), { recursive: true });
  writeFileSync(
    join(root, 'agent-transcripts', SESSION_ID, `${SESSION_ID}.jsonl`),
    GOLDEN_LINES.join('\n') + '\n',
    'utf8',
  );
  writeFileSync(
    join(root, 'agent-transcripts', 'sand-subagent-deadbeef-0000-0000-0000-000000000000', 'sand-subagent-deadbeef-0000-0000-0000-000000000000.jsonl'),
    '{"role":"user","message":{"content":[{"type":"text","text":"subagent is softly linked"}]}}\n',
    'utf8',
  );
  writeFileSync(
    join(root, 'agents', SESSION_ID, 'profile.json'),
    JSON.stringify({ name: 'Harness gardener', description: 'test agent', title: 'Gardener' }),
    'utf8',
  );
  writeFileSync(join(root, 'box-secrets.json'), '{"token":"nope"}', 'utf8');
  return root;
}

test('parseGrokBotRecords — identity + ai_title from opts', () => {
  const records = GOLDEN_LINES.map(l => JSON.parse(l));
  const session = parseGrokBotRecords(records, SESSION_ID, { ai_title: 'Harness gardener' });
  assert.equal(session.harness, 'grok-bot');
  assert.equal(session.session_id, SESSION_ID);
  assert.equal(session.project_id, 'grok-bot');
  assert.equal(session.project_label, 'Grok Bot');
  assert.equal(session.ai_title, 'Harness gardener');
  assert.equal(session.slug, SESSION_ID.slice(0, 8));
  assert.equal(session.user_turns, 1);
  assert.equal(session.assistant_turns, 1);
  assert.equal(session.tool_calls, 2);
  assert.equal(session.branches.length, 0);
  assert.equal(session.subagent_count, 0);
  assert.equal(session.context_resets, 0);
});

test('scanGrokBotSessions — fake agent-data tree includes sand-subagent, ignores secrets', () => {
  const root = makeAgentData('kaaro-gb-scan');
  try {
    const result = scanGrokBotSessions(root);
    assert.ok(result);
    assert.equal(result.harness, 'grok-bot');
    assert.equal(result.source_dir, root);
    assert.equal(result.sessions.length, 2);
    const ids = result.sessions.map(x => x.session_id).sort();
    assert.deepEqual(ids, [SESSION_ID, 'sand-subagent-deadbeef-0000-0000-0000-000000000000'].sort());
    const s = result.sessions.find(x => x.session_id === SESSION_ID);
    assert.equal(s.ai_title, 'Harness gardener');
    assert.equal(s.tool_calls, 2);
    assert.equal(s.harness, 'grok-bot');
    assert.ok(s.file_size_bytes > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanGrokBotSessions — honors GROK_BOT_AGENT_DATA when no root arg', () => {
  const root = makeAgentData('kaaro-gb-env');
  const prev = process.env.GROK_BOT_AGENT_DATA;
  process.env.GROK_BOT_AGENT_DATA = root;
  try {
    assert.equal(grokBotRoot(), root);
    const result = scanGrokBotSessions();
    assert.equal(result.sessions.length, 2);
    assert.equal(result.sessions.find(x => x.session_id === SESSION_ID).ai_title, 'Harness gardener');
  } finally {
    if (prev === undefined) delete process.env.GROK_BOT_AGENT_DATA;
    else process.env.GROK_BOT_AGENT_DATA = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanGrokBotSessions — missing root returns null', () => {
  assert.equal(scanGrokBotSessions('Z:/definitely/not/a/grok-bot-tree'), null);
});

test('locateGrokBotSession — exact id and 8-char slug', () => {
  const root = makeAgentData('kaaro-gb-loc');
  try {
    const exact = locateGrokBotSession(SESSION_ID, root);
    assert.ok(exact);
    assert.equal(exact.sessionId, SESSION_ID);
    assert.equal(exact.projectId, 'grok-bot');
    assert.ok(exact.filePath.replace(/\\/g, '/').endsWith(`${SESSION_ID}.jsonl`));

    const slug = locateGrokBotSession(SESSION_ID.slice(0, 8), root);
    assert.ok(slug);
    assert.equal(slug.sessionId, SESSION_ID);

    const sub = locateGrokBotSession('sand-subagent-deadbeef-0000-0000-0000-000000000000', root);
    assert.ok(sub);
    assert.equal(sub.sessionId, 'sand-subagent-deadbeef-0000-0000-0000-000000000000');
    assert.equal(sub.projectId, 'grok-bot');
    assert.equal(locateGrokBotSession('no-such-session', root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('readGrokBotProfile — name is ai_title; missing file is null', () => {
  const root = makeAgentData('kaaro-gb-prof');
  try {
    assert.equal(readGrokBotProfile(root, SESSION_ID).ai_title, 'Harness gardener');
    assert.equal(readGrokBotProfile(root, 'missing-uuid').ai_title, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('registry descriptor — grok-bot watch matches agent-transcripts jsonl', () => {
  const h = getHarness('grok-bot');
  assert.ok(h);
  assert.equal(h.label, 'Grok Bot');
  assert.equal(h.capabilities.tokens, false);
  assert.equal(h.capabilities.pulse, true);
  assert.equal(h.capabilities.trace, true);
  assert.equal(h.capabilities.context_resets, false);
  assert.equal(h.capabilities.ai_title, true);
  assert.equal(h.capabilities.subagent_count, false);
  assert.equal(h.capabilities.branches, false);
  assert.equal(h.capabilities.size_proxy, 'tool_calls');

  const rel = `agent-transcripts/${SESSION_ID}/${SESSION_ID}.jsonl`;
  assert.ok(h.watch.matchLogFile(rel));
  assert.ok(h.watch.matchLogFile(rel.replace(/\//g, '\\')));
  assert.ok(h.watch.matchLogFile(`agent-transcripts/${'sand-subagent-deadbeef-0000-0000-0000-000000000000'}/${'sand-subagent-deadbeef-0000-0000-0000-000000000000'}.jsonl`));
  assert.equal(h.watch.matchLogFile('agents/x/profile.json'), false);
  assert.equal(h.watch.matchLogFile('box-secrets.json'), false);

  const ctx = h.watch.ctxFromPath(rel);
  assert.equal(ctx.harness, 'grok-bot');
  assert.equal(ctx.session_id, SESSION_ID);
  assert.equal(ctx.slug, SESSION_ID.slice(0, 8));
  assert.equal(ctx.project_id, 'grok-bot');
  assert.equal(ctx.project_label, 'Grok Bot');
  assert.equal(h.watch.rebuildArg(rel), null);
});

test('grokBotSlug -- sand-subagent parse/locate/ctxFromPath uniqueness', () => {
  const parent = '348c59d5-3636-4efd-aac2-465d3881629c';
  const subA = 'sand-subagent-25c32331-e9ad-4b12-9c0a-aaaaaaaaaaaa';
  const subB = 'sand-subagent-deadbeef-0000-0000-0000-000000000000';
  const root = join(tmpdir(), 'kaaro-gb-slug-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  mkdirSync(join(root, 'agent-transcripts', parent), { recursive: true });
  mkdirSync(join(root, 'agent-transcripts', subA), { recursive: true });
  mkdirSync(join(root, 'agent-transcripts', subB), { recursive: true });
  mkdirSync(join(root, 'agents', parent), { recursive: true });
  writeFileSync(join(root, 'agent-transcripts', parent, parent + '.jsonl'), GOLDEN_LINES.join('\n') + '\n', 'utf8');
  writeFileSync(join(root, 'agent-transcripts', subA, subA + '.jsonl'), '{"role":"user","message":{"content":[{"type":"text","text":"sub A"}]}}\n', 'utf8');
  writeFileSync(join(root, 'agent-transcripts', subB, subB + '.jsonl'), '{"role":"user","message":{"content":[{"type":"text","text":"sub B"}]}}\n', 'utf8');
  try {
    const parsed = parseGrokBotRecords(GOLDEN_LINES.map(l => JSON.parse(l)), subA, {});
    assert.equal(parsed.slug, '25c32331');

    const byUuid = locateGrokBotSession('25c32331', root);
    assert.ok(byUuid);
    assert.equal(byUuid.sessionId, subA);

    const byDead = locateGrokBotSession('deadbeef', root);
    assert.ok(byDead);
    assert.equal(byDead.sessionId, subB);

    const byParent = locateGrokBotSession('348c59d5', root);
    assert.ok(byParent);
    assert.equal(byParent.sessionId, parent);

    assert.equal(locateGrokBotSession('sand-sub', root), null, 'sand-sub is not a unique hit on every subagent');

    const h = getHarness('grok-bot');
    const ctx = h.watch.ctxFromPath('agent-transcripts/' + subA + '/' + subA + '.jsonl');
    assert.equal(ctx.slug, '25c32331');
    assert.equal(ctx.session_id, subA);
    const pctx = h.watch.ctxFromPath('agent-transcripts/' + parent + '/' + parent + '.jsonl');
    assert.equal(pctx.slug, '348c59d5');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});