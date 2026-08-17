# Google Antigravity — Simulator Gaps & Roadmap

**Surveyed:** 2026-06-09
**Context:** Analysis of `sim-audio.mjs` running against an active Antigravity session transcript (`transcript.jsonl`).

While the multi-harness design of `kaaroSessions` successfully supports Antigravity, the `cognitive-flow` simulator relies heavily on metrics that Claude Code and Grok provide but Antigravity omits or handles differently. This leads to a degraded sonic footprint where crucial cognitive context is either lost or poorly timed.

Below are the identified gaps and the proposed engineering fixes.

---

## 1. The Clock Gap (Loss of Rhythm)

**The Gap:**
In the audio simulator, all Antigravity events currently register at `t+0.000s`. The `pulse-adapters.mjs` expects a `timestamp` or `created_at` field mapped directly to the tool dispatch, but Antigravity groups all tool calls under a single `PLANNER_RESPONSE` turn, and some nested objects lack proper ISO timestamp bindings in the simulator loop. This causes the entire session to sound like a dense, simultaneous cluster of notes rather than a rhythmic timeline of thought.

**The Fix:**
- Update the simulation loop in `lib/audio-sim.mjs` to check for `rec.created_at` in addition to `rec.timestamp`. This will correctly extract the real ISO timestamps from the Antigravity logs.
- Leave the concurrent `tool_calls[]` within a single `PLANNER_RESPONSE` at their actual exact simultaneous timestamp without any manual staggering, authentically reflecting the parallel nature of the model's output.

## 2. The Compute Gap (Missing Token Velocity)

**The Gap:**
The "Cognitive Flow" preset relies heavily on the `flute` instrument, whose duration and brightness are driven by `input_tokens`, `output_tokens`, and `cache_read_input_tokens`. Antigravity's JSONL currently omits all usage stats at the turn level. As a result, 0 token events are fired, and the `flute` is completely absent from the mix.

**The Fix:**
- **Synthetic Token Pulses:** Modify `parseAntigravityPulse` to generate a synthetic `tokens` event.
- Use the character count of `PLANNER_RESPONSE.content` as a heuristic proxy for `output_tokens` (e.g., `chars / 4`).
- While `cache_read` can't be perfectly guessed, a fixed baseline brightness can be assigned to Antigravity token pulses so the generative "thinking" sound returns to the audio mix.

## 3. The Scaffolding Gap (Silent Ephemerals)

**The Gap:**
Antigravity logs include `EPHEMERAL_MESSAGE` records (often 15–20 per session), which are system-injected constraints or workflow reminders. Currently, `simulateSession()` silently drops these because they originate from `SYSTEM`, not `MODEL`. The listener loses the context that the AI is being steered by internal system prompts.

**The Fix:**
- Register `EPHEMERAL_MESSAGE` in `inferHarness` and `parseAntigravityPulse`.
- Map it to a new sonic key (e.g., `system_prompt` or `constraint`).
- Assign a distinct, non-melodic instrument—like a reverse cymbal, mechanical ratchet, or deep woodblock—to signal that the system is injecting guardrails into the agent's context.

## 4. The Feedback Gap (Silent Tool Results)

**The Gap:**
Like Claude Code, Antigravity separates the *calling* of a tool (`PLANNER_RESPONSE`) from the *result* of a tool (`VIEW_FILE`, `GREP_SEARCH`, `RUN_COMMAND` responses from the `SYSTEM`). The simulator currently only plays sounds for the *calls*. If a `run_command` fails, or if a `view_file` returns 10,000 lines, the listener has no idea.

**The Fix:**
- **Status Mapping:** Extract the `status` field (e.g., `DONE` vs `ERROR`) from the tool result records.
- If a tool returns `ERROR`, emit a `tool_error` event mapped to a dissonant glitch or static burst.
- **Volume by Payload:** For `VIEW_FILE` or `RUN_COMMAND` success, calculate the payload size (`content` character count) and emit a `tool_result` event with amplitude/volume scaling linearly with the payload size. A massive file read should sound "heavier" than a 2-line configuration read.

---

## Next Steps
These gaps highlight that while the adapter layer successfully normalizes tool names, the **audio pulse engine** needs specific heuristics to gracefully handle missing fields (tokens) and misaligned clocks (timestamps) in the Antigravity architecture. Implementing synthetic token pulses and artificial tool staggering will immediately restore the `cognitive-flow` feel for Antigravity sessions.
