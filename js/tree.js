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
const ANCESTOR_MIN_GAP_FACTOR = 0.95;            // Keep same-row nodes nearly one H_SEP apart while allowing subtle compression.
const ANCESTOR_OPTIMIZATION_ITERATIONS = 60;     // Iteration budget for horizontal constraint settling.
const ANCESTOR_FINAL_ALIGNMENT_PASSES = 3;       // Final midpoint alignment passes after iterative settling.
const PARENT_MIDPOINT_PULL = 0.55;               // Strength for pulling children toward parent midpoint.
const CHILD_MIDPOINT_PULL = 0.2;                 // Lighter reverse pull from parents toward children.
const PARTNER_GAP_CORRECTION = 0.25;             // Strength for spouse-gap correction toward one H_SEP.
// Full-family constants are empirically tuned for readable spacing on mixed-size family datasets.
const FULL_FAMILY_MIN_GAP_FACTOR = 0.78;          // Minimum same-row spacing as a fraction of H_SEP.
const FULL_FAMILY_OPTIMIZATION_ITERATIONS = 90;   // Iterative gravity-settling budget.
const FULL_FAMILY_PARTNER_PULL = 0.52;            // Primary pull: keeps spouses near each other.
const FULL_FAMILY_PARENT_PULL = 0.38;             // Secondary pull: keep children under parent midpoint.
const FULL_FAMILY_CHILD_PULL = 0.12;              // Light reverse pull for parent balancing.
const FULL_FAMILY_TARGET_PARTNER_GAP_FACTOR = 0.72; // Preferred spouse gap relative to H_SEP.
const FULL_FAMILY_RELAXATION_ITERATION_MULTIPLIER = 2; // Empirically sufficient for practical family DAGs.

let _treeZoom = null;
let _svg = null;
let _forceSimulation = null;

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

  if (!rootId && renderMode !== 'force') {
    clearTree('Select a root person');
    return;
  }

  const graph = buildRenderGraph(data, rootId, depth, renderMode);
  if (graph.error) {
    clearTree(graph.error);
    return;
  }

  console.log('Final graph data structure:', graph);
  drawRenderGraph(graph);
}

function buildRenderGraph(data, rootId, depth, renderMode) {
  if (renderMode === 'ancestors') {
    return buildAncestorsRenderGraph(data, rootId, depth);
  }
  if (renderMode === 'full-family') {
    return buildFullFamilyRenderGraph(data, rootId);
  }
  if (renderMode === 'force') {
    return buildForceRenderGraph(data);
  }
  return buildDescendantsRenderGraph(data, rootId, depth);
}

function buildDescendantsRenderGraph(data, rootId, depth) {
  const included = new Set();
  collectDescendants(rootId, data, depth, 0, included);
  includeCurrentPartners(data, included);

  const persons = data.persons.filter(p => included.has(p.id));
  const personById = {};
  persons.forEach(p => { personById[p.id] = p; });
  const partnerships = (data.partnerships || []).filter(
    pp => included.has(pp.person1Id) && included.has(pp.person2Id)
  );
  const currentPartnerships = partnerships.filter(pp => isCurrentPartnership(pp, personById));

  const descendantsLayout = buildDescendantsLayout(rootId, persons);
  if (!descendantsLayout) return { error: 'Root not found' };

  const nodePositions = descendantsLayout.nodePositions;
  const partnerNodes = buildPartnerOnlyNodes(
    persons,
    descendantsLayout.treeNodes,
    currentPartnerships,
    nodePositions
  );

  return {
    renderMode: 'descendants',
    allNodes: descendantsLayout.treeNodes.concat(partnerNodes.map(p => ({ data: p.person, x: p.x, y: p.y }))),
    nodePositions,
    parentChildEdges: [],
    treeParentChildLinks: descendantsLayout.treeParentChildLinks,
    partnerships
  };
}

