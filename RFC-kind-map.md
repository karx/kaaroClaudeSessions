# RFC: Generated Kind Map (Harness × KIND × Tool)

**Project:** kaaroSessions
**Status:** Accepted
**Date:** 2026-08-26
**Relates to:** NR contract, pulse map, action keys, public hop, coverage P0
**Grounding:** `public/index.html` hop matrix is hand-authored `nr-seed`; `KIND_PULSE` and adapter goldens already know the truth

---

## 1. Problem

Coverage (which harness emits which NormalizedRecord kind, which raw tool names collapse to which Canonical Action Key) lives in three places that drift:

| Place | What it is | Problem |
|---|---|---|
| `public/index.html` `#nr-seed` | Hand-typed emit `[1,0,1,…]`, pulse names, kindSonic | Rotates independently of adapters. Tests only check shape, not that emit matches what adapters actually emit. |
| `docs/harnesses.md` | Hand-typed capability / quirk matrix | Docs, not a live projection. |
| Graph `tools_top` | Per-session counts | Not a harness × vocabulary grid. |

There is no admin-style HTML surface whose cells are **generated** from the contracts the pipeline already runs: `RECORD_KINDS`, `HARNESS_REGISTRY`, `KIND_PULSE`, adapter goldens + Event Registry samples, `toolNameToKey`.

The hop is a teaching page. It should stay a teaching page. The map is a **coverage instrument**.

---

## 2. Goals

1. **One payload**, `buildKindMapPayload`, pure: traces in, JSON out. No `Date.now`, no I/O.
2. **One widget**, `renderKindMapSnippet(payload)`: HTML fragment. Register A tokens only. No hand-authored cells. Live refresh replaces that fragment; it does not paint cells a second time.
3. **Two projections of the same payload:**
   - **KIND × harness** — kind stub carries disposition (`KIND_PULSE` / route). Cells: ● proved, ○ live-only, – not expected (capability off, idle catch-all), · hole. `content_block` and `tool_result` expand to `KIND_ROUTES` children (pulseDisposition branches). `unknown_record` is catch-all (◇), not emit.
   - **Tool key × harness** — raw `nr.tool` names grouped by `toolNameToKey`. Empty `other` is idle catch-all (–), not a hole.
4. **Serve live:** `GET /mapping` (HTML), `GET /mapping?partial=1` (snippet), `GET /api/kind-map` (JSON). Generated on request from current modules.
5. **Static copy:** `node build.mjs` writes `kind-map.html` (and `public/kind-map.html`) with `live: false` — same widget, no EventSource.
6. A miss is a **coverage signal**, not a bug in the widget. If the golden does not emit `skill_invoke` for Pi, the cell is ·. Fix the golden or the adapter, not the HTML.
7. **Live overlay** uses the existing Stream, not a second pipeline. `createPulseEmitter` already turns JSONL into pulses and `hub.notify`s them. The kind-map store is another sink on that same object. Every pulse carries `nr_kind`. Overlay does **not** infer kinds from `sessions-data.json` rollup fields.

Non-goals:

- Replacing the hop inspector, tape, or opt-in audio. Hop copy may later consume this payload; not this RFC.
- Count metrics (how many times). The map is presence.
- Authoring emit vectors in the registry. Emit is observed from goldens, samples, and pulses.
- A new SSE channel. Lifecycle events (`now`, `status`, `updated`, `error`, `connected`) do not mark kinds.
- Inferring kinds from analyze rollup (`slug` → `session_meta`, `branches` → `branch_change`, …). That heals misses the adapter never emitted.

---

## 3. Design

```
EVENT_TYPES.samples + GOLDEN_SESSIONS
        │
        ▼
 adapters → NRs (tagged golden | sample)
        │
        ▼
 buildKindMapPayload() ── baseline ──► kind-map store
                                      applyKindMapPulse (nr_kind + harness)
                                              │
                    ┌─────────────────────────┴──────────────────┐
                    ▼                                            ▼
              GET /api/kind-map                          GET /mapping
              (JSON + proof)                             EventSource('/events')
                                                         GET /mapping?partial=1
```

### 3.1 Traces (baseline) + live overlay

Baseline per harness (process start):

1. Event Registry sample records for that harness (adapter on `[sample.record]`) — proof `sample`.
2. The golden multi-record session already used by `nr-compliance` (`hooks/adapters/golden-sessions.mjs`) — proof `golden`.

