/**
 * experience/kind-map-widget.mjs — HTML projection of a Kind Map payload.
 *
 * No hooks imports. Register A tokens via CSS variables (caller injects
 * tokensToCss into the page wrap). Cells are never authored here.
 */

import { esc } from './client-core.mjs';

/**
 * Pure hit list for one Stream pulse. Browser live script uses the same
 * function (injected via toString). No hooks imports — join-tested against
 * routeIdFromPulse in test/kind-map.test.mjs.
 */
export function kindMapPulseHits(event, data) {
  if (!event || !data || !data.harness || !data.nr_kind) return [];
  const hits = [{ type: 'kind', id: data.nr_kind, h: data.harness }];
  let rid = null;
  if (data.nr_kind === 'content_block') {
    if (event === 'thinking' || data.block_type === 'thinking') rid = 'thinking';
    else if (event === 'words') rid = 'words';
    else if (event === 'chirp') rid = 'chirp';
    else if (data.block_type === 'tool_use' || data.reason === 'duplicate') rid = 'duplicate';
    else if (event === 'unknown') rid = 'unknown-block';
  } else if (data.nr_kind === 'tool_result') {
    if (event === 'tool_error') rid = 'error';
    else if (event === 'tool_result') rid = 'ok';
  }
  if (rid) hits.push({ type: 'kind', id: data.nr_kind + '/' + rid, h: data.harness });
  if (event === 'tool_call' && data.key && data.tool) {
    hits.push({ type: 'tool', key: data.key, h: data.harness, name: data.tool });
  }
  return hits;
}

/** Slim coverage-hole record. Injected into the live page via toString. */
export function unknownFromPulse(event, data) {
  if (event !== 'unknown' || !data) return null;
  if (!data.harness && !data.nr_kind) return null;
  return {
    harness: data.harness || null,
    nr_kind: data.nr_kind || null,
    raw_type: data.raw_type == null ? null : data.raw_type,
    block_type: data.block_type == null ? null : data.block_type,
    slug: data.slug || null,
    project: data.project || null,
    session_id: data.session_id || null,
    ts: data.ts || null,
  };
}

export function unknownKey(u) {
  return [u.harness || '', u.nr_kind || '', u.raw_type || '', u.block_type || ''].join('|');
}

export function addUnknown(list, entry, max) {
  if (max == null) max = 80;
  if (!entry) return Array.isArray(list) ? list : [];
  const key = unknownKey(entry);
  const cur = Array.isArray(list) ? list.slice() : [];
  const i = cur.findIndex(function (x) { return x.key === key; });
  if (i >= 0) {
    const prev = cur[i];
    cur.splice(i, 1);
    cur.unshift({
      key: prev.key,
      harness: prev.harness,
      nr_kind: prev.nr_kind,
      raw_type: prev.raw_type,
      block_type: prev.block_type,
      count: (prev.count || 1) + 1,
      last_ts: entry.ts || prev.last_ts || null,
      slug: entry.slug || prev.slug || null,
      project: entry.project || prev.project || null,
      session_id: entry.session_id || prev.session_id || null,
      source: prev.source,
    });
  } else {
    cur.unshift({
      key: key,
      harness: entry.harness || null,
      nr_kind: entry.nr_kind || null,
      raw_type: entry.raw_type == null ? null : entry.raw_type,
      block_type: entry.block_type == null ? null : entry.block_type,
      count: 1,
      last_ts: entry.ts || null,
      slug: entry.slug || null,
      project: entry.project || null,
      session_id: entry.session_id || null,
      source: entry.source || 'pulse',
    });
  }
  return cur.slice(0, max);
}

