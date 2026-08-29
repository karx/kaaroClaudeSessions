# RFC: Cache-Hit-Rate Blind Spot on Output-Only-Token Harnesses

**Project:** kaaroSessions
**Status:** Option D implemented (2026-08-29, same review pass). Option C (§4) remains an open follow-up decision.
**Date:** 2026-08-29
**Relates to:** `hooks/enrich-session.mjs` (all-harness token arithmetic), Codex harness (`hooks/adapters/codex.mjs`), Copilot harness (`hooks/adapters/copilot.mjs`), session detail panel (`experience/client/05-interaction.js`), Mission Control / DAW stat row (`experience/client-core.mjs`)
**Grounding:** verified against 19 real local `~/.codex` rollout sessions (2025-12 → 2026-08) during the Codex harness PR review/audit

---

## 1. Problem

`cache_hit_rate` is computed once, centrally, for every harness:

```js
// hooks/enrich-session.mjs
const inputSide = t.input + t.cache_create + t.cache_read;
sess.cache_hit_rate = inputSide > 0 ? +(t.cache_read / inputSide * 100).toFixed(1) : 0;
```

It's surfaced directly to the user in three places:

- `experience/client/05-interaction.js:42` — project/session hover meta line: `cache: ${fmtTok(d.tokens_cached)} (${d.cache_hit_rate}%)`
- `experience/client/05-interaction.js:299` — session detail panel: `Cache read: ${fmtTok(d.tokens_cached)} (${d.cache_hit_rate}%)`
- `experience/client-core.mjs:1237` — Mission Control / DAW legend stat row: `['CACHE HIT', data.cache_hit_rate + '%']`

For **Codex**, `t.input` and `t.cache_read` are unconditionally `0` (`hooks/adapters/codex.mjs` `tokenUsage()` — see §2), so `inputSide` is always `0` and `cache_hit_rate` is always exactly `0`, for every session, regardless of what actually happened.

Verified against a real local session (`01a04d21…`, 2026-08-29): its last `token_count` event reported `input_tokens: 34381, cached_input_tokens: 32128` — a **93.4% real cache-hit rate**. The UI for that session shows:

```
Cache read: 0 (0%)
```

This isn't "no data available" (which would arguably be fine, shown as N/A) — it's **wrong data presented as certain**. A user glancing at that panel reasonably concludes Codex sessions get zero prompt caching, when the opposite is true: Codex's context accumulates every turn, so cache-hit rate climbs toward the high-90s as a session goes on.

**Copilot has the identical symptom, different cause.** `hooks/adapters/copilot.mjs:122,160` hardcodes `tokens: { input: 0, output: req.completionTokens, cache_create: 0, cache_read: 0 }` — but this isn't a discarded signal, it's a signal that was never available: VS Code's Copilot Chat API only ever exposes `completionTokens` (output). There is no upstream cache/input breakdown to recover. Codex's case is fixable (the numbers exist in the transcript, see §2); Copilot's is not, short of a VS Code API change outside this project's control.

Every other harness is either fully tokenful (claude-code, opencode — real `input`/`cache_read` per event, no issue) or fully tokenless (`pi`, `antigravity`, `grok`, `command-code` — `size_proxy: 'tool_calls'`, no token concept exists at all, so `cache_hit_rate: 0` is honest there, not misleading).

---

## 2. Root cause: why Codex zeroes these fields on purpose

This isn't an oversight — it's a documented tradeoff (`docs/CODEX.md#token-handling`) that I verified is *correct for its stated purpose*, which is what makes this RFC necessary rather than a one-line fix.

Codex's `token_count` event carries `last_token_usage.input_tokens`/`.cached_input_tokens`. These are **not per-turn deltas** — they report the size of the *entire context window sent with that request*, which grows every turn because the conversation accumulates. Verified on the same real session — every `token_count` event across one session:

| turn | `last_token_usage.input_tokens` | `.cached_input_tokens` |
|---|---|---|
| 1 | 13,675 | 8,576 |
| 2 | 20,577 | 12,672 |
| … | … | … |
| 11 (last) | 34,381 | 32,128 |

Summing `last_token_usage.input_tokens` across all 11 turns in that session ≈ **297,490**, which lands within **0.3%** of that session's final `total_token_usage.input_tokens` (297,490) — confirming `total_token_usage` is essentially the running sum of each turn's full-context snapshot, not a distinct "true total." If the adapter fed `input_tokens`/`cached_input_tokens` into `tokens.input`/`tokens.cache_read` as reported, summing them across turns (which `enrich-session.mjs` does for every harness, to get `tokens_total`) would make an 8-turn session report 300K+ "tokens" — and per `CLAUDE.md`, **graph/project `sizeNorm` scales directly by `tokens_total`**. A Codex session doing a normal amount of real work would render as a wildly oversized node relative to a Claude Code session that did comparably more, corrupting the primary visual signal of the whole history view.

So: **dropping input/cache from the summed `tokens_total`/`tokens_work` path is the right call.** The bug is that `cache_hit_rate` is derived from that *same* summed pair (`t.cache_read / (t.input + t.cache_create + t.cache_read)`) with no independent path — protecting the sum silently broke the ratio too, because they were never actually decoupled.

