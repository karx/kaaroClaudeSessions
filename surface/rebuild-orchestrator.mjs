/**
 * surface/rebuild-orchestrator.mjs — Snapshot production scheduling.
 *
 * Debounced full (or targeted) analyze + build pipeline with coalescing:
 * a rebuild requested while one is running becomes a single pending
 * follow-up. Lifecycle flows to the hub as status / updated / error events.
 *
 * runScript is injected (serve passes an execFile wrapper) so the
 * orchestration is testable without child processes.
 */

/**
 * @param {object} deps
 * @param {{ notify: (event: string, data?: string) => void }} deps.hub
 * @param {(script: string, args?: string[]) => Promise<void>} deps.runScript
 * @param {string} deps.analyzeScript
 * @param {string} deps.buildScript
 * @param {number} [deps.debounceMs]
 * @param {() => void} [deps.onSnapshot] — after analyze writes sessions-data
 * @param {{ log: Function, error: Function }} [deps.log]
 */
export function createRebuilder({
  hub, runScript, analyzeScript, buildScript, debounceMs = 1500, onSnapshot = null, log = console,
}) {
  let rebuilding     = false;
  let pendingRebuild = false;
  let debounceTimer  = null;
  let lastBuilt      = null;

  async function rebuild(target = null) {
    if (rebuilding) {
      pendingRebuild = true;
      return;
    }
    rebuilding = true;
    const t0 = Date.now();
    log.log(`\n[${new Date().toLocaleTimeString()}] Rebuilding…`);
    hub.notify('status', 'rebuilding');

    try {
      // Use targeted arg (e.g. --session=...) when provided by watch handler.
      // analyze.mjs takes the fast path (parseSessionFlag + mergeSessionIntoData)
      // for supported cases instead of a full multi-harness scan.
      let analyzeArgs;
      if (target?.rebuildArg) {
        analyzeArgs = [target.rebuildArg];
        if (target.harnessId) {
          analyzeArgs.unshift(`--harness=${target.harnessId}`);
        }
      } else {
        analyzeArgs = ['--all-harnesses'];
      }
      await runScript(analyzeScript, analyzeArgs);
      try { onSnapshot?.(); } catch (e) { log.error?.('onSnapshot failed:', e.message); }
      await runScript(buildScript);
      lastBuilt = new Date();
      log.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      hub.notify('updated', lastBuilt.toISOString());
    } catch (e) {
      log.error('Rebuild failed:', e.message);
      hub.notify('error', e.message.slice(0, 200));
    } finally {
      rebuilding = false;
      if (pendingRebuild) {
        pendingRebuild = false;
        rebuild();
      }
    }
  }

  function scheduleRebuild(target = null) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => rebuild(target), debounceMs);
    debounceTimer.unref?.();
  }

  return {
    rebuild,
    scheduleRebuild,
    get state() { return { rebuilding, lastBuilt }; },
  };
}