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

**Pulse Source**:
The Stream. One producer: `surface/pulse-emitter.mjs` (adapter → NormalizedRecord → Pulse Transformer → SSE). Raw JSONL is not a source for visualization or audio. Lifecycle SSE (`status`, `updated`, `error`, `now`) is a different source.

**Pulse Sink**:
A consumer of a processed pulse. Sinks do not feed each other. Current sinks: Mission Control (`applyPulse`), the ticker, the beat ring (visualization), and the audio scheduler. The beat ring is independent of mute and of `AudioContext`. The scheduler may stamp `heardAt` onto a ring entry that already exists; it must not be the first push.

_Avoid_: gating the beat ring on Web Audio, treating `_flushBatch` as the viz enqueue, a second parse of JSONL in the browser

**Client Dispatcher** (`playPulse`):
Encodes one Stream pulse (`resolveSonic`) then fans out to the viz sink and the audio sink. Encoding is not a sink.

See `docs/PULSE-SOURCE-SINK.md` for the current-record trace (NR kind → pulse event → which sinks fire).

## Audio / Sonic Layer

**Event Registry** (`experience/audio/event-registry.mjs`):
The single source of truth for all audio event types. Each entry declares: canonical key, family, default sonic parameters (instrument, pan, reverb send, brightness, volume, octave), a human description, and per-harness sample traces for TDD. The `instrument` field is a Playable Instrument or `off` — it names a voice the browser engine can actually produce.

_Avoid_: instrument map, spatial table, sonic defaults object, naming a synth the engine does not implement

**Audio Event Type** (or Event Type):
A named, versioned entry in the Event Registry. Every pulse emitted by the Pulse Transformer must have a type that exists in the registry. Current canonical set:

Tool-action types (sub-keys of `tool_call`): `read · write · edit · grep_glob · agent · bash_git · bash_run · bash_other · web · other`

Cognitive/stream types: `tokens · words · chirp · human_turn · attachment · mode_shift · thinking`

Structural types: `compact · permission · scaffold · tool_error · tool_result`

Rest: `silent`

Catch-all: `unknown`

**Silent Pulse** (`silent`):
A pulse emitted for a known NormalizedRecord that has no live sonic — envelope (`assistant_turn` when tokens already exist), snapshot (`session_meta`, `branch_change`, `skill_invoke`), or duplicate (`content_block` / `tool_use`). Registry default is `instrument: 'off'`. Still one pulse per NR. Not a coverage gap.

_Avoid_: dropping the NR, silencing via `unknown` + `nr_kind` preset rules

**Catch-all Event** (`unknown`):
The event type emitted when a NormalizedRecord is a coverage hole: `unknown_record`, an unclassified `content_block.block_type`, or a string that is not a `RECORD_KIND`. The emission is unconditional. The transcript renders `[?]` family for unknowns, providing a live feedback loop on adapter gaps.

_Avoid_: fallback event, dropped record, using `unknown` for known kinds

**Synthetic Event**:
A pulse derived by heuristic when a harness's `capabilities` flag indicates a data dimension is unavailable (e.g. `tokens: false` for Antigravity and Grok). Carried as a normal pulse with `data.synthetic: true`. Example: `tokens` pulse approximated from `content_length / 4` as an `output` proxy. Distinct from the Catch-all — a Synthetic Event models a known-missing capability with a deliberate approximation; the Catch-all handles genuinely unknown record types.

**Pulse Transformer** (`hooks/pulse-transformer.mjs`):
Converts `NormalizedRecord[]` (the adapter output) into typed pulses for the Sonic Encoder. Replaces the archived per-harness `pulse-adapters.mjs`, which previously re-parsed raw JSONL per harness. With the unified pipeline, raw JSONL is parsed exactly once — by the adapter — and all downstream layers (session reducer, pulse transformer) consume NormalizedRecords. Disposition (sonic / silent / unknown) is the table in `hooks/pulse-map.mjs` — 1:1 with `RECORD_KINDS`. The transformer:
- Builds payload for the disposition of each kind
- Derives the Canonical Action Key on `tool_call` pulses (`data.key`) from `nr.tool + nr.category` — never raw tool names in the encoder
- Emits Synthetic Events for harnesses with `capabilities.tokens: false`
- Emits a Silent Pulse for known NRs with no live sonic
- Emits a Catch-all `unknown` pulse only for coverage holes
- Stamps **Recorded Time** on every pulse (`data.ts`) from the NormalizedRecord