function buildAncestorsRenderGraph(data, rootId, depth) {
  const included = new Set();
  collectAncestors(rootId, data, depth, 0, included);
  const ancestorIds = Array.from(included);
  collectChildrenOfAncestors(data, ancestorIds, included, 2);
  includePartnersOfPersons(data, new Set(ancestorIds), included, false);

  const persons = data.persons.filter(p => included.has(p.id));
  const partnerships = (data.partnerships || []).filter(
    pp => included.has(pp.person1Id) && included.has(pp.person2Id)
  );

  const graphLayout = buildAncestorGraphLayout(rootId, persons, partnerships);
  if (!graphLayout) return { error: 'Root not found' };

  const nodePositions = {};
  const allNodes = graphLayout.nodes.map(n => ({ data: n.person, x: n.x, y: n.y }));
  allNodes.forEach(n => { nodePositions[n.data.id] = { x: n.x, y: n.y }; });
  return {
    renderMode: 'ancestors',
    allNodes,
    nodePositions,
    parentChildEdges: graphLayout.parentChildEdges,
    treeParentChildLinks: [],
    partnerships
  };
}

function buildFullFamilyRenderGraph(data, rootId) {
  const persons = (data.persons || []).slice();
  if (!persons.find(p => p.id === rootId)) return { error: 'Root not found' };
  const partnerships = (data.partnerships || []).filter(pp =>
    persons.some(p => p.id === pp.person1Id) && persons.some(p => p.id === pp.person2Id)
  );

  const graphLayout = buildFullFamilyGraphLayout(rootId, persons, partnerships);
  if (!graphLayout) return { error: 'Unable to build Full Family layout' };

  const nodePositions = {};
  const allNodes = graphLayout.nodes.map(n => ({ data: n.person, x: n.x, y: n.y }));
  allNodes.forEach(n => { nodePositions[n.data.id] = { x: n.x, y: n.y }; });

  return {
    renderMode: 'full-family',
    allNodes,
    nodePositions,
    parentChildEdges: graphLayout.parentChildEdges,
    treeParentChildLinks: [],
    partnerships
  };
}

function buildDescendantsLayout(rootId, persons) {
  const nodeMap = {};
  persons.forEach(p => { nodeMap[p.id] = { ...p, children: [] }; });

  persons.forEach(p => {
    (p.parents || []).forEach(pRef => {
      if (nodeMap[pRef.personId] && pRef.personId !== p.id) {
        nodeMap[pRef.personId].children.push(nodeMap[p.id]);
      }
    });
  });

  const rootNode = nodeMap[rootId];
  if (!rootNode) return null;

  const seen = new Set();
  function dedupe(node) {
    if (seen.has(node.id)) return null;
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
  const treeNodes = root.descendants();
  const nodePositions = {};
  treeNodes.forEach(n => { nodePositions[n.data.id] = { x: n.x, y: n.y }; });

  return { treeNodes, treeParentChildLinks: root.links(), nodePositions };
}

function drawRenderGraph(graph) {
  // Stop any running force simulation before clearing the canvas
  if (_forceSimulation) {
    _forceSimulation.stop();
    _forceSimulation = null;
  }

  if (graph.renderMode === 'force') {
    drawForceGraph(graph);
    return;
  }

  const {
    renderMode,
    allNodes,
    nodePositions,
    parentChildEdges,
    treeParentChildLinks,
    partnerships
  } = graph;

  const g = _svg.select('#tree-g');
  g.selectAll('*').remove();

  const svgEl = document.getElementById('tree-svg');
  const W = svgEl.clientWidth || 800;
  const H = svgEl.clientHeight || 600;

  if (renderMode === 'ancestors' || renderMode === 'full-family') {
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
      .data(treeParentChildLinks)
      .join('path')
      .attr('class', d => {
        const rel = getParentChildRelation(d.source.data, d.target.data);
        const type = rel ? rel.type : 'parent-child';
        return `link ${type === 'adopted' ? 'adopted' : 'parent-child'}`;
      })
      .attr('d', linkGen);
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

  nodeGroups.append('circle')
    .attr('r', NODE_R);

  const defs = _svg.append('defs');
  allNodes.forEach((n, i) => {
    defs.append('clipPath')
      .attr('id', `clip-${i}`)
      .append('circle')
      .attr('r', NODE_R);
  });

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

  nodeGroups.append('text')
    .attr('y', NODE_R + 16)
    .attr('text-anchor', 'middle')
    .text(d => truncate(d.data.name || '—', 20));

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

  const bounds = g.node().getBBox();
  const scale = Math.min(0.9 * W / bounds.width, 0.9 * H / bounds.height, 1.5);
  const tx = W / 2 - scale * (bounds.x + bounds.width / 2);
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

  const levels = buildAncestorLevels(rootId, persons, partnerships, parentChildEdges);

  const levelSet = new Set();
  for (const personId in levels) {
    levelSet.add(levels[personId]);
  }
  const levelValues = Array.from(levelSet).sort((a, b) => a - b);
  const positionsById = {};
  const levelPersonIds = {};
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

    levelPersonIds[level] = levelPersons.map(p => p.id);
    const startX = -((levelPersons.length - 1) * H_SEP) / 2;
    levelPersons.forEach((person, idx) => {
      positionsById[person.id] = { x: startX + idx * H_SEP, y: level * V_SEP };
    });
  });

  optimizeAncestorHorizontalPositions(
    positionsById,
    levelPersonIds,
    parentsByChildId,
    childrenByParentId,
    partnerships,
    levels
  );

  const nodes = persons.map(person => ({
    person,
    x: positionsById[person.id].x,
    y: positionsById[person.id].y
  }));

  return { nodes, parentChildEdges };
}

