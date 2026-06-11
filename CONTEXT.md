# kaaroSessions

Agent session observability hooks hosted in this project. The hooks provide an **Observability Surface** consisting of a Snapshot (complete state up till now) plus realtime Streaming Updates. The Snapshot is exposed via a hosted read endpoint (pull) and can optionally be pushed to a configured remote URL (push). The Personal Live Mirror (which serves as the Copilot Interface Extension for operating with Agent Harnesses) is the primary local consumer of this surface. The same surface produces normalized events ready to be picked up by external OpenTelemetry-compatible observability layers. The enterprise/group Observability Layer itself is out of scope.

## Language

**Harness**:
An external AI coding agent system (Claude Code, Pi, Grok Build, Antigravity, and future) that writes append-only transcript logs. kaaroSessions does not implement or run harnesses; it provides the integration hooks into their output.

`harness` is an important dimension in all normalized emits (OTLP and otherwise). Decision A: one resource per kaaroSessions deployment (with `kaaro.deployment.harnesses` array). Every individual signal carries `harness` as a first-class attribute. Consumers can reliably filter, group, and analyze by harness while the core normalized model stays unified.

_Avoid_: agent, AI backend, session source, coding tool

**Harness Hook**:
The combination of adapter, registry descriptor, scanner, and pulse parser that converts one specific harness's raw transcript records into the project's common normalized vocabulary and live events. The hook is the unit of harness support.

_Avoid_: adapter, parser, importer, connector

**NormalizedRecord** (internal):
The small common vocabulary of record kinds (user_turn, assistant_turn, tool_use, tokens, context_reset, session_meta, etc.) that every Harness Hook emits. All downstream reconstruction (sessions, ContextTree, pulses) consumes this vocabulary. It is the "harness hop".

**Personal Live Mirror**:
The default local application (`node serve.mjs`) that renders live, visual, and sonic observability over the harness activity on the user's machine. It includes the force graph, swimlanes, timeline, Thread View, proportional context strips, and the DAW / pulse audio layer. This mirror *is* the Copilot Interface Extension.

**Copilot Interface Extension**:
The Personal Live Mirror when viewed as the operational interface that helps a human work more effectively with one or more Agent Harnesses. Liveness, immediate pulse feedback, and reconstructible per-session arcs are core to its value.

**Observability Surface**:
The complete interface exposed by the Harness Hooks: a Snapshot of all observed state up till now (exposed via hosted read endpoint and optional push when a URL is provided), plus a realtime Stream of incremental updates. Both the Personal Live Mirror (Copilot Interface) and external Observability Layers are consumers of the same surface.

**Snapshot**:
A point-in-time, complete representation of the current observed world — projects, sessions (with their full attributes, tools, file ops, context resets, etc.), aggregates, and metadata as of the moment it was produced. It is the "up till now" baseline.

**Snapshot Endpoint**:
The HTTP read surface hosted by kaaroSessions that exposes the current Snapshot. External systems obtain the "up till now" state by reading this endpoint (pull model).

**Snapshot Push**:
The optional push behavior: when a remote URL is provided, kaaroSessions actively delivers the produced Snapshot to that URL (push model). This provides a push path in addition to the hosted read endpoint, following mature dual exposure patterns (e.g. Prometheus scrape targets + push mechanisms).

**Stream** (or Realtime Stream, Streaming Updates):
The continuous flow of lightweight normalized events emitted the moment new activity is seen in harness transcripts. Enables sub-second awareness and incremental updates without waiting for a new full Snapshot.

**Normalized Event** (or Pulse):
An individual item in the Stream — e.g. `tool_call`, `tokens`, or `words` (plus lifecycle events such as `status` and `updated`). These are harness-aware, session-scoped, and the primary real-time payload intended for consumption by both the Personal Live Mirror and external systems.

_Avoid_: signal (overloaded with future policy), log line, telemetry point

**Observability Layer**:
An external system (OpenTelemetry collector, enterprise platform, group dashboard, audit store, etc.) that ingests the Observability Surface (Snapshot + Stream) produced by Harness Hooks. kaaroSessions produces the surface in shapes suitable for such layers but does not implement the layer, storage, multi-tenancy, or policy enforcement.

