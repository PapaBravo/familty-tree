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
const PARTNER_ROW_PROXIMITY = 12;
const MIN_PARTNER_DISTANCE_FACTOR = 0.8;
const MAX_PARTNER_PLACEMENT_STEPS = 6;

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
  const modeSelect = document.getElementById('tree-mode-select');
  const renderMode = modeSelect ? modeSelect.value : 'descendants';

  if (!rootId) {
    clearTree('Select a root person');
    return;
  }

  // Build subtree up to depth
  const included = new Set();
  let ancestorIds = [];
  if (renderMode === 'ancestors') {
    collectAncestors(rootId, data, depth, 0, included);
    ancestorIds = Array.from(included);
    collectChildrenOfAncestors(data, ancestorIds, included, 2);
    includePartnersOfPersons(data, new Set(ancestorIds), included, false);
  } else {
    collectDescendants(rootId, data, depth, 0, included);
    includeCurrentPartners(data, included);
  }

  const persons   = data.persons.filter(p => included.has(p.id));
  const personById = {};
  persons.forEach(p => { personById[p.id] = p; });
  const partnerships = (data.partnerships || []).filter(
    pp => included.has(pp.person1Id) && included.has(pp.person2Id)
  );
  const currentPartnerships = partnerships.filter(pp => isCurrentPartnership(pp, personById));

  let allNodes = [];
  let nodePositions = {};
  let parentChildEdges = [];
  let treeNodes = [];

  if (renderMode === 'ancestors') {
    const graphLayout = buildAncestorGraphLayout(rootId, persons, partnerships);
    if (!graphLayout) { clearTree('Root not found'); return; }
    parentChildEdges = graphLayout.parentChildEdges;
    allNodes = graphLayout.nodes.map(n => ({ data: n.person, x: n.x, y: n.y }));
    allNodes.forEach(n => { nodePositions[n.data.id] = { x: n.x, y: n.y }; });
  } else {
    // Build hierarchy rooted at selected person
    const nodeMap = {};
    persons.forEach(p => { nodeMap[p.id] = { ...p, children: [] }; });

    persons.forEach(p => {
      (p.parents || []).forEach(pRef => {
        if (nodeMap[pRef.personId] && pRef.personId !== p.id) {
          // parent -> child (default descendants mode)
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
    treeNodes = root.descendants();
    treeNodes.forEach(n => { nodePositions[n.data.id] = { x: n.x, y: n.y }; });
  }

  // Draw
  const g = _svg.select('#tree-g');
  g.selectAll('*').remove();

  const svgEl = document.getElementById('tree-svg');
  const W = svgEl.clientWidth  || 800;
  const H = svgEl.clientHeight || 600;

  // Parent-child links
  if (renderMode === 'ancestors') {
    g.selectAll('.link.parent-child')
      .data(parentChildEdges)
      .join('path')
      .attr('class', d => `link ${d.type === 'adopted' ? 'adopted' : 'parent-child'}`)
      .attr('d', d => {
        const source = nodePositions[d.parentId];
        const target = nodePositions[d.childId];
        if (!source || !target) return '';
        return `M${source.x},${source.y} L${target.x},${target.y}`;
      });
  } else {
    const linkGen = d3.linkVertical().x(d => d.x).y(d => d.y);
    g.selectAll('.link.parent-child')
      .data(treeNodes.map(node => node.parent ? { source: node.parent, target: node } : null).filter(Boolean))
      .join('path')
      .attr('class', d => {
        const rel = getParentChildRelation(d.source.data, d.target.data);
        const type = rel ? rel.type : 'parent-child';
        return `link ${type === 'adopted' ? 'adopted' : 'parent-child'}`;
      })
      .attr('d', linkGen);
  }

  // Partnership links (horizontal)
  if (renderMode !== 'ancestors') {
    const partnerNodes = buildPartnerOnlyNodes(persons, treeNodes, currentPartnerships, nodePositions);
    allNodes = treeNodes.concat(partnerNodes.map(p => ({ data: p.person, x: p.x, y: p.y })));
    partnerNodes.forEach(p => { nodePositions[p.person.id] = { x: p.x, y: p.y }; });
  }

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

function collectAncestors(personId, data, maxDepth, currentDepth, included) {
  if (currentDepth > maxDepth) return;
  if (included.has(personId)) return;
  included.add(personId);

  const person = data.persons.find(p => p.id === personId);
  if (!person) return;
  (person.parents || []).forEach(pr => {
    collectAncestors(pr.personId, data, maxDepth, currentDepth + 1, included);
  });
}

function collectChildrenOfAncestors(data, ancestorIds, included, maxDescDepth) {
  ancestorIds.forEach(ancestorId => {
    collectDescendantsFromAncestor(ancestorId, data, maxDescDepth, 0, included);
  });
}

function collectDescendantsFromAncestor(personId, data, maxDepth, currentDepth, included) {
  if (currentDepth >= maxDepth) return;
  const children = data.persons.filter(p =>
    (p.parents || []).some(pr => pr.personId === personId)
  );
  children.forEach(child => {
    included.add(child.id);
    collectDescendantsFromAncestor(child.id, data, maxDepth, currentDepth + 1, included);
  });
}

function includeCurrentPartners(data, included) {
  const partnerships = data.partnerships || [];
  const personById = {};
  (data.persons || []).forEach(p => { personById[p.id] = p; });

  let changed = true;
  while (changed) {
    changed = false;
    partnerships.forEach(pp => {
      if (!isCurrentPartnership(pp, personById)) return;
      const in1 = included.has(pp.person1Id);
      const in2 = included.has(pp.person2Id);
      if (in1 && !in2) {
        included.add(pp.person2Id);
        changed = true;
      } else if (in2 && !in1) {
        included.add(pp.person1Id);
        changed = true;
      }
    });
  }
}

function includePartnersOfPersons(data, sourceIds, included, currentPartnershipsOnly) {
  const partnerships = data.partnerships || [];
  const personById = {};
  (data.persons || []).forEach(p => { personById[p.id] = p; });

  partnerships.forEach(pp => {
    if (currentPartnershipsOnly && !isCurrentPartnership(pp, personById)) return;
    if (sourceIds.has(pp.person1Id)) included.add(pp.person2Id);
    if (sourceIds.has(pp.person2Id)) included.add(pp.person1Id);
  });
}

function isCurrentPartnership(partnership, personById) {
  if (!partnership) return false;
  if (partnership.type === 'divorced') return false;
  if (partnership.endDate) return false;
  const p1 = personById[partnership.person1Id];
  const p2 = personById[partnership.person2Id];
  if (!p1 || !p2) return false;
  if (p1.deathDate || p2.deathDate) return false;
  return true;
}

function buildAncestorGraphLayout(rootId, persons, partnerships) {
  const personById = {};
  persons.forEach(p => { personById[p.id] = p; });
  if (!personById[rootId]) return null;

  const parentChildEdges = getIncludedParentChildEdges(persons);
  const childrenByParentId = {};
  const parentsByChildId = {};
  persons.forEach(p => {
    childrenByParentId[p.id] = [];
    parentsByChildId[p.id] = [];
  });
  parentChildEdges.forEach(edge => {
    childrenByParentId[edge.parentId].push(edge.childId);
    parentsByChildId[edge.childId].push(edge.parentId);
  });

  const levels = { [rootId]: 0 };
  const queue = [rootId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentLevel = levels[currentId];

    (parentsByChildId[currentId] || []).forEach(parentId => {
      const parentLevel = currentLevel - 1;
      if (levels[parentId] === undefined || parentLevel < levels[parentId]) {
        levels[parentId] = parentLevel;
        queue.push(parentId);
      }
    });

    (childrenByParentId[currentId] || []).forEach(childId => {
      const childLevel = currentLevel + 1;
      if (levels[childId] === undefined || childLevel > levels[childId]) {
        levels[childId] = childLevel;
        queue.push(childId);
      }
    });
  }

  let changed = true;
  while (changed) {
    changed = false;
    (partnerships || []).forEach(pp => {
      if (!personById[pp.person1Id] || !personById[pp.person2Id]) return;
      const l1 = levels[pp.person1Id];
      const l2 = levels[pp.person2Id];
      if (l1 !== undefined && l2 === undefined) {
        levels[pp.person2Id] = l1;
        changed = true;
      } else if (l2 !== undefined && l1 === undefined) {
        levels[pp.person1Id] = l2;
        changed = true;
      }
    });
  }

  persons.forEach(p => {
    if (levels[p.id] === undefined) levels[p.id] = 0;
  });

  const levelValues = Array.from(new Set(Object.values(levels))).sort((a, b) => a - b);
  const positionsById = {};
  levelValues.forEach(level => {
    const levelPersons = persons
      .filter(p => levels[p.id] === level)
      .slice()
      .sort((a, b) => {
        const ax = getAnchorX(a.id, positionsById, parentsByChildId, partnerships);
        const bx = getAnchorX(b.id, positionsById, parentsByChildId, partnerships);
        if (ax !== bx) return ax - bx;
        return (a.name || '').localeCompare(b.name || '');
      });
    const startX = -((levelPersons.length - 1) * H_SEP) / 2;
    levelPersons.forEach((person, idx) => {
      positionsById[person.id] = { x: startX + idx * H_SEP, y: level * V_SEP };
    });
  });

  const nodes = persons.map(person => ({
    person,
    x: positionsById[person.id].x,
    y: positionsById[person.id].y
  }));

  return { nodes, parentChildEdges };
}

function getAnchorX(personId, positionsById, parentsByChildId, partnerships) {
  const anchors = [];
  (parentsByChildId[personId] || []).forEach(parentId => {
    const parentPos = positionsById[parentId];
    if (parentPos) anchors.push(parentPos.x);
  });
  (partnerships || []).forEach(pp => {
    const partnerId = pp.person1Id === personId ? pp.person2Id : (pp.person2Id === personId ? pp.person1Id : null);
    if (!partnerId) return;
    const partnerPos = positionsById[partnerId];
    if (partnerPos) anchors.push(partnerPos.x);
  });
  if (anchors.length === 0) return 0;
  return anchors.reduce((sum, x) => sum + x, 0) / anchors.length;
}

function getIncludedParentChildEdges(persons) {
  const personById = {};
  persons.forEach(p => { personById[p.id] = p; });
  const edges = [];
  persons.forEach(child => {
    (child.parents || []).forEach(parentRef => {
      if (!personById[parentRef.personId] || parentRef.personId === child.id) return;
      edges.push({
        parentId: parentRef.personId,
        childId: child.id,
        type: parentRef.type
      });
    });
  });
  return edges;
}

function getParentChildRelation(personA, personB) {
  if (!personA || !personB) return null;
  const aToB = (personA.parents || []).find(r => r.personId === personB.id);
  if (aToB) return { child: personA, parent: personB, type: aToB.type };
  const bToA = (personB.parents || []).find(r => r.personId === personA.id);
  if (bToA) return { child: personB, parent: personA, type: bToA.type };
  return null;
}

function buildPartnerOnlyNodes(persons, treeNodes, currentPartnerships, nodePositions) {
  const treeNodeIds = new Set(treeNodes.map(n => n.data.id));
  const partnerOnly = persons.filter(p => !treeNodeIds.has(p.id));
  if (partnerOnly.length === 0) return [];

  const pending = new Set(partnerOnly.map(p => p.id));
  const personById = {};
  persons.forEach(p => { personById[p.id] = p; });
  const occupied = Object.values(nodePositions).map(pos => ({ x: pos.x, y: pos.y }));
  const placed = [];

  while (pending.size > 0) {
    let progressed = false;
    for (const personId of Array.from(pending)) {
      const pp = currentPartnerships.find(r =>
        (r.person1Id === personId && nodePositions[r.person2Id]) ||
        (r.person2Id === personId && nodePositions[r.person1Id])
      );
      if (!pp) continue;

      const anchorId = pp.person1Id === personId ? pp.person2Id : pp.person1Id;
      const anchorPos = nodePositions[anchorId];
      if (!anchorPos) continue;
      const preferredDir = pp.person1Id === anchorId ? 1 : -1;
      const pos = findPartnerNodePosition(anchorPos, preferredDir, occupied);

      nodePositions[personId] = pos;
      occupied.push(pos);
      placed.push({ person: personById[personId], x: pos.x, y: pos.y });
      pending.delete(personId);
      progressed = true;
    }
    if (!progressed) break;
  }

  let fallbackOffset = 1;
  pending.forEach(personId => {
    const pos = { x: fallbackOffset * H_SEP, y: V_SEP };
    fallbackOffset += 1;
    nodePositions[personId] = pos;
    placed.push({ person: personById[personId], x: pos.x, y: pos.y });
  });

  return placed;
}

function findPartnerNodePosition(anchorPos, preferredDir, occupied) {
  const minDistance = H_SEP * MIN_PARTNER_DISTANCE_FACTOR;
  const isOccupied = (x, y) => occupied.some(pos =>
    Math.abs(pos.y - y) < PARTNER_ROW_PROXIMITY && Math.abs(pos.x - x) < minDistance
  );

  for (let step = 1; step <= MAX_PARTNER_PLACEMENT_STEPS; step++) {
    const firstDir = preferredDir ?? 1;
    const dirs = step === 1 ? [firstDir] : [firstDir, -firstDir];
    for (const dir of dirs) {
      const x = anchorPos.x + dir * H_SEP * step;
      const y = anchorPos.y;
      if (!isOccupied(x, y)) return { x, y };
    }
  }

  return { x: anchorPos.x + (preferredDir ?? 1) * H_SEP, y: anchorPos.y };
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
