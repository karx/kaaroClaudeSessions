# kaaroSessions — Cognitive Experience Wishlist

**Current implementation status (2026-06):**
The `sim-audio.mjs` engine successfully maps AI execution (tool calls, token streams, long text) to a musical scale (e.g., `cognitive-flow`), providing a visceral "AI Work Monitor." However, analysis of raw JSONL sessions reveals a massive "silent majority" of events (e.g., 455 silent records vs 431 audible in Claude Code session `277e6422`). 

The audio currently conveys isolated machine effort—token velocity, file I/O, and system commands—but entirely loses the collaborative human dialogue and the structural scaffolding of the session.

Items below are grouped into three pillars to evolve the simulator from an "AI Work Monitor" into a **Full Cognitive Experience**: **Human Presence → Structural Scaffolding → Semantic Nuance**.

---

## Pillar 1 — Human Presence
The most glaring omission in the current sonic output is the user. The AI appears to act spontaneously, masking the reality of prompt-driven execution.

### W-COG-01 — The Human Prompt (User Event)
**What:** Introduce a distinct, grounding sonic event when the user submits a prompt (`type: "user"`).
**Current state:** `user` events are completely silently dropped.
**Implementation:** Map `user` events to a deep, resonant, and sustained pad or chord (e.g., `synth_pad` or `warm_brass`). The duration or amplitude could scale with the character count of the prompt.
**Why:** Grounds the AI's flurries of activity. A long AI sequence should visually and sonically be preceded by the user's "push," establishing a natural call-and-response rhythm between human and machine.

### W-COG-02 — Context Injection (Attachments)
**What:** Sonify the attachment of files, task lists, or skills (`attachment`).
**Current state:** All `attachment` subtypes (e.g., `task_reminder`, `file`, `invoked_skills`) are silent.
**Implementation:** Map to a swift, ascending arpeggio or a mechanical `click`/`snap` texture.
**Why:** Communicates the "loading of context" before the AI begins processing. It lets the listener hear the payload of knowledge being handed to the agent.

---

## Pillar 2 — Structural Scaffolding
Internal state changes, boundary shifts, and system errors are currently invisible, making it hard to hear when the AI is context-switching, blocked, or hitting cognitive limits.

### W-COG-03 — Agent and Mode Shifts
**What:** Sonify changes in `agent-name`, `ai-title`, and `mode` (e.g., plan mode).
**Current state:** Silent.
**Implementation:** Map to a scale or root key shift. For example, delegating to an exploratory sub-agent shifts the `projectRoot` up a perfect fifth, or changes the `scale` from `major_pentatonic` to `lydian`.
**Why:** Instantly conveys that the cognitive context has branched or shifted focus without needing new instruments.

### W-COG-04 — Compaction and Context Limits
**What:** Highlight when the AI hits context limits and runs a compaction (`system/compact_boundary`).
**Current state:** Silent.
**Implementation:** A sudden, brief atonal sound, a "tape stop" effect, or a heavy filtered sweep (low-pass filter closing).
**Why:** Context compaction is a critical, expensive, and destructive cognitive event. Hearing it helps the developer realize the session is becoming top-heavy.

### W-COG-05 — Permission and System Blocks
**What:** Represent `permission-mode` pauses or `system/api_error` retries.
**Current state:** Silent.
**Implementation:** API errors could trigger a dissonant `glitch` or `static` burst. Waiting for user permissions could introduce a rhythmic, ticking `clock` sequence that pauses the AI's generative instruments.
**Why:** Turns silent waiting or failing into audible tension, drawing the user's attention back to the terminal when their input is required.

---

## Pillar 3 — Semantic Nuance
The current audio reduces complex AI output to raw token volume and file operations. 

### W-COG-06 — Micro-Acknowledgments (Short Words)
**What:** Capture brief text outputs (e.g., "Got it.", "Writing now.") that are under the current simulator's 3-word threshold.
**Current state:** Filtered out (no `bell` triggered).
**Implementation:** Map short text blocks to a muted, fast `chirp` or a light `woodblock` tap, distinct from the resonant `bell` used for long monologues.
**Why:** Preserves the conversational cadence and micro-interactions without overwhelming the mix with loud bells for every "Okay."

### W-COG-07 — Content-Aware Pitching
**What:** Differentiate *what* is being searched or written, rather than just *that* it is happening.
**Current state:** `path_hash` drives the `hz` (pitch), but large code deletions sound the same as large additions.
**Implementation:** Map file operations with net-negative line edits to a descending pitch sweep or lower octave, and net-positive to ascending. For `WebFetch`, use a distinct synthetic texture (e.g., `glass` or `chime`) to separate external network IO from local file `harp` reads.
**Why:** Brings the listener closer to the actual content of the AI's thoughts without needing to read the terminal output.