**OTLP Emission**:
The prioritized native export path (as of 2026-06 decision) for the Observability Surface. kaaroSessions can emit the Stream (Normalized Events) and periodic Snapshots directly as OTLP (traces, metrics, logs) over HTTP/JSON to a configured collector endpoint. This is the first-class contract for enterprise consumers while the local Personal Live Mirror continues to use SSE + JSON. Implemented with minimal pure-Node code to preserve the zero-dependency model.

**Normalized Emission**:
The act of taking raw, harness-specific transcript files and emitting them as a single, unified, harness-agnostic OTLP surface (Normalized Snapshot Logs for state + appropriate spans/metrics/logs for the realtime Stream). This is the core value kaaroSessions powers: unification / abstraction of the harness choice so that telemetry consumers see one consistent model.

**Decision A (locked)**: One resource per deployment lists the harnesses it is watching (`kaaro.deployment.harnesses`). `harness` is carried as a first-class attribute on every signal (Snapshot Logs, spans, metrics, etc.). This makes harness a reliable dimension while the emitted model remains unified and harness-agnostic at the structural level.

**Normalized Signature** (full picture):
The complete, stable contract for all normalized OTLP emits. This is the unification that kaaroSessions powers — deployments hook local harness files and emit one model.

- **Resource** (one per deployment): `kaaro.deployment.harnesses` (array), `service.name="kaaro-sessions"`, optional `kaaro.deployment.id`, `kaaro.signature_version`.
- **Common attributes on every signal**: `harness` (first-class/important dimension), `session.id`, `session.slug`, `project.id`, `project.label`, `ts`, `kaaro.snapshot.generation` (for Snapshot ↔ Stream correlation).
- **Snapshot Logs** (periodic state): body = full normalized sessions-data shape (projects[], sessions[] from reducer/enrich/schema, rollup, meta). Every session inside carries `harness`. LogRecord attributes include `harness` (when applicable) + snapshot metadata.
- **Stream**:
  - `tool_call` → Span (name=`tool.{name}`, attrs=`harness`, `tool.*`, session context).
  - `tokens` → Metric (kaaro.tokens.* with harness + session dimensions).
  - `words` → LogRecord (body=preview, attrs=`harness`, `word_count`, session context).
- **Guarantees**: Harness-agnostic structure (one model for all harnesses); `harness` always present as dimension; full richness from the internal normalized shape; correlation via generation + session.id.

See the RFC for the complete attribute tables, examples, and rationale. This is the "full normalized picture" — the more we give in the signature (rich body, consistent attributes, correlation fields), the stronger the abstraction for telemetry consumers.

**Normalized Snapshot Log**:
The primary representation for the periodic Snapshot under the OTLP Emission path. The Snapshot is emitted as one or more OTLP LogRecords whose body contains the canonical normalized session data (output of the reducer + enrich + schema validation). This ensures every harness produces identical shapes and that the Logs are directly usable for state reconstruction, historical queries, and correlation with the realtime Stream.

`harness` is an important dimension (Decision A): present on LogRecord attributes and inside every session in the normalized body; the deployment resource declares the full set it is currently hooking via `kaaro.deployment.harnesses`. The model is unified; harness remains a first-class, always-available dimension.

**Harness Hook** (see also above):
The deployment-level mechanism (registry + scanners + adapters + watch logic) by which a kaaroSessions instance discovers and normalizes transcripts from all local harness roots. One deployment can hook multiple harnesses and emit a unified normalized surface from all of them.

**Context Tree**:
kaaroSessions' model of a single session as a tree of segments (delimited by context resets), turns, tool calls, and subagent branches, reconstructed from the normalized records. A session is not a flat log.

**Pulse**:
See Normalized Event.

## Audio / Sonic Layer

**Event Registry** (`lib/event-types.mjs`):
The single source of truth for all audio event types. Each entry declares: canonical key, family, default sonic parameters (instrument, pan, reverb send, brightness, volume, octave), a human description, and per-harness sample traces for TDD. Replaces the scattered `SPATIAL`, `TOOL_FAMILY`, and `DEFAULT_SETTINGS.instruments` tables that previously lived in `lib/audio-sim.mjs`.

_Avoid_: instrument map, spatial table, sonic defaults object

