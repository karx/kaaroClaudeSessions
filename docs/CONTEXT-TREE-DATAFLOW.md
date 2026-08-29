# Context Tree Dataflow — Visual Understanding

**Focus:** How a session transcript becomes `turn.text`, which the Thread View renders as `.thr-turn-text`.  
**Status:** Current architecture (post NR-unified reconstruction).  
**Primary modules:** `hooks/adapters/*` → `hooks/trace-tree.mjs` → `surface/trace-service.mjs` → `experience/client/17-trace-panel.js` + `18-thread-view.js`

---

## 1. Big picture

The Context Tree is **not** part of the analyze/build graph pipeline. It is an **on-demand reconstruction** served by `/api/trace/:session_id` when the user expands CONTEXT WINDOWS or opens VIEW THREAD.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  GRAPH PIPELINE (offline / rebuild)                                         │
│  raw logs → analyze → sessions-data.json → buildGraph → graph.html          │
│  Session node only knows: context_resets count, harness, label, …           │
│  It does NOT contain turn text.                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                         user clicks session /
                         expands CONTEXT WINDOWS
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TRACE PATH (on-demand, mtime-cached)                                       │
│                                                                             │
│  resolveSessionFile(id)                                                     │
│       → readSessionRecords(filePath)     // harness-specific I/O            │
│       → adapter(records)                 // → NormalizedRecord[]            │
│       → reconstructTraceFromNRs(nrs)     // → { ai_title, segments[] }      │
│       → JSON over HTTP                                                      │
│       → window._traceCache                                                  │
│       → 17 strips  |  18 thr-turn-text                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Boundary rule:** Experience UI never reads harness JSONL. It only consumes the Observability Surface (`GET /api/trace/...`). Adapters are the only place that understand raw shapes.

---

## 2. End-to-end flow (with file roles)

```
  Browser: expand / openThread(sessionId)
       │
       │  GET /api/trace/:sessionId     (experience never reads raw logs)
       ▼
  surface/http-routes.mjs
       │  capabilities.trace? else 404
       ▼
  resolveSessionFile(id)  ──►  { filePath, projectId, harness }
       │
       ▼
  createTraceService().buildTrace(...)
       │
       ├─ readSessionRecords(filePath)   // registry, harness I/O
       ├─ adapter(records)               // → NormalizedRecord[]
       ├─ reconstructTraceFromNRs(nrs, traceOpts)
       └─ mtime cache on filePath
       │
       ▼ JSON { session_id, project_id, ai_title, segments }
       │
       ▼
  window._traceCache ──┬──► 17-trace-panel (strips, no turn text)
                       └──► 18-thread-view (.thr-turn-text from turn.text)
```

| Layer | Module | Responsibility |
|---|---|---|
| Locate | `surface/session-resolver.mjs` | Session UUID → log file path + harness id |
| Read | `registry.readSessionRecords` | Harness-specific raw parse (JSONL / Grok dir / opencode storage / …) |
| Normalize | `hooks/adapters/*.mjs` | Raw → `NormalizedRecord[]` (the harness hop) |
| Reconstruct | `hooks/trace-tree.mjs` | NRs → segments + turns + tool_calls |
| Cache + serve | `surface/trace-service.mjs` + `http-routes.mjs` | mtime cache; 404 if `capabilities.trace === false` |
| Preview UI | `17-trace-panel.js` | Segment strips (no turn text) |
| Thread UI | `18-thread-view.js` | Full turns; emits `.thr-turn-text` |

---

## 3. Data model (what `/api/trace` returns)

