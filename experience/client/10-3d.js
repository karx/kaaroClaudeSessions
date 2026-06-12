// â”€â”€ 3D layout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const layout3D = {
  _g: null,
  enter() {
    document.getElementById('canvas').style.display='none';
    document.getElementById('matrix-view').style.display='none';
    document.getElementById('three-view').style.display='block';
    simulation.stop();
    if (typeof ForceGraph3D === 'undefined') {
      document.getElementById('three-view').innerHTML='<div style="color:#445;padding:60px;text-align:center;font-family:monospace;font-size:13px">Loading 3D libraryâ€¦<br>Try switching back once loaded.</div>';
      return;
    }
    const showBranch=document.getElementById('cb-branch').checked, showReads=document.getElementById('cb-reads').checked;
    const showFiles=document.getElementById('cb-files').checked, minSess=+document.getElementById('sl-min').value;
    const hiddenIds=new Set(GRAPH.nodes.filter(n=>(n.type==='file'&&(!showFiles||n.session_count<minSess))||(n.type==='session'&&tlFrom&&n.date_str&&n.date_str<tlFrom)).map(n=>n.id));
    const nodes3d=GRAPH.nodes.filter(n=>!hiddenIds.has(n.id)).map(n=>({...n}));
    const links3d=GRAPH.edges.filter(e=>{const s=e.source?.id??e.source,t=e.target?.id??e.target;if(hiddenIds.has(s)||hiddenIds.has(t))return false;if(e.type==='branch'&&!showBranch)return false;if(e.type==='read'&&!showReads)return false;return true;}).map(e=>({source:e.source?.id??e.source,target:e.target?.id??e.target,type:e.type,weight:e.weight}));
    this._g=ForceGraph3D({controlType:'orbit'})(document.getElementById('three-view'))
      .width(W).height(H).backgroundColor('#080810')
      .graphData({nodes:nodes3d,links:links3d})
      .nodeId('id').nodeLabel('label').nodeColor(d=>d.color).nodeVal(d=>nodeRadius(d)*1.8).nodeOpacity(0.85)
      .linkColor(e=>EDGE_COLORS[e.type]||'#444').linkOpacity(0.4).linkWidth(e=>edgeWidth(e, MAX_WEIGHT))
      .onNodeClick((node,ev)=>{ev.stopPropagation();selectedId=node.id;const orig=nodeById[node.id];if(orig)showPanel(orig);})
      .onBackgroundClick(()=>{selectedId=null;closePanel();});
  },
  exit() {
    document.getElementById('three-view').style.display='none';
    document.getElementById('canvas').style.display='block';
    if(this._g){document.getElementById('three-view').innerHTML='';this._g=null;}
  }
};