function widgetCss() {
  return `
.k-kind-map { font: 11px var(--k-font); color: var(--k-body); }
.k-kind-map h2 {
  margin: 18px 0 8px; font-size: 11px; font-weight: 600;
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--k-label);
}
.k-kind-map .k-map-note { color: var(--k-dim); font-size: 10px; margin: 0 0 8px; }
.k-kind-map table { width: 100%; border-collapse: collapse; }
.k-kind-map th, .k-kind-map td {
  padding: 5px 6px; border-bottom: 1px solid var(--k-border); white-space: nowrap;
  text-align: left;
}
.k-kind-map th { color: var(--k-label); font-weight: 600; letter-spacing: 0.06em; }
.k-kind-map .k-emit { color: var(--k-geo); }
.k-kind-map .k-live { color: var(--k-select); }
.k-kind-map .k-miss { color: var(--k-dim); }
.k-kind-map .k-na { color: var(--k-dim); }
.k-kind-map .k-catch { color: var(--k-data); }
.k-kind-map .k-alarm { color: var(--k-err); }
.k-kind-map .k-pulse { color: var(--k-data); }
.k-kind-map .k-pulse.silent { color: var(--k-dim); }
.k-kind-map .k-pulse.unknown { color: var(--k-err); }
.k-kind-map .k-tools { color: var(--k-body); font-size: 10px; }
.k-kind-map-wrap { overflow-x: auto; border: 1px solid var(--k-border); }
.k-kind-map tr.k-child td:first-child { padding-left: 16px; color: var(--k-dim); }
.k-kind-map td.k-hit, .k-kind-map th.k-hit {
  animation: k-hit 1.8s ease-out;
}
@keyframes k-hit {
  0%   { color: var(--k-bg); background: var(--k-geo); }
  100% { color: var(--k-geo); background: transparent; }
}
.k-unknown-bucket { margin-top: 18px; border: 1px solid var(--k-border); padding: 8px 10px; }
.k-unknown-bucket .k-unknown-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.k-unknown-bucket .k-unknown-head h2 { margin: 0; }
.k-unknown-bucket #k-unknown-count { color: var(--k-err); letter-spacing: 0.06em; }
.k-unknown-bucket ol {
  margin: 8px 0 0; padding-left: 18px; color: var(--k-err);
  font-size: 10px; max-height: 220px; overflow: auto;
}
.k-kind-map .k-tag {
  display: inline-block; margin-left: 5px; padding: 0 4px;
  font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase;
  border: 1px solid var(--k-border); color: var(--k-dim); vertical-align: 1px;
}
.k-kind-map .k-tag-local { color: var(--k-geo); border-color: var(--k-geo); }
.k-kind-map .k-tag-disk { color: var(--k-label); }
.k-kind-map .k-tag-seen { color: var(--k-data); }
.k-kind-map th.k-col-local { color: var(--k-geo); }
.k-unknown-bucket li { margin: 3px 0; }
.k-unknown-bucket li.k-u-hit {
  animation: k-unknown-hit 1.8s ease-out;
}
@keyframes k-unknown-hit {
  0%   { color: var(--k-bg); background: var(--k-err); }
  100% { color: var(--k-err); background: transparent; }
}
`;
}

function pulseSpan(row) {
  const pulseClass = row.pulse === 'silent' ? ' silent'
    : (row.pulse === 'unknown' || row.role === 'alarm') ? ' unknown' : '';
  const pulseLabel = row.reason ? `${row.pulse} (${row.reason})` : (row.pulse || '');
  return `<span class="k-pulse${pulseClass}">${esc(pulseLabel)}</span>`;
}

function kindCell(row, i, harnesses, dataKind) {
  const hid = harnesses[i] ? harnesses[i].id : String(i);
  const proof = (row.proof && row.proof[i]) || [];
  const emit = (row.emit || [])[i];
  const expect = !row.expect || row.expect[i] !== 0;
  const role = row.role || 'emit';
  const contract = proof.includes('golden') || proof.includes('sample');
  const live = proof.includes('pulse');
  const seen = contract || live || emit;
  let cls = 'k-miss';
  let mark = '·';
  if (seen) {
    if (role === 'catchall') { cls = 'k-catch'; mark = '&#9671;'; }
    else if (role === 'alarm') { cls = 'k-alarm'; mark = '&#9679;'; }
    else if (contract || !live) { cls = 'k-emit'; mark = '&#9679;'; }
    else { cls = 'k-live'; mark = '&#9675;'; }
  } else if (role === 'catchall' || role === 'alarm' || !expect) {
    cls = 'k-na';
    mark = '&#8211;';
  }
  const title = proof.length ? ` title="${esc(proof.join(', '))}"` : '';
  return `<td class="${cls}" data-kind="${esc(dataKind)}" data-h="${esc(hid)}" data-role="${esc(role)}"${title}>${mark}</td>`;
}

function kindRow(row, harnesses, { child = false, parentId = '' } = {}) {
  const dataKind = child ? `${parentId}/${row.id}` : row.id;
  const cells = harnesses.map((_, i) => kindCell(row, i, harnesses, dataKind)).join('');
  const stub = child
    ? `${esc(row.id)} ${pulseSpan(row)}`
    : `${esc(row.id)} ${pulseSpan(row)}`;
  const trClass = child ? ' class="k-child"' : '';
  return `<tr${trClass}><td>${stub}</td>${cells}</tr>`;
}