```
ContextTree
├── session_id, project_id          // stamped by trace-service
├── ai_title: string | null         // session_meta NR or opts.ai_title
└── segments[]                      // delimited by context_reset NRs
    └── Segment
        ├── index, ts_start, ts_end
        ├── user_turns, assistant_turns, tool_calls
        ├── subagent_count, thinking_count
        ├── permission_modes[], branches[]
        ├── tool_summary: { [toolName]: count }
        ├── tokens: { output, cache_read }
        ├── compact_trigger: 'auto' | null   // null = current (open) window
        └── turns[]                 // Phase 2 conversation detail
            └── Turn
                ├── role: 'user' | 'assistant'
                ├── ts
                ├── text: string | null     ◄── THIS becomes thr-turn-text
                ├── tool_calls[]
                ├── has_thinking
                ├── usage, duration_ms, stop_reason
                └── ToolCall { id, name, input, is_error, error_text }
```

Segments map 1:1 to **context windows** (between compact / context_reset events). The last segment has `compact_trigger: null` (still open).

---

## 4. The `thr-turn-text` story

### 4.1 Where the DOM class is born

`experience/client/18-thread-view.js` — `_renderTurn(turn)`:

```
turn.text truthy?
   │
   yes ──► <div class="thr-turn-text">
               ${esc(turn.text)}
               ${turn.text.length >= 500 ? '<span class="thr-truncated">…</span>' : ''}
            </div>
   no  ──► (omit text block; tools may still render)
```

CSS lives in `experience/pages/template.html` (`.thr-turn-text`, `.thr-turn-asst .thr-turn-text`, max-height 200px, pre-wrap).

**`thr-turn-text` is pure presentation.** It does not compute text; it HTML-escapes `turn.text` from the API payload.

### 4.2 Where `turn.text` is produced

All text assembly is inside `hooks/trace-tree.mjs` → `reconstructTraceFromNRs`.

There are **two independent text paths**:

```
                    NormalizedRecords (chronological)
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
      kind: user_turn                  kind: content_block
              │                          block_type: 'text'
              │                                │
              ▼                                ▼
   text = nr.display_text           pending.parts.push({ text, chunk })
          ?? nr.text
          ?? null                              │
              │                                │  (held open — pending asst)
              ▼                                ▼
   seg.turns.push({                 _flushPending() →
     role: 'user',                    _assembleText(parts) →
     text                              role: 'assistant', text
   })
```

#### User path

```js
// trace-tree.mjs — case 'user_turn'
const text = nr.display_text ?? nr.text ?? null;
if (text) {
  seg.turns.push({ role: 'user', ts, text, tool_calls: [], ... });
}
```

| Field | Semantics |
|---|---|
| `display_text` | **Per-turn** human text for thread/trace (preferred) |
| `text` | **First-user-message** / session-bundle semantics (fallback) |

If both are null (e.g. tool-result-only user envelope), **no user turn object is pushed** — bookkeeping stays invisible in the thread.  
**Caveat:** `seg.user_turns` still increments for that NR (counter ≠ rendered turn list).

**User text is not capped inside `reconstructTraceFromNRs`.** Long `nr.text` / `nr.display_text` pass through as-is (opencode/copilot can exceed 500).

#### Assistant path

```js
// content_block text fragments accumulate on pending
// ONLY block_type === 'text' with nr.text contributes to thr-turn-text
// block_type === 'thinking' → has_thinking + thinking_count only
// other block_types (e.g. command-code 'reasoning') are ignored today
pending.parts.push({ text: nr.text, chunk: !!nr.chunk });

// on flush:
text: _assembleText(pending.parts)
// joins with '\n' unless chunk:true (then concatenates raw)
// then: .trim().slice(0, 500) || null
```

| `chunk` flag | Join rule | Typical harness |
|---|---|---|
| `false` / absent | Separate blocks with `\n` | claude-code, opencode, command-code |
| `true` | Concatenate with no separator | grok streamed `agent_message_chunk` |

### 4.3 Cap at 500 characters (symmetric)

| Layer | User text | Assistant text |
|---|---|---|
| Adapter | CC/command-code/grok often `display_text` ≤500; pi `text` ≤200 | varies |
| `trace-tree` | `_capTurnText` ≤500 on `display_text ?? text` | `_assembleText` → `_capTurnText` ≤500 |
| UI | shows `turn.text` as returned; `…` badge if `length >= 500` | same |