function buildFullFamilyGraphLayout(rootId, persons, partnerships) {
  const personById = {};
  persons.forEach(p => { personById[p.id] = p; });
  if (!personById[rootId]) return null;

  const parentChildEdges = getIncludedParentChildEdges(persons);
  const levels = buildFullFamilyLevels(rootId, persons, parentChildEdges, partnerships);

  const parentsByChildId = {};
  const childrenByParentId = {};
  persons.forEach(p => {
    parentsByChildId[p.id] = [];
    childrenByParentId[p.id] = [];
  });
  parentChildEdges.forEach(edge => {
    parentsByChildId[edge.childId].push(edge.parentId);
    childrenByParentId[edge.parentId].push(edge.childId);
  });

  const levelSet = new Set();
  Object.keys(levels).forEach(id => levelSet.add(levels[id]));
  const levelValues = Array.from(levelSet).sort((a, b) => a - b);

  const positionsById = {};
  const levelPersonIds = {};
  levelValues.forEach(level => {
    const levelIds = persons
      .filter(p => levels[p.id] === level)
      .slice()
      .sort((a, b) => {
        const ax = getAnchorX(a.id, positionsById, parentsByChildId, partnerships);
        const bx = getAnchorX(b.id, positionsById, parentsByChildId, partnerships);
        if (ax !== bx) return ax - bx;
        return (a.name || '').localeCompare(b.name || '');
      })
      .map(p => p.id);
    levelPersonIds[level] = levelIds;
    const startX = -((levelIds.length - 1) * H_SEP) / 2;
    levelIds.forEach((personId, idx) => {
      positionsById[personId] = { x: startX + idx * H_SEP, y: levels[personId] * V_SEP };
    });
  });

  optimizeFullFamilyHorizontalPositions(
    positionsById,
    levelPersonIds,
    parentsByChildId,
    childrenByParentId,
    partnerships,
    levels
  );

  const nodes = persons.map(person => ({
    person,
    x: positionsById[person.id].x,
    y: positionsById[person.id].y
  }));
  return { nodes, parentChildEdges };
}

