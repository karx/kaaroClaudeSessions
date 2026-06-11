# RFC: Observability Surface – Industry Standard Patterns for kaaroSessions

**Project:** kaaroSessions  
**Status:** Decision recorded — Native OTLP emission path prioritized for the enterprise Observability Surface (2026-06)  
**Date:** 2026-06  
**Author:** Grill-with-docs synthesis (Kartik Arora direction + industry patterns)  

---

## 1. Problem

kaaroSessions has matured from a personal live graph visualizer into the host of **Harness Hooks** that turn raw agent transcript logs (from Claude Code, Pi, Grok, Antigravity, and future harnesses) into structured, observable data.

The current deliverables (sessions-data.json / graph-data.json after rebuild + immediate SSE pulses via jsonl-tail + pulse-adapters) work well for the **Personal Live Mirror** (the Copilot Interface Extension).

However, to "grow with it" into enterprise / group use, the output must be consumable by industry-standard observability layers without kaaroSessions itself becoming a full backend, collector, or policy engine.

The requirement (crystallized through this grill):
- The surface must supply both a **Snapshot** ("up till now" complete state) and **realtime Streaming Updates**.
- Exposure must support the mature dual model: **hosted read endpoint (pull/scrape)** and **optional push (when a URL is provided)**.
- The data must be "ready to be picked up" by OpenTelemetry-compatible systems (and existing Prometheus/Grafana stacks).

Without a clear industry-aligned contract, we risk building another proprietary JSON + SSE silo instead of a first-class source that fits naturally into the Collector-centric world.

---

## 2. Ground Truth & Industry Precedents

Two battle-tested patterns dominate production observability in 2025–2026:

### 2.1 Prometheus (the canonical pull + limited push model)
- **Primary:** Pull / scrape. Targets expose an HTTP endpoint (usually `/metrics`) returning the current **snapshot** of metrics in the simple Prometheus text exposition format.
- Prometheus (or any scraper) periodically pulls the snapshot. This gives automatic health (`up` metric) and clean lifecycle.
- **Push exception:** Pushgateway — only for short-lived batch jobs or unscrapeable targets. The job pushes to Pushgateway; Prometheus scrapes Pushgateway. Strong official warnings against general use (stale data, SPoF, loss of health semantics).
- Grafana visualizes by querying the backend.

### 2.2 OpenTelemetry + Collector (the modern unified standard)
- **OTLP (OpenTelemetry Protocol)** is push-first (gRPC 4317 / HTTP 4318) for traces, metrics, and logs.
- The **OpenTelemetry Collector** is the recommended central component ("use a Collector").
  - **Receivers** support both push (OTLP, legacy Jaeger/Zipkin) and pull (Prometheus receiver scrapes `/metrics` and converts to OTel model; hostmetrics, kubeletstats, etc.).
  - Processors (batch, transform, memory_limiter).
  - Exporters (OTLP, Prometheus remote write, Loki, Tempo, etc.).
  - Connectors (e.g. spanmetrics to derive metrics from traces).
- Common production pattern: Instrumented targets (or exporters) → Collector (pull and/or push) → one or more backends.
- Prometheus and OTel are "better together": OTel for traces/logs + rich context; Prometheus (or OTel metrics exported to Prometheus format) for metrics storage + PromQL. Grafana unifies the view.
- For rich, hierarchical data (full session state, context trees, tool arguments): Traces and structured logs are strongly preferred over flat Prometheus metrics. Numeric aggregates (token counts, call rates) map cleanly to metrics.

kaaroSessions' existing architecture (NormalizedRecord "harness hop", session-reducer, two-clock design of immediate pulses vs. debounced full rebuild, adapters + registry) already provides the internal normalization needed to support these patterns cleanly.

---

## 3. The Proposed Model: kaaroSessions as a High-Quality Target / Source

kaaroSessions (via its Harness Hooks) should act as a **first-class observability target / exporter source**, not the full observability platform.