`.thr-turn-text` is always ≤500 chars from the API. All turn text rows (user + asst) are click-to-copy — grep `data-thr-copy` / `thr-turn-text-copy`.

---

## 5. Pending-assistant pattern (why text is deferred)

Assistant tool results arrive **after** the tool_use, often on a following user/tool record. The reconstructor keeps one open assistant turn (`pending`) until:

1. The next `user_turn` arrives  
2. The next `assistant_turn` arrives (consecutive assistants)  
3. A `context_reset` closes the segment  
4. End of stream  

```
time ──────────────────────────────────────────────────────────────►

NR: assistant_turn
NR: content_block text "I'll check…"     ─┐
NR: tool_use Read id=T1                   │  pending open
NR: tool_result T1 error=false            │  (toolById pairs result)
NR: user_turn display_text="looks good"  ─┴─ _flushPending()
                                            then emit user turn
```

During `_flushPending`, `turn.text` is finalized via `_assembleText`. Tool error flags can still attach later by `tool_id` even after flush (tool objects stay in `toolById` for the segment).

See also: `notes/skills/pending-asst-pattern.md`.

---

## 6. Segment / Context Window setup

```
_newSegment(0)
     │
     │  ... turns, tools, tokens accumulate ...
     │
     ▼
context_reset NR  ──►  _closeSegment('auto')
                         • flush pending
                         • push seg (compact_trigger = 'auto')
                         • new empty segment
                         • reset toolById
     │
     │  ... more turns ...
     │
     ▼
EOF  ──►  _flushPending(); if hasContent push final seg (compact_trigger = null)
```

**Source of `context_reset` by harness (examples):**

| Harness | Raw signal → NR |
|---|---|
| claude-code | `system` / `compact_boundary` → `context_reset` |
| grok | `auto_compact_completed` / `compaction_checkpoint` → `context_reset` |
| others | Often no resets → single segment |

UI:

- **17-trace-panel:** one strip per segment; width ∝ tokens; color ∝ dominant tool; `⟲` between strips  
- **18-thread-view:** one `.thr-seg` block per segment; `⟲ context reset` divider when `compact_trigger === 'auto'`

---

## 7. Adapter → text field matrix

How each harness feeds the fields that become `thr-turn-text`:

| Harness | User `display_text` | User `text` (fallback) | Asst text source | Trace? |
|---|---|---|---|---|
| **claude-code** | Human text ≤500 from text blocks; hybrid text+tool_result keeps prose; tool-result-only → null | First user msg only (stripped) | `content_block` `block_type:'text'` | ✅ |
| **codex** | Human `input_text` ≤500 after environment/plugin wrapper stripping | First user msg only | Assistant `output_text` and live `agent_message` → `content_block` text; reasoning → `thinking` | ✅ |
| **command-code** | Same hybrid rules as CC | First user msg only | `text` + `reasoning`→`thinking` | ✅ |
| **grok** | every user chunk ≤500 | ≤200 if ≥8 chars | `content_block` text with **`chunk:true`** | ✅ |
| **opencode** | — | `firstText(_parts)` (capped in trace-tree) | Assistant parts → `content_block` text; reasoning → `thinking` | ✅ |
| **copilot** | — | `req.message.text` (capped in trace-tree) | Response items → text/thinking blocks | ✅ |
| **pi** | — | **every** user msg ≥8 chars, ≤200 | Assistant `text`/`thinking` content_blocks | ✅ |
| **antigravity** | Minimal | — | No assistant text in NRs | ❌ `trace: false` |

**Implication:** rich `.thr-turn-text` depends on adapters emitting either `display_text` (user) or `content_block` with `block_type:'text'` (assistant). Capability `trace: true` gates the endpoint; it does not guarantee full prose for every harness.