function buildFullFamilyLevels(rootId, persons, parentChildEdges, partnerships) {
  const personById = {};
  persons.forEach(p => { personById[p.id] = p; });
  const adjacency = {};
  persons.forEach(p => { adjacency[p.id] = []; });
  parentChildEdges.forEach(edge => {
    adjacency[edge.parentId].push({ id: edge.childId, delta: 1 });
    adjacency[edge.childId].push({ id: edge.parentId, delta: -1 });
  });
  (partnerships || []).forEach(pp => {
    if (!personById[pp.person1Id] || !personById[pp.person2Id]) return;
    if (pp.person1Id === pp.person2Id) return;
    adjacency[pp.person1Id].push({ id: pp.person2Id, delta: 0 });
    adjacency[pp.person2Id].push({ id: pp.person1Id, delta: 0 });
  });

  const levels = {};
  const queue = [];
  const visited = new Set();

  function seedLevel(personId, level) {
    if (!personById[personId] || visited.has(personId)) return;
    visited.add(personId);
    levels[personId] = level;
    queue.push(personId);
    while (queue.length > 0) {
      const currentId = queue.shift();
      const currentLevel = levels[currentId];
      (adjacency[currentId] || []).forEach(next => {
        const expected = currentLevel + next.delta;
        if (levels[next.id] === undefined) {
          levels[next.id] = expected;
          queue.push(next.id);
          visited.add(next.id);
          return;
        }
        if (levels[next.id] !== expected) {
          // Keep strict parent→child (+1) generation direction stable by only moving along edge direction:
          // parents can pull children downward on screen (higher generation index, i.e. larger y = level * V_SEP), children can pull parents upward.
          if (next.delta === 0) levels[next.id] = expected;
          if (next.delta > 0 && levels[next.id] < expected) levels[next.id] = expected;
          if (next.delta < 0 && levels[next.id] > expected) levels[next.id] = expected;
        }
      });
    }
  }

  seedLevel(rootId, 0);

  persons
    .filter(p => (p.parents || []).filter(pr => personById[pr.personId]).length === 0)
    .forEach(p => seedLevel(p.id, 0));

  persons.forEach(p => seedLevel(p.id, 0));

  // Bounded relaxation pass: empirically converges on realistic family data while preventing runaway loops.
  for (let i = 0; i < persons.length * FULL_FAMILY_RELAXATION_ITERATION_MULTIPLIER; i++) {
    let changed = false;
    parentChildEdges.forEach(edge => {
      const expectedChildLevel = levels[edge.parentId] + 1;
      if (levels[edge.childId] !== expectedChildLevel) {
        levels[edge.childId] = expectedChildLevel;
        changed = true;
      }
    });
    (partnerships || []).forEach(pp => {
      if (levels[pp.person1Id] === undefined || levels[pp.person2Id] === undefined) return;
      const targetLevel = Math.round((levels[pp.person1Id] + levels[pp.person2Id]) / 2);
      if (levels[pp.person1Id] !== targetLevel) {
        levels[pp.person1Id] = targetLevel;
        changed = true;
      }
      if (levels[pp.person2Id] !== targetLevel) {
        levels[pp.person2Id] = targetLevel;
        changed = true;
      }
    });
    if (!changed) break;
  }

  const minLevel = Math.min(...Object.values(levels));
  Object.keys(levels).forEach(id => {
    levels[id] -= minLevel;
  });
  return levels;
}