Live (same Stream as Mission Control / DAW / graph):

3. Every pulse `createPulseEmitter` already emits — `kindMap.applyPulse(pulse)` then `hub.notify`. No extra JSONL parse. The pulse must carry `data.nr_kind` (stamped in `pulse-transformer` `base()`). Proof `pulse`. Pulses without `nr_kind` are ignored.

No HTML seed. Overlay only adds proof; it never clears a golden/sample ●.

### 3.2 Payload

```js
{
  generated_at: string,
  harnesses: [{ id, label, capabilities, detected, verified }],
  kinds: [{
    id,            // RECORD_KIND
    pulse,         // KIND_PULSE.event (route | silent | named | unknown)
    reason,        // envelope | snapshot | duplicate | null
    lane,          // silent → snapshot, else stream (payload only; not a table axis)
    role,          // emit | catchall | alarm
    expect: number[] // 0 = capability off / not a hole; aligned to harnesses
    emit: number[]
    proof: string[][]
    routes?: [{ id, pulse, reason, role, expect, emit, proof }]  // KIND_ROUTES children
  }],
  tools: [{
    key,
    role,          // emit | catchall (`other`)
    by_harness: { [harnessId]: string[] }
  }],
  unknowns: [{  // distinct coverage holes (unknown_record / unclassified block)
    key, harness, nr_kind, raw_type, block_type,
    count, last_ts, slug, project, session_id, source
  }]
}
```

`experience/` does not import `hooks/`. The widget takes this JSON only. The gather step lives in `surface/kind-map-build.mjs` (composition, same layer as `build.mjs`). Listen list for `/events` is `streamEvents()` from `hooks/pulse-map.mjs` (every `pulseDisposition` event). Injected at page render — not a hand-typed array in the widget.

### 3.3 Widget

Register A. Color is grammar: ● geo (proved), ○ select (live-only), – dim (not expected), · dim (hole), ◇ data (catch-all fired), red ● err (unclassified content_block). Disposition lives on the kind stub, not as extra columns. No shadows, no radius > 2px, no blue chrome.

Snippet is a `<section class="k-kind-map">` with two tables. Page wrap adds `tokensToCss()`, topbar, statusbar with `generated_at`. Live page opens `EventSource('/events')` (same Stream as graph/DAW). Each pulse with `nr_kind` hits cells in place (○ if it was a hole, flash `k-hit`) and records raw tool names. `unknown` pulses upsert the **unknown bucket** (distinct harness × nr_kind × raw_type × block_type, with counts) — copy JSON for a maintainer; same list is on `GET /api/kind-map`. `updated` replaces the snippet from `GET /mapping?partial=1`. Static page does not open EventSource.

### 3.4 Honesty

A ● means “this adapter emitted this kind on the canonical traces,” not “the harness is capable of it in the wild.” A ○ is live-only. A – is capability-off or an idle catch-all (not a SOP to fix). A · is uncovered — fix the golden or the adapter. Expanding traces grows ●. That is the SOP for coverage, not a new emit table.

---

## 4. TDD units

1. `buildKindMapPayload` — kinds 1:1 with `RECORD_KINDS`; emit 1 iff traces contain the kind; `proof` distinguishes golden vs sample; `expect` from registry capabilities; `KIND_ROUTES` children for `content_block` / `tool_result`; tools grouped by `toolNameToKey`.
2. `renderKindMapSnippet` — disposition on the stub; no pulse/lane columns; expected-empty is –; live-only is ○; CSS uses `--k-*` only.
3. Gather: every `HARNESS_IDS` row has `{ golden, sample }`; claude-code golden implies `tool_use` emit 1.
4. `GET /api/kind-map` JSON; `GET /mapping` HTML contains `k-kind-map` and no `paint`; `GET /mapping?partial=1` is a snippet.
5. `kindFromPulse` reads `nr_kind` only — no reverse pulse→kind table. A `slug` on a session object does not light `session_meta`.
6. `streamEvents()` covers every `pulseDisposition(…).event`.
7. `nr-compliance` still uses the extracted goldens (no duplicate fixture).

---

## 5. Out of scope / later

- Hop `#nr-seed` generated from this payload (delete hand emit).
- Live `sessions-data.json` count overlay (metrics, not mapping).
- Alias table extracted from `toolNameToKey` ifs (the widget shows observed names, not the alias lists).
- Capabilities column on the kind grid.