function harnessHead(h) {
  const local = h.detected && h.verified;
  let tags = '';
  if (local) tags = '<span class="k-tag k-tag-local">local</span>';
  else if (h.detected) tags = '<span class="k-tag k-tag-disk">disk</span>';
  else if (h.verified) tags = '<span class="k-tag k-tag-seen">seen</span>';
  const cls = local ? ' class="k-col-local"' : '';
  return `<th title="${esc(h.label)}" data-h="${esc(h.id)}" data-detected="${h.detected ? '1' : '0'}" data-verified="${h.verified ? '1' : '0'}"${cls}>${esc(h.id)}${tags}</th>`;
}

export function renderKindMapSnippet(payload) {
  const harnesses = payload.harnesses || [];
  const kinds = payload.kinds || [];
  const tools = payload.tools || [];
  const at = payload.generated_at ? esc(payload.generated_at) : '';

  const kindHead = '<tr><th>kind</th>' + harnesses.map(harnessHead).join('') + '</tr>';

  const kindBody = kinds.map(k => {
    let html = kindRow(k, harnesses);
    for (const rt of k.routes || []) {
      html += kindRow(rt, harnesses, { child: true, parentId: k.id });
    }
    return html;
  }).join('');

  const toolHead = '<tr><th>key</th>' + harnesses.map(harnessHead).join('') + '</tr>';

  const toolBody = tools.map(t => {
    const cells = harnesses.map(h => {
      const names = (t.by_harness && t.by_harness[h.id]) || [];
      if (!names.length) {
        const idle = t.role === 'catchall';
        const cls = idle ? 'k-na' : 'k-miss';
        const mark = idle ? '&#8211;' : '·';
        return `<td class="${cls}" data-tool="${esc(t.key)}" data-h="${esc(h.id)}" data-role="${esc(t.role || 'emit')}">${mark}</td>`;
      }
      return `<td class="k-tools" data-tool="${esc(t.key)}" data-h="${esc(h.id)}" data-role="${esc(t.role || 'emit')}">${esc(names.join(', '))}</td>`;
    }).join('');
    return `<tr><td>${esc(t.key)}</td>${cells}</tr>`;
  }).join('');

  const unknowns = payload.unknowns || [];
  const unknownTotal = unknowns.reduce((n, u) => n + (u.count || 1), 0);
  const unknownItems = unknowns.map(u => {
    const bits = [u.harness, u.nr_kind].filter(Boolean);
    if (u.raw_type) bits.push('raw=' + u.raw_type);
    if (u.block_type) bits.push('block=' + u.block_type);
    const title = [u.slug, u.project, u.last_ts].filter(Boolean).join(' · ');
    return `<li data-ukey="${esc(u.key)}"${title ? ` title="${esc(title)}"` : ''}>×${u.count || 1}  ${esc(bits.join('  '))}</li>`;
  }).join('');
  const unknownJson = JSON.stringify({
    generated_at: payload.generated_at || null,
    unknowns,
  }).replace(/</g, '\\u003c');
  const unknownEmpty = unknowns.length
    ? ''
    : '<p id="k-unknown-empty" class="k-map-note">no unknowns</p>';

  return `<section class="k-kind-map" data-generated="${at}">
<style>${widgetCss()}</style>
<p class="k-map-note">● proved  ○ live  – n/a  · hole  ◇ catch-all  red ● unclassified block</p>
<h2>Kind × harness</h2>
<div class="k-kind-map-wrap"><table>
<thead>${kindHead}</thead>
<tbody>${kindBody}</tbody>
</table></div>
<h2>Tool key × harness</h2>
<div class="k-kind-map-wrap"><table>
<thead>${toolHead}</thead>
<tbody>${toolBody}</tbody>
</table></div>
<div class="k-unknown-bucket" id="k-unknown-bucket">
<div class="k-unknown-head">
<h2>Unknown bucket</h2>
<span id="k-unknown-count">${unknownTotal}</span>
<button type="button" class="k-btn" id="k-unknown-copy">copy JSON</button>
</div>
<p class="k-map-note">coverage holes — share with a maintainer</p>
${unknownEmpty}
<ol id="k-unknown-list">${unknownItems}</ol>
<script type="application/json" id="k-unknown-json">${unknownJson}</script>
</div>
</section>`;
}