function optimizeFullFamilyHorizontalPositions(
  positionsById,
  levelPersonIds,
  parentsByChildId,
  childrenByParentId,
  partnerships,
  levels
) {
  const personIds = Object.keys(positionsById);
  const minGap = H_SEP * FULL_FAMILY_MIN_GAP_FACTOR;
  const sameLevelPartnerships = (partnerships || []).filter(pp =>
    levels[pp.person1Id] !== undefined && levels[pp.person1Id] === levels[pp.person2Id]
  );
  const targetPartnerGap = H_SEP * FULL_FAMILY_TARGET_PARTNER_GAP_FACTOR;

  for (let iteration = 0; iteration < FULL_FAMILY_OPTIMIZATION_ITERATIONS; iteration++) {
    const proposed = {};
    personIds.forEach(id => { proposed[id] = positionsById[id].x; });

    sameLevelPartnerships.forEach(pp => {
      const x1 = proposed[pp.person1Id];
      const x2 = proposed[pp.person2Id];
      if (x1 === undefined || x2 === undefined) return;
      const midpoint = (x1 + x2) / 2;
      const leftId = x1 <= x2 ? pp.person1Id : pp.person2Id;
      const rightId = leftId === pp.person1Id ? pp.person2Id : pp.person1Id;
      proposed[leftId] = x1 + (midpoint - targetPartnerGap / 2 - x1) * FULL_FAMILY_PARTNER_PULL;
      proposed[rightId] = x2 + (midpoint + targetPartnerGap / 2 - x2) * FULL_FAMILY_PARTNER_PULL;
    });

    personIds.forEach(id => {
      const current = proposed[id];
      const parentIds = (parentsByChildId[id] || []).filter(parentId => proposed[parentId] !== undefined);
      if (parentIds.length > 0) {
        const parentMidpoint = parentIds.reduce((sum, parentId) => sum + proposed[parentId], 0) / parentIds.length;
        proposed[id] = current + (parentMidpoint - current) * FULL_FAMILY_PARENT_PULL;
      } else {
        const childIds = (childrenByParentId[id] || []).filter(childId => proposed[childId] !== undefined);
        if (childIds.length > 0) {
          const childMidpoint = childIds.reduce((sum, childId) => sum + proposed[childId], 0) / childIds.length;
          proposed[id] = current + (childMidpoint - current) * FULL_FAMILY_CHILD_PULL;
        }
      }
    });

    Object.keys(levelPersonIds).forEach(level => {
      resolveLevelOverlaps(levelPersonIds[level], proposed, positionsById, minGap);
    });
  }
}

function buildAncestorLevels(rootId, persons, partnerships, parentChildEdges) {
  const personById = {};
  persons.forEach(p => { personById[p.id] = p; });
  const personIdSet = new Set(persons.map(p => p.id));

  const neighbors = {};
  persons.forEach(p => { neighbors[p.id] = []; });
  parentChildEdges.forEach(edge => {
    if (!personIdSet.has(edge.parentId) || !personIdSet.has(edge.childId)) return;
    neighbors[edge.parentId].push({ id: edge.childId, delta: 1 });
    neighbors[edge.childId].push({ id: edge.parentId, delta: -1 });
  });

  const levels = {};
  if (personById[rootId]) levels[rootId] = 0;

  const queue = personById[rootId] ? [rootId] : [];
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const currentId = queue[queueIndex++];
    const currentLevel = levels[currentId];
    (neighbors[currentId] || []).forEach(edge => {
      if (levels[edge.id] !== undefined) return;
      levels[edge.id] = currentLevel + edge.delta;
      queue.push(edge.id);
    });
  }

  const partnerIdsByPerson = {};
  persons.forEach(p => { partnerIdsByPerson[p.id] = []; });
  (partnerships || []).forEach(pp => {
    if (!personIdSet.has(pp.person1Id) || !personIdSet.has(pp.person2Id)) return;
    partnerIdsByPerson[pp.person1Id].push(pp.person2Id);
    partnerIdsByPerson[pp.person2Id].push(pp.person1Id);
  });

  const partnerQueue = Object.keys(levels);
  let partnerQueueIndex = 0;
  while (partnerQueueIndex < partnerQueue.length) {
    const id = partnerQueue[partnerQueueIndex++];
    const level = levels[id];
    (partnerIdsByPerson[id] || []).forEach(partnerId => {
      if (levels[partnerId] !== undefined) return;
      levels[partnerId] = level;
      partnerQueue.push(partnerId);
    });
  }

  persons.forEach(p => {
    if (levels[p.id] === undefined) levels[p.id] = 0;
  });

  const rootLevel = levels[rootId] !== undefined ? levels[rootId] : 0;
  persons.forEach(p => {
    levels[p.id] -= rootLevel;
  });

  return levels;
}