**Audio Event Type** (or Event Type):
A named, versioned entry in the Event Registry. Every pulse emitted by the Pulse Transformer must have a type that exists in the registry. Current canonical set:

Tool-action types (sub-keys of `tool_call`): `read · write · edit · grep_glob · agent · bash_git · bash_run · bash_other · web · other`

Cognitive/stream types: `tokens · words · chirp · human_turn · attachment · mode_shift`

Structural types: `compact · permission · scaffold · tool_error · tool_result`

Catch-all: `unknown`

**Catch-all Event** (`unknown`):
The event type emitted when a NormalizedRecord kind has no mapping in the Pulse Transformer. Guarantees the audio layer never silently drops harness activity. Fully customizable through the Event Registry defaults and preset mapping rules — a preset may silence it with `instrument: 'off'` once a harness is fully mapped, but the emission itself is unconditional. The transcript renders `[?]` family for unknowns, providing a live feedback loop on coverage gaps.

_Avoid_: fallback event, dropped record, silent record

**Synthetic Event**:
A pulse derived by heuristic when a harness's `capabilities` flag indicates a data dimension is unavailable (e.g. `tokens: false` for Antigravity and Grok). Carried as a normal pulse with `data.synthetic: true`. Example: `tokens` pulse approximated from `content_length / 4` as an `output` proxy. Distinct from the Catch-all — a Synthetic Event models a known-missing capability with a deliberate approximation; the Catch-all handles genuinely unknown record types.

**Pulse Transformer** (`lib/pulse-transformer.mjs`):
Converts `NormalizedRecord[]` (the adapter output) into typed pulses for `resolveSonic`. Replaces `lib/pulse-adapters.mjs`, which previously re-parsed raw JSONL per harness. With the unified pipeline, raw JSONL is parsed exactly once — by the adapter — and all downstream layers (session reducer, pulse transformer) consume NormalizedRecords. The transformer:
- Maps each NormalizedRecord kind to one or more Audio Event Types
- Uses `data.key` (canonical action key, set by the adapter) for `tool_call` routing — never raw tool names
- Emits Synthetic Events for harnesses with `capabilities.tokens: false`
- Emits a Catch-all `unknown` pulse for any kind not in its mapping

**Sample Trace** (in Event Registry entries):
A per-harness, versioned fixture colocated with each Audio Event Type definition. Provides both an input `record` (raw JSONL shape) and an `expect` array (expected NormalizedRecords). Serves as the canonical TDD contract for adapter correctness. Version is a monotonic integer per `{ eventType, harness }` pair — increment when the record shape changes. `test/harness-parity.test.mjs` validates all sample traces automatically.

```js
samples: {
  'claude-code': { version: 1, record: { type: 'user', ... }, expect: [{ kind: 'human_turn', ... }] },
  'antigravity': { version: 1, record: { type: 'USER_INPUT', ... }, expect: [{ kind: 'human_turn', ... }] },
}
```

**Chirp**:
A short assistant text emission (fewer than 3 words) that the current `words` threshold filters out. Mapped to a distinct, lightweight instrument (e.g. `woodblock`) to preserve conversational cadence without overwhelming the mix with full `bell` events for micro-acknowledgments like "Got it." or "Writing now."

**Scaffold**:
An audio event type representing system-injected context: `EPHEMERAL_MESSAGE` records in Antigravity, `attachment` subtypes in Claude Code. Distinct from user-driven prompts — represents the harness's internal guardrails and workflow reminders being loaded into the agent's context window. Mapped to a non-melodic, structural-feeling instrument (e.g. reverse cymbal, woodblock).

## Relationships (to kaaro family)

- kaaroSessions hosts the hooks that make agent transcripts observable.
- The Personal Live Mirror is the primary human interface for that observability today.
- Normalized events (pulses) are the handoff point to any broader Observability Layer.
- Session traces and context trees are candidates for encoding into kaaroViewer library entries (aspirational per ecosystem notes).

## Non-goals (boundaries)

- Implementing or replacing any Agent Harness.
- Building the enterprise/group Observability Layer, collector, or durable multi-user store.
- Acting as an active gate or interceptor (read-only / post-hoc observation and live tailing only).
