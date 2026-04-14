/**
 * tree.js – D3 v7 family tree rendering
 *
 * Layout strategy:
 *  1. Build a directed graph from persons + parent/child relationships.
 *  2. Identify root for the selected person up to the selected depth.
 *  3. Render as a top-down tree (d3.tree).
 *  4. Additionally draw horizontal lines for partnerships.
 */

const NODE_R = 36;   // circle radius
const H_SEP  = 140;  // horizontal separation
const V_SEP  = 160;  // vertical separation

let _treeZoom = null;
let _svg = null;

function initTree() {
  _svg = d3.select('#tree-svg');
  _treeZoom = d3.zoom().scaleExtent([0.15, 3]).on('zoom', e => {
    _svg.select('#tree-g').attr('transform', e.transform);
  });
  _svg.call(_treeZoom);
  _svg.append('g').attr('id', 'tree-g');

  // Populate root select
  populateRootSelect();
}

function populateRootSelect() {
  const sel = document.getElementById('root-select');
  const activeId = getActiveId();
  const data = activeId ? getFamilyData(activeId) : null;
  const persons = data ? (data.persons || []) : [];

  sel.innerHTML = '';
  if (persons.length === 0) {
    sel.innerHTML = '<option value="">No persons</option>';
    return;
  }
  persons.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

function renderTree() {
  const activeId = getActiveId();
  const data = activeId ? getFamilyData(activeId) : null;
  if (!data || !data.persons || data.persons.length === 0) {
    clearTree('No persons to display');
    return;
  }

  const rootId = document.getElementById('root-select').value;
  const depth  = parseInt(document.getElementById('depth-input').value, 10) || 3;

  if (!rootId) {
    clearTree('Select a root person');
    return;
  }

  // Build subtree up to depth
  const included = new Set();
  collectDescendants(rootId, data, depth, 0, included);

  const persons   = data.persons.filter(p => included.has(p.id));
  const partnerships = (data.partnerships || []).filter(
    pp => included.has(pp.person1Id) && included.has(pp.person2Id)
  );

  // Build hierarchy: find root node (person with no parent inside included set)
  // We root at the chosen rootId
  const nodeMap = {};
  persons.forEach(p => { nodeMap[p.id] = { ...p, children: [] }; });

  persons.forEach(p => {
    (p.parents || []).forEach(pRef => {
      if (nodeMap[pRef.personId] && pRef.personId !== p.id) {
        // parent -> child
        nodeMap[pRef.personId].children.push(nodeMap[p.id]);
      }
    });
  });

  const rootNode = nodeMap[rootId];
  if (!rootNode) { clearTree('Root not found'); return; }

  // Remove circular references for d3 hierarchy (deduplicate children)
  const seen = new Set();
  function dedupe(node) {
    if (seen.has(node.id)) { return null; }
    seen.add(node.id);
    node.children = node.children.map(dedupe).filter(Boolean);
    return node;
  }
  dedupe(rootNode);

  const root = d3.hierarchy(rootNode);
  const treeLayout = d3.tree()
    .nodeSize([H_SEP, V_SEP])
    .separation((a, b) => (a.parent === b.parent ? 1.2 : 1.6));

  treeLayout(root);

  // Draw
  const g = _svg.select('#tree-g');
  g.selectAll('*').remove();

  const svgEl = document.getElementById('tree-svg');
  const W = svgEl.clientWidth  || 800;
  const H = svgEl.clientHeight || 600;

  // Parent-child links
  const linkGen = d3.linkVertical().x(d => d.x).y(d => d.y);
  g.selectAll('.link.parent-child')
    .data(root.links())
    .join('path')
    .attr('class', d => {
      const childPerson = d.target.data;
      const parentPerson = d.source.data;
      const pRef = (childPerson.parents || []).find(r => r.personId === parentPerson.id);
      const type = pRef ? pRef.type : 'parent-child';
      return `link ${type === 'adopted' ? 'adopted' : 'parent-child'}`;
    })
    .attr('d', linkGen);

  // Partnership links (horizontal)
  const allNodes = root.descendants();
  const nodePositions = {};
  allNodes.forEach(n => { nodePositions[n.data.id] = { x: n.x, y: n.y }; });

  partnerships.forEach(pp => {
    const pos1 = nodePositions[pp.person1Id];
    const pos2 = nodePositions[pp.person2Id];
    if (!pos1 || !pos2) return;
    const mx = (pos1.x + pos2.x) / 2;
    const my = (pos1.y + pos2.y) / 2;
    g.append('path')
      .attr('class', `link ${pp.type}`)
      .attr('d', `M${pos1.x},${pos1.y} Q${mx},${my - 30} ${pos2.x},${pos2.y}`);
  });

  // Nodes
  const nodeGroups = g.selectAll('.node')
    .data(allNodes)
    .join('g')
    .attr('class', d => `node ${d.data.deathDate ? 'deceased' : 'living'}`)
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      event.stopPropagation();
      showPersonDetail(d.data.id);
    });

  // Circle background
  nodeGroups.append('circle')
    .attr('r', NODE_R);

  // Image clip path
  const defs = _svg.append('defs');
  allNodes.forEach((n, i) => {
    defs.append('clipPath')
      .attr('id', `clip-${i}`)
      .append('circle')
      .attr('r', NODE_R);
  });

  // Images
  allNodes.forEach((n, i) => {
    const safeUrl = sanitizeImageUrl(n.data.image);
    if (safeUrl) {
      nodeGroups.filter((d, j) => j === i)
        .append('image')
        .attr('href', safeUrl)
        .attr('x', -NODE_R)
        .attr('y', -NODE_R)
        .attr('width', NODE_R * 2)
        .attr('height', NODE_R * 2)
        .attr('clip-path', `url(#clip-${i})`);
    }
  });

  // Name label
  nodeGroups.append('text')
    .attr('y', NODE_R + 16)
    .attr('text-anchor', 'middle')
    .text(d => truncate(d.data.name || '—', 20));

  // Birth / death dates
  nodeGroups.append('text')
    .attr('class', 'date-text')
    .attr('y', NODE_R + 30)
    .attr('text-anchor', 'middle')
    .text(d => {
      const parts = [];
      if (d.data.birthDate) parts.push(d.data.birthDate.slice(0, 4));
      if (d.data.deathDate) parts.push(d.data.deathDate.slice(0, 4));
      return parts.join(' – ');
    });

  // Fit tree to viewport
  const bounds = g.node().getBBox();
  const scale  = Math.min(0.9 * W / bounds.width, 0.9 * H / bounds.height, 1.5);
  const tx = W / 2 - scale * (bounds.x + bounds.width  / 2);
  const ty = H / 2 - scale * (bounds.y + bounds.height / 2);
  _svg.call(_treeZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function collectDescendants(personId, data, maxDepth, currentDepth, included) {
  if (currentDepth > maxDepth) return;
  if (included.has(personId)) return;
  included.add(personId);

  const children = data.persons.filter(p =>
    (p.parents || []).some(pr => pr.personId === personId)
  );
  children.forEach(child => collectDescendants(child.id, data, maxDepth, currentDepth + 1, included));
}

function clearTree(msg) {
  const g = _svg ? _svg.select('#tree-g') : null;
  if (g) g.selectAll('*').remove();
  if (msg && g) {
    const svgEl = document.getElementById('tree-svg');
    const W = svgEl ? svgEl.clientWidth  || 800 : 800;
    const H = svgEl ? svgEl.clientHeight || 600 : 600;
    g.append('text')
      .attr('x', W / 2).attr('y', H / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted)')
      .text(msg);
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}