function optimizeAncestorHorizontalPositions(
  positionsById,
  levelPersonIds,
  parentsByChildId,
  childrenByParentId,
  partnerships,
  levels
) {
  const personIds = Object.keys(positionsById);
  const minGap = H_SEP * ANCESTOR_MIN_GAP_FACTOR;
  const sameLevelPartnerships = (partnerships || []).filter(pp =>
    levels[pp.person1Id] !== undefined &&
    levels[pp.person1Id] === levels[pp.person2Id]
  );

  for (let iteration = 0; iteration < ANCESTOR_OPTIMIZATION_ITERATIONS; iteration++) {
    const proposed = {};
    personIds.forEach(id => { proposed[id] = positionsById[id].x; });

    personIds.forEach(id => {
      const current = proposed[id];
      const parentIds = (parentsByChildId[id] || []).filter(parentId => proposed[parentId] !== undefined);
      if (parentIds.length > 0) {
        const parentMid = parentIds.reduce((sum, parentId) => sum + proposed[parentId], 0) / parentIds.length;
        proposed[id] = current + (parentMid - current) * PARENT_MIDPOINT_PULL;
      } else {
        const childIds = (childrenByParentId[id] || []).filter(childId => proposed[childId] !== undefined);
        if (childIds.length > 0) {
          const childMid = childIds.reduce((sum, childId) => sum + proposed[childId], 0) / childIds.length;
          proposed[id] = current + (childMid - current) * CHILD_MIDPOINT_PULL;
        }
      }
    });

    sameLevelPartnerships.forEach(pp => {
      const id1 = pp.person1Id;
      const id2 = pp.person2Id;
      if (proposed[id1] === undefined || proposed[id2] === undefined) return;
      let leftId = id1;
      let rightId = id2;
      if (proposed[id1] > proposed[id2]) {
        leftId = id2;
        rightId = id1;
      }
      const gap = proposed[rightId] - proposed[leftId];
      const error = gap - H_SEP;
      proposed[leftId] += error * PARTNER_GAP_CORRECTION;
      proposed[rightId] -= error * PARTNER_GAP_CORRECTION;
    });

    Object.keys(levelPersonIds).forEach(level => {
      resolveLevelOverlaps(levelPersonIds[level], proposed, positionsById, minGap);
    });
  }

  for (let alignmentPass = 0; alignmentPass < ANCESTOR_FINAL_ALIGNMENT_PASSES; alignmentPass++) {
    personIds.forEach(id => {
      const parentIds = (parentsByChildId[id] || []).filter(parentId => positionsById[parentId]);
      if (parentIds.length === 0) return;
      const midpoint = parentIds.reduce((sum, parentId) => sum + positionsById[parentId].x, 0) / parentIds.length;
      positionsById[id].x = midpoint;
    });
    Object.keys(levelPersonIds).forEach(level => {
      const proposed = {};
      levelPersonIds[level].forEach(id => { proposed[id] = positionsById[id].x; });
      resolveLevelOverlaps(levelPersonIds[level], proposed, positionsById, minGap);
    });
  }
}

function resolveLevelOverlaps(levelIds, proposed, positionsById, minGap) {
  const ordered = (levelIds || [])
    .filter(id => proposed[id] !== undefined)
    .slice()
    .sort((a, b) => {
      if (proposed[a] !== proposed[b]) return proposed[a] - proposed[b];
      return a.localeCompare(b);
    });
  if (ordered.length === 0) return;

  const adjusted = {};
  adjusted[ordered[0]] = proposed[ordered[0]];
  for (let i = 1; i < ordered.length; i++) {
    const id = ordered[i];
    const prevId = ordered[i - 1];
    adjusted[id] = Math.max(proposed[id], adjusted[prevId] + minGap);
  }

  const meanAdjusted = ordered.reduce((sum, id) => sum + adjusted[id], 0) / ordered.length;
  const meanProposed = ordered.reduce((sum, id) => sum + proposed[id], 0) / ordered.length;
  const shift = meanProposed - meanAdjusted;

  ordered.forEach(id => {
    positionsById[id].x = adjusted[id] + shift;
  });
}