**Canonical Action Key**:
The small tool-action vocabulary (`read · write · edit · grep_glob · agent · bash_git · bash_run · bash_other · web · other`) carried on Stream `tool_call` pulses as `data.key`. Derived once by the Pulse Transformer from `nr.tool + nr.category`. It is Stream vocabulary, not a sonic concept — the Sonic Encoder looks up the Event Registry by this key and must not re-derive aliases from raw tool names.

_Avoid_: putting keys on NormalizedRecord, a second alias ladder in resolveSonic

**Recorded Time**:
The timestamp the harness attached when it captured the transcript record. Carried on every pulse as `ts`. This is the burst clock — not when the browser received the SSE event, not when an oscillator starts.

_Avoid_: arrival time, `Date.now()` at play, heardAt

**Sonic Encoder**:
The single mapping from Stream pulses to sounding parameters (instrument, pitch, pan, brightness, volume, family) and, for each Burst, to audible voices plus ghosts. It consumes the Observability Surface (pulses with Recorded Time and Canonical Action Keys). It does not parse JSONL, call adapters, or call Web Audio. Playback (beat grid, mute) and viewers (graph widget, DAW lanes) must not re-derive it. Every `instrument` it emits is a Playable Instrument or `off`.

_Avoid_: pulse-audio engine, scheduler, a second resolveSonic in the browser, running adapters inside simulateSession

**Playable Instrument**:
A synth the browser pulse engine actually implements today: `harp · bass · bell · flute · bit · pling · snare · kick · hat · buzz`, plus `off`. The Event Registry and Sonic Encoder may only name these. Aspirational timbres (`pad · sweep · chime · click · tick · woodblock`) are aliased at encode time (`playableInstrument`) until those synths exist: pad/chime→bell, click/woodblock→pling, tick→hat, sweep→kick.

_Avoid_: falling back to harp at play time, a second instrument table in the browser, AudioWorklet / unguarded StereoPanner as a requirement

**Burst**:
The set of pulses that share Recorded Time. Voice Coalescing applies per Burst. Live `/graph` and live `/daw` hear the same bursts because they subscribe to the same Stream.

_Avoid_: treating the 80 ms live batch timer as the burst definition

**Voice Coalescing**:
The encoder policy that turns one Burst into a small set of sounding voices: unison spread under the polyphony cap, chord collapse over it, percussion as one hit. Ghosts stay in the visual score so the DAW and graph widget still draw every pulse.

_Avoid_: polyphony (the cap, not the feature)

**Sample Trace** (in Event Registry entries):
A per-harness, versioned fixture colocated with each Audio Event Type definition. Provides both an input `record` (raw JSONL shape) and an `expect` array (expected NormalizedRecords). Serves as the canonical TDD contract for adapter correctness. Version is a monotonic integer per `{ eventType, harness }` pair — increment when the record shape changes. `test/harness-parity.test.mjs` validates all sample traces automatically.

```js
samples: {
  'claude-code': { version: 1, record: { type: 'user', ... }, expect: [{ kind: 'human_turn', ... }] },
  'antigravity': { version: 1, record: { type: 'USER_INPUT', ... }, expect: [{ kind: 'human_turn', ... }] },
}
```

**Chirp**:
A short assistant text emission (fewer than 3 words) that the current `words` threshold filters out. A distinct, lightweight Playable Instrument preserves conversational cadence without a full `bell` for micro-acknowledgments like "Got it." or "Writing now."

**Scaffold**:
An audio event type representing system-injected context: `EPHEMERAL_MESSAGE` records in Antigravity, `attachment` subtypes in Claude Code. Distinct from user-driven prompts — the harness's internal guardrails and workflow reminders entering the agent's context window. Structural, non-melodic; the Playable Instrument is whatever the registry names, not a synth the engine does not have.

## Relationships (to kaaro family)

- kaaroSessions hosts the hooks that make agent transcripts observable.
- The Personal Live Mirror is the primary human interface for that observability today.
- Normalized events (pulses) are the handoff point to any broader Observability Layer.
- Session traces and context trees are candidates for encoding into kaaroViewer library entries (aspirational per ecosystem notes).

## Non-goals (boundaries)

- Implementing or replacing any Agent Harness.
- Building the enterprise/group Observability Layer, collector, or durable multi-user store.
- Acting as an active gate or interceptor (read-only / post-hoc observation and live tailing only).