export function renderKindMapPage(payload, { tokensCss = '', live = false, streamEvents = [] } = {}) {
  const at = payload.generated_at ? esc(payload.generated_at) : '—';
  const nH = (payload.harnesses || []).length;
  const nK = (payload.kinds || []).length;
  const status = live
    ? `generated ${at} · ${nH} harnesses · ${nK} kinds · listening /events`
    : `generated ${at} · ${nH} harnesses · ${nK} kinds · static`;
  const liveScript = live ? `
<script>
(function () {
  ${kindMapPulseHits.toString()}
  ${unknownFromPulse.toString()}
  ${unknownKey.toString()}
  ${addUnknown.toString()}
  var STREAM = ${JSON.stringify(streamEvents)};
  var pulses = 0;
  window._kUnknownBucket = ${JSON.stringify(payload.unknowns || [])};
  function ping(el) {
    if (!el) return;
    el.classList.remove('k-hit');
    void el.offsetWidth;
    el.classList.add('k-hit');
    setTimeout(function () { el.classList.remove('k-hit'); }, 1800);
  }
  function pingUnknown(el) {
    if (!el) return;
    el.classList.remove('k-u-hit');
    void el.offsetWidth;
    el.classList.add('k-u-hit');
    setTimeout(function () { el.classList.remove('k-u-hit'); }, 1800);
  }
  function drawBucket(list) {
    window._kUnknownBucket = list;
    var ol = document.getElementById('k-unknown-list');
    var countEl = document.getElementById('k-unknown-count');
    var empty = document.getElementById('k-unknown-empty');
    var total = 0;
    (list || []).forEach(function (u) { total += u.count || 1; });
    if (countEl) countEl.textContent = String(total);
    if (empty) empty.style.display = list && list.length ? 'none' : '';
    if (!ol) return;
    ol.replaceChildren();
    (list || []).forEach(function (u, idx) {
      var li = document.createElement('li');
      li.setAttribute('data-ukey', u.key || '');
      var bits = [];
      if (u.harness) bits.push(u.harness);
      if (u.nr_kind) bits.push(u.nr_kind);
      if (u.raw_type) bits.push('raw=' + u.raw_type);
      if (u.block_type) bits.push('block=' + u.block_type);
      li.textContent = '\\u00D7' + (u.count || 1) + '  ' + bits.join('  ');
      var title = [u.slug, u.project, u.last_ts].filter(Boolean).join(' \\u00B7 ');
      if (title) li.title = title;
      ol.appendChild(li);
      if (idx === 0) pingUnknown(li);
    });
    var json = document.getElementById('k-unknown-json');
    if (json) json.textContent = JSON.stringify({ generated_at: new Date().toISOString(), unknowns: list });
  }
  function upgradeKind(td) {
    var role = td.getAttribute('data-role') || 'emit';
    if (role === 'catchall') {
      td.className = 'k-catch';
      td.textContent = '\\u25C7';
    } else if (role === 'alarm') {
      td.className = 'k-alarm';
      td.textContent = '\\u25CF';
    } else if (!td.classList.contains('k-emit')) {
      td.className = 'k-live';
      td.textContent = '\\u25CB';
    }
    var title = td.getAttribute('title') || '';
    if (title.indexOf('pulse') < 0) td.setAttribute('title', title ? title + ', pulse' : 'pulse');
  }
  function upgradeTool(td, name) {
    if (!name) return;
    if (td.classList.contains('k-tools')) {
      var cur = td.textContent.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (cur.indexOf(name) < 0) {
        cur.push(name);
        td.textContent = cur.join(', ');
      }
    } else {
      td.className = 'k-tools';
      td.setAttribute('data-role', td.getAttribute('data-role') || 'emit');
      td.textContent = name;
    }
  }
  function tagLocal(hid) {
    document.querySelectorAll('th[data-h="'+hid+'"]').forEach(function (th) {
      th.setAttribute('data-verified', '1');
      if (th.getAttribute('data-detected') !== '1') return;
      if (th.querySelector('.k-tag-local')) return;
      th.classList.add('k-col-local');
      var disk = th.querySelector('.k-tag-disk');
      if (disk) disk.remove();
      var tag = document.createElement('span');
      tag.className = 'k-tag k-tag-local';
      tag.textContent = 'local';
      th.appendChild(tag);
    });
  }
  function applyHits(hits) {
    hits.forEach(function (hit) {
      var td, ths;
      if (hit.type === 'kind') {
        td = document.querySelector('td[data-kind="'+hit.id+'"][data-h="'+hit.h+'"]');
        if (td) upgradeKind(td);
      } else if (hit.type === 'tool') {
        td = document.querySelector('td[data-tool="'+hit.key+'"][data-h="'+hit.h+'"]');
        if (td) upgradeTool(td, hit.name);
      }
      ping(td);
      tagLocal(hit.h);
      ths = document.querySelectorAll('th[data-h="'+hit.h+'"]');
      ths.forEach(ping);
    });
  }
  function onPulse(name, ev) {
    var data = null;
    try { data = JSON.parse(ev.data); } catch (err) { return; }
    var hole = unknownFromPulse(name, data);
    if (hole) drawBucket(addUnknown(window._kUnknownBucket, hole));
    var hits = kindMapPulseHits(name, data);
    if (!hits.length) return;
    pulses += 1;
    applyHits(hits);
    var bar = document.getElementById('k-map-status');
    if (bar) {
      var last = hits[0];
      bar.textContent = 'LIVE · ' + pulses + ' pulse' + (pulses === 1 ? '' : 's') + ' · ' + last.h + ' ' + (last.id || last.key || '');
    }
  }
  function refresh() {
    fetch('/mapping?partial=1').then(function (r) { return r.text(); }).then(function (html) {
      var wrap = document.createElement('div');
      wrap.innerHTML = html.trim();
      var next = wrap.querySelector('.k-kind-map');
      var el = document.querySelector('.k-kind-map');
      if (el && next) el.replaceWith(next);
      var raw = document.getElementById('k-unknown-json');
      if (raw) {
        try {
          var parsed = JSON.parse(raw.textContent);
          window._kUnknownBucket = parsed.unknowns || [];
        } catch (err) {}
      }
    }).catch(function () {});
  }
  if (typeof EventSource === 'undefined') return;
  var es = new EventSource('/events');
  STREAM.forEach(function (name) {
    es.addEventListener(name, function (ev) { onPulse(name, ev); });
  });
  es.addEventListener('updated', refresh);
  es.onopen = function () {
    var b = document.getElementById('k-map-live');
    if (b) { b.textContent = '\\u2B24 LIVE'; b.className = 'on'; }
  };
  es.onerror = function () {
    var b = document.getElementById('k-map-live');
    if (b) { b.textContent = '\\u25CC reconnecting'; b.className = 'err'; }
  };
})();
</script>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kaaro-sessions — kind map</title>
<link rel="icon" href="/favicon.svg">
<style>
${tokensCss}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; }
body {
  background: var(--k-bg); color: var(--k-body);
  font: 12px var(--k-font); line-height: 1.4;
  display: grid; grid-template-rows: 28px 1fr 18px;
}
.k-kind-page { overflow: auto; padding: 16px 18px 28px; }
#k-map-live { margin-left: auto; color: var(--k-dim); letter-spacing: 0.08em; }
#k-map-live.on { color: var(--k-geo); }
#k-map-live.err { color: var(--k-err); }
</style>
</head>
<body>
<header class="k-topbar">
  <span class="k-title">kind map</span>
  <a href="/">home</a>
  <a href="/graph">graph</a>
  <a href="/now">now</a>
  <a href="/daw">daw</a>
  <a class="k-here" href="/mapping">map</a>
  ${live ? '<span id="k-map-live">◌</span>' : ''}
</header>
<main class="k-kind-page">
${renderKindMapSnippet(payload)}
</main>
<footer class="k-statusbar" id="k-map-status">${status}</footer>
${liveScript}
<script>
(function () {
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('#k-unknown-copy');
    if (!btn) return;
    var text = '';
    if (window._kUnknownBucket) {
      text = JSON.stringify({ generated_at: new Date().toISOString(), unknowns: window._kUnknownBucket }, null, 2);
    } else {
      var raw = document.getElementById('k-unknown-json');
      if (raw) {
        try { text = JSON.stringify(JSON.parse(raw.textContent), null, 2); }
        catch (err) { text = raw.textContent || ''; }
      }
    }
    if (!text || !navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(function () {
      btn.textContent = 'copied';
      setTimeout(function () { btn.textContent = 'copy JSON'; }, 1400);
    }).catch(function () {});
  });
})();
</script>
</body>
</html>`;
}
