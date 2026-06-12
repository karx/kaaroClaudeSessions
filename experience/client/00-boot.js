// Boot sequence â€” called once at end of initialisation (13-live-updates.js)
let _bootDone = false;
window.bootComplete = function() {
  if (_bootDone) return;
  _bootDone = true;
  const el = document.getElementById('boot');
  if (!el) return;
  const proj = GRAPH.nodes.filter(n => n.type === 'project').length;
  const sess = GRAPH.nodes.filter(n => n.type === 'session').length;
  const file = GRAPH.nodes.filter(n => n.type === 'file').length;
  document.getElementById('boot-l2').textContent =
    `> ${proj} projects Â· ${sess} sessions Â· ${file} files`;
  document.getElementById('boot-l3').textContent = '> ready.';
  setTimeout(() => {
    el.classList.add('fade');
    setTimeout(() => { el.style.display = 'none'; }, 420);
  }, 480);
};