**Core contract — the Observability Surface** (as defined in CONTEXT.md):
- **Snapshot**: Complete point-in-time view of the observed world (projects, sessions with attributes, tools, file_ops, context_resets, aggregates, etc.).
- **Stream**: Continuous flow of lightweight Normalized Events (tool_call, tokens, words + lifecycle).

**Exposure models** (dual, Prometheus-inspired + OTel-friendly):
- **Pull / Scrape (primary for Snapshot)**: Host stable HTTP read endpoint(s) that return the current Snapshot. A Prometheus scraper or the OTel Collector Prometheus receiver can pull this on a schedule.
- **Push (optional escape hatch for Snapshot)**: When a remote URL is configured, actively POST/PUT the Snapshot to that URL after a successful rebuild. This mirrors the Pushgateway pattern for environments where the consumer cannot initiate scrapes.
- **Stream**: Primarily a hosted read/subscription surface today (SSE `/events`). For enterprise readiness, the same Normalized Events should be expressible as OTLP so a Collector can ingest them natively (push model from the source or via a bridge).

The Personal Live Mirror / Copilot continues to consume the surface (directly or via the same endpoints) for its visual + sonic experience. External enterprise layers (or a user's own OTel Collector) consume the same surface for storage, correlation, alerting, and long-term analysis.

**Non-goal (explicit boundary):** kaaroSessions does not implement the Collector, the backend storage, the multi-tenant platform, or policy enforcement. It produces high-fidelity, normalized, harness-agnostic data that such layers can ingest.

---

## 4. Recommended Signal Mapping (Snapshot + Stream → Industry Formats) — OTLP Priority

**Decision:** Native OTLP emission is the prioritized first-class contract for external enterprise consumers.

The existing SSE + JSON surfaces remain the primary mechanism for the **Personal Live Mirror / Copilot Interface**. OTLP emission is an additive, configurable path (enabled by providing an OTLP endpoint) that allows a standard OpenTelemetry Collector to ingest high-fidelity data with no custom code on the consumer side.

### 4.1 Stream (realtime Normalized Events) — High priority
The clean shapes already produced by `lib/pulse-adapters.mjs` (and the underlying `NormalizedRecord` kinds) map almost directly:

- `tool_call` → **Span** (or LogRecord + Event)
  - `name`: `tool.{tool}` (e.g. `tool.Read`, `tool.Bash`)
  - Resource attributes: `service.name="kaaro-sessions"`, `harness`, `project`, `session.id` (full), `session.slug`
  - Attributes: `tool.name`, `tool.where` (file or command prefix), `tool.why` (description), `tool.category`, `error` (if applicable)

- `tokens` → **Metric** (preferred: `UpDownCounter` or `Histogram`)
  - `kaaro.tokens.input`, `kaaro.tokens.output`, `kaaro.tokens.cache_create`, `kaaro.tokens.cache_read`
  - With dimensions: harness, project, session.id

- `words` → **LogRecord**
  - `body`: preview (truncated)
  - Attributes: `word_count`, `session.id`, `harness`

- Lifecycle (`status`, `updated`, rebuild events) → LogRecords or resource events.

This gives immediate value: tool calls become traceable spans, token usage becomes queryable metrics, assistant output becomes searchable logs.

### 4.2 Snapshot ("up till now") — Periodic (Normalized Logs — Prioritized)

**Decision:** Primary representation is **OTLP Logs using the normalized session shape**.

Sent after a successful full rebuild (the debounced analyze + build path in `serve.mjs`).

**Structure (OTLP LogRecord):**
- `timeUnixNano`: timestamp of the snapshot (rebuild time).
- `severityText`: "INFO" or "SNAPSHOT".
- `body`: The normalized snapshot payload. Recommended:
  - `body.stringValue` = JSON of the top-level `sessions` array + `projects` + `rollup` (or a dedicated `normalized_snapshot` object).
  - Or `body.kvlistValue` for structured attributes (preferred for querying in backends that support it).
- Resource attributes (one resource per kaaroSessions deployment):
  - `service.name`: "kaaro-sessions"
  - `kaaro.snapshot.generation` (monotonic counter or timestamp-based id)
  - `kaaro.deployment.harnesses`: array of harness ids this deployment is currently watching (e.g. ["claude-code", "grok", "pi"])
- Log attributes (per snapshot — harness is an important dimension):
  - `harness`: the harness for this particular snapshot (or omitted if the log is a cross-harness aggregate; individual sessions inside the body always carry their own `harness`)
  - `kaaro.snapshot.type`: "full" | "incremental"
  - `kaaro.total_sessions`, `kaaro.total_projects`
  - `kaaro.rebuild_duration_ms` (optional)

Every individual session object inside the log body also carries its `harness` (and `source`) as per the normalized session contract.

The payload inside the log **must use the canonical normalized shape**:
- Sessions produced by `reduceSession()` + `enrichSession()` (from `lib/session-reducer.mjs` and `lib/enrich-session.mjs`).
- Must satisfy `validateSessionsData()` from `lib/sessions-schema.mjs`.
- Includes all OPTIONAL_SESSION_FIELDS that the harness supports (context_resets, ai_title, subagent_count, branches, tools, file_ops, etc.).
- **Harness-agnostic at the model level**: the structure, field names, and semantics are identical regardless of which harness originally produced the transcript. This is the unification point powered by the Harness Hooks.
- **Harness as important dimension**: every session object (and every Stream signal) carries `harness` (and `source`) explicitly. Downstream telemetry systems can treat `harness` as a first-class dimension for queries, dashboards, and alerts.

This approach reuses the exact same data contract the Personal Live Mirror already trusts (`sessions-data.json`), ensuring consistency between the Copilot view and what enterprise collectors receive.

**Complementary Traces (optional, lower priority for now):**
High-value individual sessions (or the overall "agent activity" over time) can additionally be emitted as OTLP Traces, using `reconstructContextTree` output to create spans for segments, turns, tool calls, and subagents. This gives beautiful flamegraphs and "how the session unfolded" visibility in Tempo/Jaeger. The normalized Snapshot Logs provide the "current world" baseline; traces provide the temporal narrative.

**Why Logs (normalized) for Snapshot?**
- The Snapshot is fundamentally a rich, structured, point-in-time object (arrays of sessions with maps of tools/file_ops, context trees, etc.). OTLP Logs handle arbitrary structured data naturally.
- Backends can index the full session objects, run queries across all historical snapshots, correlate with the realtime Stream events, etc.
- Keeps the emission simple and faithful to the existing reducer output — no lossy flattening required for the primary path.
- Matches patterns used for "state snapshots" in other systems (e.g., Kubernetes state as logs, or inventory snapshots).

The existing `buildSessionsOutput` / `sessions-data.json` production path can directly feed the OTLP Log emitter with almost no transformation.

### 4.3 Zero-dependency constraint
Because kaaroSessions deliberately has no external dependencies, the OTLP emitter should be a small, pure-Node implementation using the global `fetch` (available since Node 18) to POST OTLP/HTTP JSON (not protobuf). This keeps the "run with `node serve.mjs`, no npm install" experience intact. Full protobuf + official SDK can be a later optional enhancement.

### 4.4 Why OTLP wins for this domain
- Preserves the full richness of sessions, Context Trees, subagents, permission modes, branches, tool arguments, and file operations — data that does not compress well into flat Prometheus metrics.
- Enables correlation across signals in the Collector + backends (a `tool_call` span can be linked to token metrics and word logs from the same turn).
- Standard Collector pipelines can then route: traces to Tempo, metrics to Prometheus, logs to Loki, with automatic generation of RED metrics, service graphs, etc. via connectors.

### 4.3 Why this mapping wins
- Numeric / RED-style views work with existing Prometheus + Grafana users immediately.
- Full context (which session, which context window, which subagent, exact arguments, branches, permission modes) travels with the data via traces/logs — something flat metrics cannot do.
- The Collector can then fan out: metrics → Prometheus, traces → Tempo, logs → Loki (or any OTLP-compatible backend), with spanmetrics connectors generating additional metrics if desired.

---

## 5. Concrete Surfaces & Endpoints (Current + Target)

**Today (solid foundation):**
- `GET /graph-data.json` and the underlying `sessions-data.json` (after analyze + build) — the Snapshot for the mirror.
- `GET /events` (SSE) — the Stream (tool_call / tokens / words + status/updated).
- `GET /api/trace/:session_id` — deep ContextTree reconstruction (already rich and pure).

**Target additions for industry alignment (incremental):**
- Stable **Snapshot Endpoint** (e.g. `/snapshot` or keep/enhance the existing data endpoints with content negotiation or a dedicated path). Document it as the pull surface.
- Optional **Snapshot Push** path (configurable URL + simple HTTP POST of the Snapshot payload on successful rebuild).
- Prometheus text **`/metrics`** (or `/metrics/kaaro`) exposing the numeric view of the current Snapshot + recent Stream aggregates. This makes kaaroSessions a first-class scrape target.
- OTLP **push support** (or at minimum clear guidance + examples for a Collector to receive the Stream events as OTLP and the Snapshot as periodic logs/traces). The existing NormalizedRecord + pulse-adapters give us the normalized shapes needed to emit OTLP with almost no new logic.
- Optional: Make the Stream also available via a durable append-only events log (for replay and for push-style shipping).

The serve.mjs watch + two-clock design (immediate tail + pulse for Stream, debounced full rebuild for Snapshot) is already the right internal architecture.

---

## 6. Recommended Deployment Pattern (the "Industry Standard" for consumers)

1. Run `node serve.mjs` (or equivalent) on the machine(s) with harness activity. This is the **target**.
2. (Enterprise) Deploy an OpenTelemetry Collector (or Grafana Alloy) nearby.
   - Use the Prometheus receiver to scrape the `/metrics` (or Snapshot Endpoint) on a schedule.
   - Use OTLP receiver (or filelog + transform) if kaaroSessions is configured to push or if we add an OTLP export path.
   - Process (batch, enrich with k8s/node attributes via resourcedetection, sample if needed).
   - Export: metrics → Prometheus/remote-write, traces → Tempo, logs → Loki (or any OTLP backend).
3. Grafana (or equivalent) for visualization, correlation (traces ↔ metrics ↔ logs), and alerting.
4. For the local power user: the Personal Live Mirror continues to deliver the immediate visual + sonic Copilot experience with zero extra components.

This pattern is identical to how teams instrument databases, message queues, custom services, and batch jobs today.

---

## 7. Relation to Existing Artifacts

- **CONTEXT.md**: Directly implements and extends the definitions of Observability Surface, Snapshot, Stream, Snapshot Endpoint, Snapshot Push, Harness Hook, etc.
- **harnesses.md** + **HARNESS_REGISTRY** + adapters + `normalized-record.mjs` + `session-reducer.mjs` + `pulse-adapters.mjs`: The internal "harness hop" that makes multi-harness support and clean external emission possible with minimal per-harness work.
- **WISHLIST.md** (Observe pillar): This RFC delivers the "ready to be picked up" part of W-OBS-04 (multi-harness) and provides the foundation for future signal/policy work to be expressed as derived events that flow through the same surface to the external layer.
- **CLAUDE.md / serve.mjs**: The runtime (watch, tail, rebuild, SSE) already implements the two parts of the surface. Incremental work is mostly about stable exposure formats and optional push/OTLP paths.
- **Context Tree + Thread View**: The per-session deep reconstruction remains the gold standard for the Copilot Mirror and is an excellent candidate for rich trace spans in the OTLP path.

---

## 8. Open Questions & Trade-offs (post-decision)

**Resolved:** Native OTLP emission path is prioritized (see Decision above).

Remaining:

1. **Snapshot representation in OTLP**: Primary as **Logs** (periodic structured log records containing or referencing the full sessions snapshot) or **Traces** (sessions modeled as traces with spans for segments/turns/subagents)?
2. **Snapshot payload for enterprise**: Reuse the existing rich `sessions-data.json` shape (with all optional fields), or define a leaner, versioned "kaaro-observability-snapshot" schema optimized for OTLP logs/traces?
3. **Minimal OTLP emitter**: Implement a pure-Node (zero new deps) OTLP/HTTP JSON exporter, or accept a small optional dependency on the official `@opentelemetry` packages when OTLP mode is enabled?
4. **Stream push vs subscription**: Should the optional push capability also apply to the Stream (event-by-event or batched OTLP to a configured collector URL), or keep the hosted SSE as the local Stream and rely on OTLP export for enterprise?
5. **Correlation / versioning**: How should a consumer correlate a pulled Snapshot with subsequent Stream events in OTLP? (e.g. `snapshot.generation` attribute on all emitted signals, or resource attributes)?
6. **Context Tree in OTLP**: How deeply should the existing `reconstructContextTree` output be mapped into OTLP spans/events vs. left as rich attributes on the session trace?
2. **Snapshot payload for enterprise**: Reuse the existing rich `sessions-data.json` shape (with all optional fields), or define a leaner, versioned "kaaro-observability-snapshot" schema optimized for OTLP logs/traces?
3. **Stream push**: Should the optional push capability also apply to the Stream (event-by-event or batched OTLP/JSON to a URL), or is the hosted SSE + Collector pull/bridge sufficient?
4. **Correlation / versioning**: How should a consumer correlate a pulled Snapshot with subsequent Stream events? (Add `snapshot_generation` or `last_rebuild_ts` to both the Snapshot metadata and the pulses?)
5. **Subagent / context tree in the surface**: When we emit the Snapshot or Stream as OTLP traces, how much of the ContextTree reconstruction should be flattened into spans vs. left as attributes or linked via trace/span IDs?
6. **Config for push URL**: Environment variable? Small config file? Per-harness? How does this interact with the existing serve flags and watch configuration?
7. **Staleness & health**: For the pull/scrape path, should we synthesize something like a `kaaro_up` or per-harness/session gauge so scrapers get automatic health semantics (as Prometheus expects)?

---

## 9. Implementation Order (Updated for OTLP Priority)

| Phase | Deliverable | Value |
|-------|-------------|-------|
| 1 | Document decision in this RFC + update CONTEXT.md with "OTLP Emission" terminology | Shared language + priority recorded |
| 2 | Minimal pure-Node OTLP/HTTP JSON emitter (no protobuf, no new npm deps) | Core capability that respects zero-dependency philosophy |
| 3 | OTLP emission for the **Stream** (Normalized Events from pulse-adapters → OTLP spans for tool_call, metrics for tokens, logs for words). Triggered alongside existing SSE notify when OTLP endpoint configured. | Realtime native ingestion for Collectors |
| 4 | Periodic **Snapshot** emission as OTLP (primarily as LogRecords with structured sessions snapshot; optional trace modeling). Sent after successful rebuild when OTLP configured. | Rich hierarchical state for enterprise |
| 5 | Configuration surface: `--otlp-endpoint=...` (or `OTLP_ENDPOINT` env), optional headers for auth. Coexists with existing SSE/JSON paths. | Usable without breaking local Copilot Mirror |
| 6 | Example OpenTelemetry Collector config (otlp receiver + pipelines for traces/metrics/logs) + Grafana dashboard sketches | "How to consume" for users |
| 7 | Optional: Prometheus text `/metrics` bridge (derived from the same normalized data) for hybrid users | Back-compat win |
| 8 | Snapshot Push (when URL provided) can also target an OTLP HTTP endpoint | Unified push story |
| 9 | Correlation attributes (`snapshot.generation`, session resource attributes) + tests treating a Collector as consumer | Production readiness |
| 10 | Parity / harness tests + "export surface" tests | Surface remains stable as harnesses are added |

The local Personal Live Mirror (SSE + JSON + DAW + graph) remains the default zero-config experience. OTLP emission is additive and off-by-default or enabled only when an endpoint is configured.

Many phases can be incremental and behind flags. The existing test suite (harness-parity, pulse, schema, etc.) plus new "export surface" tests will be essential.

---

## 10. Success Criteria

- A user with a standard OTel Collector + Prometheus + Grafana (or any OTLP-compatible stack) can ingest meaningful kaaroSessions data with only Collector configuration (no custom code).
- The Personal Live Mirror experience is unchanged or improved.
- Adding support for a 5th harness remains a localized change in the hooks (adapter + registry + scanner) with no impact on the external surface contract.
- The dual pull + optional push model for the Snapshot is documented and matches the maturity expectations set by Prometheus and the Collector ecosystem.

This pattern lets kaaroSessions remain a focused, high-quality provider of Harness Hooks and the delightful local Copilot while becoming a first-class, standards-aligned participant in any modern observability platform. 

---

**Decision (2026-06):** The user selected **Native OTLP emission path** as the priority for the enterprise surface. The pull/Prometheus text and Snapshot Push paths remain valuable for compatibility but are secondary.

**Snapshot representation decision:** Primary representation for the Snapshot is **OTLP Logs (normalized)** (see detailed design in section 4.2). The full point-in-time state is emitted as LogRecord(s) using the already-normalized session shape produced by the reducer (harness-agnostic, schema-validated). Traces remain a complementary option for the per-session "unfolding" view via ContextTree.

**Core value of Normalized Emission:**
The unification / abstraction of the harness choice is what kaaroSessions powers. A kaaroSessions deployment discovers and hooks onto all local harness transcript files (via the registry, scan-harnesses, adapters, and watch logic). It then emits a single, unified, harness-agnostic model in OTLP. Consumers of the telemetry see consistent `Session` and event shapes.

**Harness is an important dimension (Decision A)**: One resource per kaaroSessions deployment (with `kaaro.deployment.harnesses` array listing the harnesses it is currently watching). `harness` is repeated as a first-class attribute on every individual signal (Snapshot Logs, tool_call Spans, tokens Metrics, words Logs, etc.).

This makes `harness` a reliable, queryable dimension everywhere in the telemetry while keeping the core data model unified and harness-agnostic. Downstream systems can filter, group, alert, or correlate by harness ("claude-code only", "compare grok vs pi token efficiency", etc.) without the model itself varying by source.

In short: kaaroSessions deployments are the local hooks that make heterogeneous agent activity observable as one coherent thing, with `harness` as a first-class dimension in the unified surface.

**Normalized Signature** (the full stable contract — the unification point):

This is the canonical shape that all OTLP emits from kaaroSessions must conform to. It is what makes the "normalized emits" real: every consumer sees one consistent model regardless of source harness. `harness` is the important dimension for origin-specific slicing.

#### 1. Resource (one per kaaroSessions deployment)
- `service.name`: "kaaro-sessions"
- `kaaro.deployment.harnesses`: array of harness ids this deployment is currently watching (e.g. ["claude-code", "grok", "pi"])
- `kaaro.deployment.id`: optional stable identifier for this deployment instance (e.g. hostname or user-chosen)
- `kaaro.version`: the kaaroSessions version emitting this data (for signature evolution)

#### 2. Common attributes on every signal (LogRecord, Span, Metric)
- `harness`: string — the origin harness for this specific signal (e.g. "claude-code"). **First-class / important dimension**.
- `session.id`: full UUID of the session.
- `session.slug`: short human label (first 8 chars or from metadata).
- `project.id`: the project directory slug.
- `project.label`: human label for the project.
- `ts`: ISO timestamp of the event or snapshot generation.
- `kaaro.snapshot.generation`: monotonic id or timestamp of the Snapshot this signal relates to (for correlation between baseline Snapshot Logs and subsequent Stream events).

#### 3. Snapshot Logs (periodic "up till now" state — primary for normalized world view)
Emitted after each successful full rebuild (the debounced analyze+build path).

- LogRecord:
  - `severityText`: "INFO" | "SNAPSHOT"
  - `body`: the **full normalized sessions-data shape** (exactly the output of the reducer + enrich + `sessions-schema`, as `stringValue` JSON or structured `kvlistValue`). This includes:
    - `projects[]`
    - `sessions[]` (each using the canonical normalized shape: harness, session_id, project_id, project_label, tokens, tools, file_ops, context_resets, ai_title, subagent_count, branches, content_blocks, etc.)
    - `rollup` (global aggregates)
    - `meta` (generated_at, etc.)
  - Attributes on the LogRecord: `harness` (if single-harness slice), `kaaro.snapshot.type` ("full"), `kaaro.total_sessions`, `kaaro.total_projects`, `kaaro.rebuild_duration_ms`.
- Every session object inside the body **also** carries its own `harness` (and `source`).

This gives consumers the complete current world state in one (or a few) rich logs. Full shape is preferred for maximum information (as requested for the "full normalized picture").

#### 4. Stream signals (realtime incremental updates)
Emitted immediately on new JSONL bytes (via the tail + pulse path). These are the deltas on top of the latest Snapshot.

- `tool_call` → OTLP **Span** (or LogRecord + Event if span semantics are too heavy):
  - name: `tool.{tool}` (e.g. "tool.Read", "tool.Bash")
  - attributes: `tool.name`, `tool.where` (normalized path or command prefix), `tool.why` (description), `tool.category`, plus common attributes above.
- `tokens` → OTLP **Metric** (Sum or Histogram):
  - names: `kaaro.tokens.input`, `kaaro.tokens.output`, `kaaro.tokens.cache_create`, `kaaro.tokens.cache_read`
  - with dimensions from common attributes + `harness`.
- `words` → OTLP **LogRecord**:
  - body: preview text (truncated)
  - attributes: `word_count`, plus common attributes.
- Lifecycle (`status`, `updated`, rebuild events) → LogRecords or resource events with `event.type`.

All Stream signals carry the common attributes (especially `harness` + `session.id` + `kaaro.snapshot.generation` for correlation to the baseline Snapshot Log).

#### 5. Correlation & Multi-harness
- Use `kaaro.snapshot.generation` (or a high-resolution `ts` + `session.id`) to link a Snapshot Log at time T with all subsequent Stream events until the next Snapshot.
- In a multi-harness deployment, the single resource lists all harnesses; individual signals carry the specific `harness` for that item. No splitting of resources per harness.
- The internal `NormalizedRecord` kinds + reducer output + `sessions-schema` are the source of truth for the "normalized" part of the signature. The emitter simply serializes them into the OTLP shape above (no lossy flattening).

#### 6. Why this full signature wins
- Maximum unification: one model for all harnesses.
- `harness` as important dimension: always queryable without changing the shape.
- Richness: the full reducer shape (including ContextTree-derived fields when present) travels through.
- Actionable for consumers: Snapshot Logs give current state for dashboards/inventory; Stream gives live observability for traces, metrics, anomaly detection.
- Easy to evolve: add new common attributes or extend the body shape under a versioned `kaaro.signature_version` resource attribute.

This is the complete "normalized signature" — the full picture of what kaaroSessions deployments emit once they hook the local harness files and normalize. The more we give (full sessions shape, rich attributes, correlation fields), the more powerful the abstraction becomes for downstream telemetry.