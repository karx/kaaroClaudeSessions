/**
 * experience/client-core/08-layout.mjs — force-layout profiles and the
 * landing-page boot queue. Part of the client-core split; see
 * experience/client-core.mjs.
 */

// ── Force layout profiles ─────────────────────────────────────────────────────

/**
 * Anchored (default): projects pinned on their ring, strong membership pull —
 * the project-centric overview. Free: projects unpin and let go, sessions and
 * files cluster purely by co-access (post-filter exploration mode).
 * @param {boolean} free
 */
export function forceProfile(free) {
  if (free) return {
    projectPinned:      false,
    membershipStrength: 0.05,
    projectCharge:      -200,
    grouping:           false,  // overrides the cluster-by-project checkbox
    center:             true,
  };
  return {
    projectPinned:      true,
    membershipStrength: 0.65,
    projectCharge:      -700,
    grouping:           null,   // honor the cluster-by-project checkbox
    center:             false,
  };
}

/**
 * Landing handshake queue. `firstDelay` holds on a cursor before line one
 * (first-boot pause). Later lines wait `minGap`. `onReveal` fires when
 * that line is shown.
 */
export function createBootQueue(opts = {}) {
  const minGap = opts.minGap ?? 180;
  const firstDelay = opts.firstDelay ?? 0;
  const delay = opts.delay || ((fn, ms) => setTimeout(fn, ms));
  const shown = [];
  const queue = [];
  let timer = null;
  function flush() {
    timer = null;
    if (!queue.length) return;
    const item = queue.shift();
    shown.push(item.html);
    if (opts.onShow) opts.onShow(shown.slice());
    if (typeof item.onReveal === 'function') item.onReveal();
    if (queue.length) timer = delay(flush, minGap);
  }
  function arm() {
    if (timer) return;
    const wait = shown.length === 0 ? firstDelay : minGap;
    if (wait <= 0) flush();
    else timer = delay(flush, wait);
  }
  return {
    push(html, onReveal) {
      queue.push({ html, onReveal });
      arm();
    },
    shown: () => shown.slice(),
  };
}