function getAnchorX(personId, positionsById, parentsByChildId, partnerships) {
  const anchors = [];
  (parentsByChildId[personId] || []).forEach(parentId => {
    const parentPos = positionsById[parentId];
    if (parentPos) anchors.push(parentPos.x);
  });
  (partnerships || []).forEach(pp => {
    const partnerId = getPartnerId(pp, personId);
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

function getPartnerId(partnership, personId) {
  if (!partnership || !personId) return null;
  if (partnership.person1Id === personId) return partnership.person2Id;
  if (partnership.person2Id === personId) return partnership.person1Id;
  return null;
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

function buildForceRenderGraph(data) {
  const persons = (data.persons || []).slice();
  const partnerships = (data.partnerships || []).filter(pp =>
    persons.some(p => p.id === pp.person1Id) && persons.some(p => p.id === pp.person2Id)
  );

  // Build nodes
  const nodes = persons.map(p => ({ id: p.id, data: p }));

  // Partnership links get high strength
  const partnershipLinks = partnerships.map(pp => ({
    source: pp.person1Id,
    target: pp.person2Id,
    linkClass: pp.type,
    strength: 0.9
  }));

  // Parent-child links get lower strength
  const parentChildLinks = [];
  persons.forEach(child => {
    (child.parents || []).forEach(parentRef => {
      if (persons.some(p => p.id === parentRef.personId) && parentRef.personId !== child.id) {
        parentChildLinks.push({
          source: parentRef.personId,
          target: child.id,
          linkClass: parentRef.type === 'adopted' ? 'adopted' : 'parent-child',
          strength: 0.3
        });
      }
    });
  });

  return {
    renderMode: 'force',
    nodes,
    links: partnershipLinks.concat(parentChildLinks)
  };
}

function drawForceGraph(graph) {
  const { nodes, links } = graph;

  const g = _svg.select('#tree-g');
  g.selectAll('*').remove();

  const svgEl = document.getElementById('tree-svg');
  const W = svgEl.clientWidth || 800;
  const H = svgEl.clientHeight || 600;

  // Clone node objects so D3's simulation can mutate x/y without changing originals
  const simNodes = nodes.map(n => ({ ...n }));
  const nodeById = {};
  simNodes.forEach(n => { nodeById[n.id] = n; });

  const simLinks = links.map(l => ({ ...l }));

  // Draw links first (below nodes)
  const linkEls = g.selectAll('.link')
    .data(simLinks)
    .join('line')
    .attr('class', d => `link ${d.linkClass}`);

  // Node groups
  const nodeGroups = g.selectAll('.node')
    .data(simNodes)
    .join('g')
    .attr('class', d => `node ${d.data.deathDate ? 'deceased' : 'living'}`)
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      event.stopPropagation();
      showPersonDetail(d.data.id);
    })
    .call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) _forceSimulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) _forceSimulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      })
    );

  nodeGroups.append('circle').attr('r', NODE_R);

  // Clip paths for photos
  const defs = _svg.append('defs');
  simNodes.forEach((n, i) => {
    defs.append('clipPath')
      .attr('id', `force-clip-${i}`)
      .append('circle')
      .attr('r', NODE_R);
  });

  simNodes.forEach((n, i) => {
    const safeUrl = sanitizeImageUrl(n.data.image);
    if (safeUrl) {
      nodeGroups.filter((d, j) => j === i)
        .append('image')
        .attr('href', safeUrl)
        .attr('x', -NODE_R).attr('y', -NODE_R)
        .attr('width', NODE_R * 2).attr('height', NODE_R * 2)
        .attr('clip-path', `url(#force-clip-${i})`);
    }
  });

  nodeGroups.append('text')
    .attr('y', NODE_R + 16)
    .attr('text-anchor', 'middle')
    .text(d => truncate(d.data.name || '—', 20));

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

  // Build force simulation with per-link strength
  _forceSimulation = d3.forceSimulation(simNodes)
    .force('link', d3.forceLink(simLinks)
      .id(d => d.id)
      .strength(d => d.strength)
      .distance(H_SEP * 1.1))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collide', d3.forceCollide(NODE_R + 10))
    .on('tick', () => {
      linkEls
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      nodeGroups
        .attr('transform', d => `translate(${d.x},${d.y})`);
    });
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
