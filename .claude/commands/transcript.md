# /transcript — Audio Transcript Generator

Generate a deterministic audio transcript from a Claude Code or Grok session using the Cognitive DAW simulation pipeline.

## Usage

```
/transcript [session] [--preset=X] [--harness=cc|grok|all] [--snap] [--diff] [--summary] [--silent]
```

**session** (optional): 8-char session ID prefix (e.g. `277e6422`, `019eacc0`) or explicit path to a `.jsonl` / `updates.jsonl` file. Omit to auto-pick the most recent session across both harnesses.

**Flags:**
- `--preset=cognitive-flow|thrash-detector|session-arc` — audio profile (default: cognitive-flow)
- `--harness=cc|grok|all` — restrict auto-search to one harness (default: all)
- `--snap` — save snapshot to `test/snapshots/<sid8>-<preset>.snap`
- `--diff` — compare against saved snapshot; fail if different
- `--summary` — show summary counts only, skip per-event lines
- `--silent` — also show JSONL record-type breakdown

## Instructions

Parse `$ARGUMENTS` and run:

```
node scripts/sim-audio.mjs [session-arg] [flags...]
```

Pass all recognised flags through verbatim. If `$ARGUMENTS` is empty, run with no arguments (auto-picks most recent session across CC + Grok).

### Session ID resolution

The script auto-detects the harness from the session ID prefix:
- **CC** sessions live in `~/.claude/projects/<proj>/<uuid>.jsonl`
- **Grok** sessions live in `~/.grok/sessions/<encoded-proj>/<uuid>/updates.jsonl`

If no match is found the script prints the 10 most recent available sessions — relay that list to help the user choose.

### Reading the transcript

Each output line has the form:

```
t+<sec>s   <event>   <tool/detail>   <key>   <instrument>   hz=<hz>  vol=<v>  pan=<p>  bri=<b>  rv=<rv>  [<FAMILY>]
```

Key fields to highlight when interpreting output:
- **instrument** — what sound category: `harp`/`bass`/`pling`/`bit`/`snare`/`kick`/`hat` (file/system ops), `bell` (agent/words), `flute` (token usage)
- **bri** (brightness) — for `flute` events: low (≈800) = high cache ratio (warm context), high (≈5000) = fresh tokens
- **pan** — stereo position: left = write/system ops, right = reads/agent/words
- **rv** — reverb send: high on `agent` and `words` events (cognitive + linguistic activity)
- **[FAMILY]** — FILE · SYSTEM · AI · CONTEXT
- **silent count** — records in the JSONL that produce no audio (structural metadata, user turns, tool results)

### Known gaps to mention

When running against a **Grok session**, note:
1. Most tool calls resolve to `other → harp` at C4 because Grok uses snake_case tool names (`read_file`, `search_replace`, `list_dir`) that don't yet have explicit mappings in `resolveSonic`
2. **No token events** — Grok's `updates.jsonl` doesn't include token usage, so the entire context/flute layer is silent and cognitive pressure can't be computed
3. Timestamps are session-relative offsets (~ms from start), not wall-clock, so `relMs` values are compressed into a short window

### Snapshot workflow

1. First run: `node scripts/sim-audio.mjs <session> --snap` to establish baseline
2. Subsequent runs: `node scripts/sim-audio.mjs <session> --diff` to detect regressions
3. After intentional changes to `lib/audio-sim.mjs` or presets: re-run with `--snap` to update

### Common invocations to suggest

```bash
# Most recent session, any harness
node scripts/sim-audio.mjs

# By harness
node scripts/sim-audio.mjs --harness=grok
node scripts/sim-audio.mjs --harness=cc

# By session ID prefix
node scripts/sim-audio.mjs 277e6422
node scripts/sim-audio.mjs 019eacc0 --preset=thrash-detector

# Summary only
node scripts/sim-audio.mjs --summary --silent

# Save snapshot then diff
node scripts/sim-audio.mjs 277e6422 --snap
node scripts/sim-audio.mjs 277e6422 --diff

# npm equivalents
npm run transcript
npm run transcript:grok
npm run transcript:snap -- 277e6422
npm run transcript:diff
```