Codex-specific trace details are documented in [CODEX.md](./CODEX.md#trace-support).

---

## 8. Worked example (Claude Code → thr-turn-text)

**Raw JSONL (simplified):**

```jsonl
{"type":"user","message":{"content":[{"type":"text","text":"Fix the flaky test"}]},"timestamp":"..."}
{"type":"assistant","message":{"content":[
  {"type":"text","text":"I'll inspect the failing test."},
  {"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"test/foo.test.mjs"}}
]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"..."}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Found a race on line 42."}]}}
```

**Normalized (relevant):**

```
user_turn     { display_text: "Fix the flaky test", text: "Fix the flaky test" }
assistant_turn
content_block { block_type: "text", text: "I'll inspect the failing test." }
tool_use      { tool: "Read", tool_id: "t1", input: {...} }
user_turn     { display_text: null, text: null }   // tool_results only
tool_result   { tool_id: "t1", error: false }
assistant_turn
content_block { block_type: "text", text: "Found a race on line 42." }
```

**Reconstructed turns:**

```
turns[0] user      text: "Fix the flaky test"
turns[1] assistant text: "I'll inspect the failing test."
         tool_calls: [{ name: "Read", input: { file_path: "..." } }]
turns[2] assistant text: "Found a race on line 42."
```

**DOM:**

```html
<div class="thr-turn thr-turn-user">
  <div class="thr-turn-hd">…USER…</div>
  <div class="thr-turn-text">Fix the flaky test</div>
</div>
<div class="thr-turn thr-turn-asst">
  <div class="thr-turn-hd">…ASST…</div>
  <div class="thr-turn-text">I'll inspect the failing test.</div>
  <div class="thr-tcs">…Read test/foo.test.mjs…</div>
</div>
…
```

---

## 9. Setup / activation sequence in the browser

```
1. build.mjs injects TRACE_HARNESSES (Set of harness ids with capabilities.trace)
2. User selects a session node → showPanel()
3. 17-trace-panel.traceSection(d):
     - if harness not in TRACE_HARNESSES → no section
     - else render "◆ CONTEXT WINDOWS (n)" header + collapsed body
4. User expands header:
     - fetch /api/trace/:id  (or use _traceCache)
     - render strips + "◆ VIEW THREAD" button
5. User clicks VIEW THREAD (or openThread(id)):
     - #thread-view overlay opens
     - same cache / fetch
     - for each segment → _segBlock → each turn → _renderTurn
     - turn.text → .thr-turn-text
6. Escape / ✕ → closeThread()
```

Server-side setup for the same request:

```
createTraceService()
  buildTrace(filePath, projectId, sessionId, harnessId)
    getHarness(harnessId)
    if !readSessionRecords → null
    mtime cache hit? return tree
    { records, traceOpts } = readSessionRecords(filePath)
    nrs = adapter(records)
    tree = { session_id, project_id, ...reconstructTraceFromNRs(nrs, traceOpts) }
    cache.set(filePath, { mtime, tree })
```

`traceOpts` is the side channel for harnesses that store title/branch outside the transcript (e.g. Grok `summary.json` → `{ ai_title, git_branch }`).

---

## 10. Transform pipeline (pure functions only)

```
records (raw)          adapter-specific shapes
        │
        │  recordsToNormalized
        ▼
NormalizedRecord[]     kind ∈ user_turn | assistant_turn | content_block |
                       tool_use | tool_result | tokens | context_reset | …
        │
        │  reconstructTraceFromNRs   (pure, no I/O)
        ▼
{ ai_title, segments }  turns[].text already capped & assembled
        │
        │  HTTP JSON + client esc()
        ▼
.thr-turn-text          escaped HTML in the Thread View
```

Nothing in this path mutates graph state. Live SSE pulses (`tool_call`, `words`, …) are a **sibling** stream from the same adapters via `pulse-transformer` — they do not populate the context tree.

---

## 11. What is intentionally out of scope today

| Item | Status |
|---|---|
| Subagent nesting (Agent → child session tree) | **CC linked/loaded** via `capabilities.subagent_tree`: discover flat `parent/subagents/agent-*` (siblings at any `spawnDepth` — not nested dirs) + meta.toolUseId, nest in `/api/trace` (`tree.subagents`, `turn.spawned_subagents`). Graph carries **stubs** + opt-in spawn satellites. Sidechains never enter the session scanner or rollups. |
| Full tool result bodies in the thread | Only error flag + short `error_text` |
| Write file content in tool rows | Stripped by `_sanitizeInput` |
| Thinking prose in thr-turn-text | Thinking sets `has_thinking` badge only, not body text |
| Graph-time precompute of segments | Still on-demand (`/api/trace`); graph has `context_resets` + subagent **stubs** (not full nested trees) |
| Graph spawn edges / type:`subagent` nodes | **Shipped opt-in** (same as stubs row): `includeSubagentNodes` + **Subagent spawn edges** checkbox (default off). Ids `subagent:<parent>:<agentId>`; never type:`session`. |

---

## 12. Quick reference — files to open

| Concern | File |
|---|---|
| Text assembly + segment logic | `hooks/trace-tree.mjs` |
| NR field contract (`display_text`, `content_block`) | `hooks/normalized-record.mjs` |
| CC user/assistant → NRs | `hooks/adapters/claude-code.mjs` |
| Grok chunks + chunk flag | `hooks/adapters/grok.mjs` |
| HTTP + capability gate | `surface/http-routes.mjs` |
| mtime cache | `surface/trace-service.mjs` |
| Session locate | `surface/session-resolver.mjs` |
| Strip preview | `experience/client/17-trace-panel.js` |
| **`.thr-turn-text` render** | `experience/client/18-thread-view.js` |
| Styles | `experience/pages/template.html` (`.thr-turn-text`) |
| Parity tests | `test/trace-tree.test.mjs`, `test/trace-service.test.mjs` |
| Original product RFC | `RFC-context-tree-visualization.md` |
| Crystallized summary | `notes/crystallized/context-tree-thread-view.md` |

---

## 13. Mental model (one sentence)

> **Adapters peel harness logs into typed NRs; `reconstructTraceFromNRs` folds those NRs into segment-scoped turns where `turn.text` is either user `display_text`/`text` (uncapped pass-through) or assembled assistant `content_block` text (`block_type:'text'`, 500-char cap); the Thread View escapes that string into `.thr-turn-text`.**

---

## 14. Correctness notes (validated against code + tests)

Validated 2026-07-19 against `hooks/trace-tree.mjs`, adapters, `18-thread-view.js`, and `node --test test/trace-tree.test.mjs test/trace-service.test.mjs` (24/24 pass).

| Claim | Verdict |
|---|---|
| On-demand `/api/trace`, not graph pipeline | ✅ Correct |
| Experience only hits surface HTTP | ✅ Correct |
| `display_text ?? text` user path | ✅ Correct |
| Assistant text only from `content_block` + `block_type:'text'` | ✅ Correct |
| Pending flush on user / assistant / reset / EOF | ✅ Correct |
| tool_result attaches by id after flush (same segment) | ✅ Correct |
| 500-char cap on **all** thr-turn-text | ✅ `_capTurnText` for user + assistant (post-fix) |
| UI shows API text + `…` when length ≥500 | ✅ Honest relative to reconstruct cap |
| Pi assistant thr-turn-text | ✅ Adapter emits text/thinking content_blocks (post-fix) |
| command-code reasoning | ✅ Mapped to `thinking` (post-fix) |
| Hybrid CC/command-code display_text | ✅ Text blocks kept even with tool_results (post-fix) |
| Empty segments possible on compact | ✅ Leading/trailing `context_reset` can push empty segs |
| `user_turns` == rendered user turns | ❌ Counter can exceed `turns.filter(user)` when text null |