Ratios don't have the same explosion problem sums do. A **ratio of two inflated-by-the-same-factor sums is still roughly the true ratio** — computed for the same session: `Σcached_input_tokens / Σinput_tokens ≈ 241,792 / 297,490 ≈ 81.3%`, in the right neighborhood of the real last-turn snapshot (93.4%) and nowhere near the `0%` currently shown. That's the crack this RFC is about: **the sizing problem and the ratio problem don't actually require the same fix**, but today one blanket decision (zero both fields) resolves the sizing problem correctly while accidentally also breaking the ratio.

---

## 3. Options

| # | Approach | Recovers real signal? | Touches shared `enrich-session.mjs`? | Risk |
|---|---|---|---|---|
| A | **Status quo.** Leave `cache_hit_rate: 0` for Codex/Copilot. | No | No | Silently misleading — the actual problem this RFC exists to flag. |
| B | **Feed raw `input_tokens`/`cached_input_tokens` into `tokens.input`/`tokens.cache_read` as-is** (stop zeroing). | Approximately (ratio-of-sums, ~81% vs true ~93% in the sampled session) | No | **Rejected** — re-breaks `tokens_total`/`tokens_work`/graph sizing, the exact problem the current zeroing correctly avoids (§2). |
| C | **Decouple the ratio from the sum.** Compute `cache_hit_rate` from the *last* `token_count` event's raw `cached_input_tokens / input_tokens` (a single end-of-session snapshot, not an accumulation) and carry it as its own field — `tokens.input`/`tokens.cache_read` stay `0` for sizing purposes. | Yes — the last-turn ratio is, for Codex's cumulative-context model, close to the true whole-session cache efficiency. | Yes, but additively — a new field alongside the existing sum machinery, not a change to it. | Moderate — needs a place to carry a value that bypasses the sum (see §4 for shape options); Copilot still shows 0%/N/A since it has no data to snapshot at all. |
| D | **UI-only: stop asserting a false number.** Add a registry capability (e.g. `cache_accounting: false` for codex/copilot) and have the three UI call sites show `N/A` instead of `0%` when it's unset. | No — doesn't recover anything, just stops lying. | No (registry + UI only) | Low — safe, small, immediately deployable regardless of what (if anything) happens with C later. |

C and D are not mutually exclusive — D is the honest baseline that should probably happen regardless; C is the real fix, only worth doing if the team wants Codex's cache efficiency to actually be visible rather than just not-wrong.

---

## 4. If C is chosen: where does the snapshot live?

Two shapes, not yet decided between:

1. **New session-level field**, e.g. `session.cache_hit_rate_hint`, set once by `session-reducer.mjs` when it sees a `tokens` NR carrying an optional new `cache_ratio` field (populated by the codex adapter from the last-seen `token_count` event, overwritten each time so the final value wins). `enrich-session.mjs` would prefer `cache_hit_rate_hint` over the sum-derived value when present.
2. **Adapter-owned session_meta override**, e.g. the codex adapter emits a `session_meta` NR late (or updates one) carrying `cache_hit_rate` directly, following the existing `overwrite: true` pattern Grok already uses for model updates (`hooks/adapters/grok.mjs:52`) — `session-reducer.mjs` already knows how to let a later NR overwrite a field.

Option 2 reuses an existing, tested mechanism (`overwrite: true`) and needs no new NR field; Option 1 is more explicit about what's happening but is new surface area in the shared NR contract. Leaning toward Option 2, but this is exactly the kind of call this RFC is asking for direction on rather than deciding unilaterally — it's a precedent for how "harness computed a derived value the reducer can't" should be represented going forward, not just a one-off for Codex.

---

## 5. Recommendation

1. ~~Ship **D now**~~ **Done.** `cache_accounting: false` registry capability (codex + copilot) → `enrich-session.mjs` emits `cache_hit_rate: null` instead of `0` → UI (`fmtPct` in `experience/client-core.mjs`, used by `experience/client/05-interaction.js`'s 3 call sites, the Mission Control/DAW stat row, and the share card) renders `N/A`. Also fixed two call sites this RFC's audit didn't originally list: the resume-prompt text builder (`05-interaction.js:215`) and `hooks/signal-evaluator.mjs`'s `cache_hit_rate.lt` predicate, which previously coerced `null` to `0` via `|| 0` and would have falsely matched *every* Codex/Copilot session against any `cache_hit_rate.lt` policy rule — the same silently-wrong-data bug this RFC exists to fix, one layer down in policy signals instead of the UI.
2. Decide on **C** as a separate, deliberate follow-up — it's a real feature (recovering a genuinely useful signal for Codex specifically), but it sets a pattern (a harness-computed value bypassing the shared sum) that should be a conscious choice, not something bundled into a "fix the misleading 0%" patch.
3. **B stays rejected** — recorded here so nobody re-proposes "just stop zeroing them" without rediscovering why that corrupts graph sizing.

---

## 6. Out of scope

- Recovering real input/cache data for Copilot — not possible without a VS Code Copilot Chat API change; this RFC is Codex-fixable, Copilot is not.
- Any change to `tokens_total`/`tokens_work`/graph `sizeNorm` — those are correct as-is; this RFC is scoped to the derived `cache_hit_rate` percentage only.
- A general "confidence" or "partial data" indicator system across all derived session stats — `cache_hit_rate` is the one currently shown as a hard number despite being harness-dependent; if this pattern shows up elsewhere later, that's a separate, bigger RFC.
