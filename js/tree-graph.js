window.treeGraph = (() => {
  const NODE_R = 36;
  const NODE_CLEARANCE = 8;
  const H_SEP = NODE_R * 2 + NODE_CLEARANCE + 20;
  const V_SEP = 160;
  const PARTNER_ROW_PROXIMITY = 12;
  const MIN_PARTNER_DISTANCE_FACTOR = 0.8;
  const MAX_PARTNER_PLACEMENT_STEPS = 6;
  const ANCESTOR_MIN_GAP_FACTOR = 1;
  const ANCESTOR_OPTIMIZATION_ITERATIONS = 60;
  const ANCESTOR_FINAL_ALIGNMENT_PASSES = 3;
  const PARENT_MIDPOINT_PULL = 0.55;
  const CHILD_MIDPOINT_PULL = 0.2;
  const PARTNER_GAP_CORRECTION = 0.25;
  const FORCE_SIBLING_BOND_STRENGTH = 0.3;

  function buildRenderGraph(data, rootId, depth, renderMode) {
    if (renderMode === 'ancestors') {
      return buildAncestorsRenderGraph(data, rootId, depth);
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

    const persons = (data.persons || []).filter(person => included.has(person.id));
    const personById = buildPersonMap(persons);
    const partnerships = (data.partnerships || []).filter(pp =>
      included.has(pp.person1Id) && included.has(pp.person2Id)
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
      allNodes: descendantsLayout.treeNodes.concat(
        partnerNodes.map(node => ({ data: node.person, x: node.x, y: node.y }))
      ),
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

    const persons = (data.persons || []).filter(person => included.has(person.id));
    const partnerships = (data.partnerships || []).filter(pp =>
      included.has(pp.person1Id) && included.has(pp.person2Id)
    );

    const graphLayout = buildAncestorGraphLayout(rootId, persons, partnerships);
    if (!graphLayout) return { error: 'Root not found' };

    const nodePositions = {};
    const allNodes = graphLayout.nodes.map(node => ({ data: node.person, x: node.x, y: node.y }));
    allNodes.forEach(node => {
      nodePositions[node.data.id] = { x: node.x, y: node.y };
    });

    return {
      renderMode: 'ancestors',
      allNodes,
      nodePositions,
      parentChildEdges: graphLayout.parentChildEdges,
      treeParentChildLinks: [],
      partnerships
    };
  }

  function buildDescendantsLayout(rootId, persons) {
    const nodeMap = {};
    persons.forEach(person => {
      nodeMap[person.id] = { ...person, children: [] };
    });

    persons.forEach(person => {
      (person.parents || []).forEach(parentRef => {
        if (nodeMap[parentRef.personId] && parentRef.personId !== person.id) {
          nodeMap[parentRef.personId].children.push(nodeMap[person.id]);
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
    treeNodes.forEach(node => {
      nodePositions[node.data.id] = { x: node.x, y: node.y };
    });

    return {
      treeNodes,
      treeParentChildLinks: root.links(),
      nodePositions
    };
  }

  function collectDescendants(personId, data, maxDepth, currentDepth, included) {
    if (currentDepth > maxDepth || included.has(personId)) return;
    included.add(personId);

    const children = (data.persons || []).filter(person =>
      (person.parents || []).some(parentRef => parentRef.personId === personId)
    );
    children.forEach(child => {
      collectDescendants(child.id, data, maxDepth, currentDepth + 1, included);
    });
  }

  function collectAncestors(personId, data, maxDepth, currentDepth, included) {
    if (currentDepth > maxDepth || included.has(personId)) return;
    included.add(personId);

    const person = (data.persons || []).find(entry => entry.id === personId);
    if (!person) return;

    (person.parents || []).forEach(parentRef => {
      collectAncestors(parentRef.personId, data, maxDepth, currentDepth + 1, included);
    });
  }

  function collectChildrenOfAncestors(data, ancestorIds, included, maxDescDepth) {
    ancestorIds.forEach(ancestorId => {
      collectDescendantsFromAncestor(ancestorId, data, maxDescDepth, 0, included);
    });
  }

  function collectDescendantsFromAncestor(personId, data, maxDepth, currentDepth, included) {
    if (currentDepth >= maxDepth) return;

    const children = (data.persons || []).filter(person =>
      (person.parents || []).some(parentRef => parentRef.personId === personId)
    );
    children.forEach(child => {
      included.add(child.id);
      collectDescendantsFromAncestor(child.id, data, maxDepth, currentDepth + 1, included);
    });
  }

  function includeCurrentPartners(data, included) {
    const partnerships = data.partnerships || [];
    const personById = buildPersonMap(data.persons || []);

    let changed = true;
    while (changed) {
      changed = false;
      partnerships.forEach(partnership => {
        if (!isCurrentPartnership(partnership, personById)) return;

        const hasPerson1 = included.has(partnership.person1Id);
        const hasPerson2 = included.has(partnership.person2Id);
        if (hasPerson1 && !hasPerson2) {
          included.add(partnership.person2Id);
          changed = true;
        } else if (hasPerson2 && !hasPerson1) {
          included.add(partnership.person1Id);
          changed = true;
        }
      });
    }
  }

  function includePartnersOfPersons(data, sourceIds, included, currentPartnershipsOnly) {
    const partnerships = data.partnerships || [];
    const personById = buildPersonMap(data.persons || []);

    partnerships.forEach(partnership => {
      if (currentPartnershipsOnly && !isCurrentPartnership(partnership, personById)) return;
      if (sourceIds.has(partnership.person1Id)) included.add(partnership.person2Id);
      if (sourceIds.has(partnership.person2Id)) included.add(partnership.person1Id);
    });
  }

  function isCurrentPartnership(partnership, personById) {
    if (!partnership || partnership.type === 'divorced' || partnership.endDate) return false;

    const person1 = personById[partnership.person1Id];
    const person2 = personById[partnership.person2Id];
    if (!person1 || !person2) return false;
    if (isAssumedDeceased(person1) || isAssumedDeceased(person2)) return false;
    return true;
  }

  function buildAncestorGraphLayout(rootId, persons, partnerships) {
    const personById = buildPersonMap(persons);
    if (!personById[rootId]) return null;

    const parentChildEdges = getIncludedParentChildEdges(persons);
    const childrenByParentId = {};
    const parentsByChildId = {};
    persons.forEach(person => {
      childrenByParentId[person.id] = [];
      parentsByChildId[person.id] = [];
    });
    parentChildEdges.forEach(edge => {
      childrenByParentId[edge.parentId].push(edge.childId);
      parentsByChildId[edge.childId].push(edge.parentId);
    });

    const levels = buildAncestorLevels(rootId, persons, partnerships, parentChildEdges);
    const levelValues = Array.from(new Set(Object.values(levels))).sort((a, b) => a - b);
    const positionsById = {};
    const levelPersonIds = {};

    levelValues.forEach(level => {
      const levelPersons = persons
        .filter(person => levels[person.id] === level)
        .slice()
        .sort((left, right) => {
          const leftAnchor = getAnchorX(left.id, positionsById, parentsByChildId, partnerships);
          const rightAnchor = getAnchorX(right.id, positionsById, parentsByChildId, partnerships);
          if (leftAnchor !== rightAnchor) return leftAnchor - rightAnchor;
          return (left.name || '').localeCompare(right.name || '');
        });

      levelPersonIds[level] = levelPersons.map(person => person.id);
      const startX = -((levelPersons.length - 1) * H_SEP) / 2;
      levelPersons.forEach((person, index) => {
        positionsById[person.id] = { x: startX + index * H_SEP, y: level * V_SEP };
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

    return {
      nodes: persons.map(person => ({
        person,
        x: positionsById[person.id].x,
        y: positionsById[person.id].y
      })),
      parentChildEdges
    };
  }

  function buildAncestorLevels(rootId, persons, partnerships, parentChildEdges) {
    const personById = buildPersonMap(persons);
    const personIdSet = new Set(persons.map(person => person.id));
    const neighbors = {};
    persons.forEach(person => {
      neighbors[person.id] = [];
    });

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
    persons.forEach(person => {
      partnerIdsByPerson[person.id] = [];
    });
    (partnerships || []).forEach(partnership => {
      if (!personIdSet.has(partnership.person1Id) || !personIdSet.has(partnership.person2Id)) return;
      partnerIdsByPerson[partnership.person1Id].push(partnership.person2Id);
      partnerIdsByPerson[partnership.person2Id].push(partnership.person1Id);
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

    persons.forEach(person => {
      if (levels[person.id] === undefined) levels[person.id] = 0;
    });

    const rootLevel = levels[rootId] !== undefined ? levels[rootId] : 0;
    persons.forEach(person => {
      levels[person.id] -= rootLevel;
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
    const sameLevelPartnerships = (partnerships || []).filter(partnership =>
      levels[partnership.person1Id] !== undefined &&
      levels[partnership.person1Id] === levels[partnership.person2Id]
    );

    for (let iteration = 0; iteration < ANCESTOR_OPTIMIZATION_ITERATIONS; iteration++) {
      const proposed = {};
      personIds.forEach(id => {
        proposed[id] = positionsById[id].x;
      });

      personIds.forEach(id => {
        const current = proposed[id];
        const parentIds = (parentsByChildId[id] || []).filter(parentId => proposed[parentId] !== undefined);
        if (parentIds.length > 0) {
          const parentMidpoint = parentIds.reduce((sum, parentId) => sum + proposed[parentId], 0) / parentIds.length;
          proposed[id] = current + (parentMidpoint - current) * PARENT_MIDPOINT_PULL;
          return;
        }

        const childIds = (childrenByParentId[id] || []).filter(childId => proposed[childId] !== undefined);
        if (childIds.length > 0) {
          const childMidpoint = childIds.reduce((sum, childId) => sum + proposed[childId], 0) / childIds.length;
          proposed[id] = current + (childMidpoint - current) * CHILD_MIDPOINT_PULL;
        }
      });

      sameLevelPartnerships.forEach(partnership => {
        const person1Id = partnership.person1Id;
        const person2Id = partnership.person2Id;
        if (proposed[person1Id] === undefined || proposed[person2Id] === undefined) return;

        let leftId = person1Id;
        let rightId = person2Id;
        if (proposed[person1Id] > proposed[person2Id]) {
          leftId = person2Id;
          rightId = person1Id;
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

    for (let pass = 0; pass < ANCESTOR_FINAL_ALIGNMENT_PASSES; pass++) {
      personIds.forEach(id => {
        const parentIds = (parentsByChildId[id] || []).filter(parentId => positionsById[parentId]);
        if (parentIds.length === 0) return;
        const midpoint = parentIds.reduce((sum, parentId) => sum + positionsById[parentId].x, 0) / parentIds.length;
        positionsById[id].x = midpoint;
      });

      Object.keys(levelPersonIds).forEach(level => {
        const proposed = {};
        levelPersonIds[level].forEach(id => {
          proposed[id] = positionsById[id].x;
        });
        resolveLevelOverlaps(levelPersonIds[level], proposed, positionsById, minGap);
      });
    }
  }

  function resolveLevelOverlaps(levelIds, proposed, positionsById, minGap) {
    const ordered = (levelIds || [])
      .filter(id => proposed[id] !== undefined)
      .slice()
      .sort((left, right) => {
        if (proposed[left] !== proposed[right]) return proposed[left] - proposed[right];
        return left.localeCompare(right);
      });
    if (ordered.length === 0) return;

    const adjusted = {};
    adjusted[ordered[0]] = proposed[ordered[0]];
    for (let index = 1; index < ordered.length; index++) {
      const id = ordered[index];
      const previousId = ordered[index - 1];
      adjusted[id] = Math.max(proposed[id], adjusted[previousId] + minGap);
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
    (partnerships || []).forEach(partnership => {
      const partnerId = getPartnerId(partnership, personId);
      if (!partnerId) return;
      const partnerPos = positionsById[partnerId];
      if (partnerPos) anchors.push(partnerPos.x);
    });
    if (anchors.length === 0) return 0;
    return anchors.reduce((sum, value) => sum + value, 0) / anchors.length;
  }

  function getIncludedParentChildEdges(persons) {
    const personById = buildPersonMap(persons);
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

    const aToB = (personA.parents || []).find(parentRef => parentRef.personId === personB.id);
    if (aToB) return { child: personA, parent: personB, type: aToB.type };

    const bToA = (personB.parents || []).find(parentRef => parentRef.personId === personA.id);
    if (bToA) return { child: personB, parent: personA, type: bToA.type };

    return null;
  }

  function buildPartnerOnlyNodes(persons, treeNodes, currentPartnerships, nodePositions) {
    const treeNodeIds = new Set(treeNodes.map(node => node.data.id));
    const partnerOnlyPersons = persons.filter(person => !treeNodeIds.has(person.id));
    if (partnerOnlyPersons.length === 0) return [];

    const pending = new Set(partnerOnlyPersons.map(person => person.id));
    const personById = buildPersonMap(persons);
    const occupied = Object.values(nodePositions).map(position => ({ x: position.x, y: position.y }));
    const placed = [];

    while (pending.size > 0) {
      let progressed = false;

      for (const personId of Array.from(pending)) {
        const partnership = currentPartnerships.find(entry =>
          (entry.person1Id === personId && nodePositions[entry.person2Id]) ||
          (entry.person2Id === personId && nodePositions[entry.person1Id])
        );
        if (!partnership) continue;

        const anchorId = partnership.person1Id === personId ? partnership.person2Id : partnership.person1Id;
        const anchorPos = nodePositions[anchorId];
        if (!anchorPos) continue;

        const preferredDir = partnership.person1Id === anchorId ? 1 : -1;
        const position = findPartnerNodePosition(anchorPos, preferredDir, occupied);
        nodePositions[personId] = position;
        occupied.push(position);
        placed.push({ person: personById[personId], x: position.x, y: position.y });
        pending.delete(personId);
        progressed = true;
      }

      if (!progressed) break;
    }

    let fallbackOffset = 1;
    pending.forEach(personId => {
      const position = { x: fallbackOffset * H_SEP, y: V_SEP };
      fallbackOffset += 1;
      nodePositions[personId] = position;
      placed.push({ person: personById[personId], x: position.x, y: position.y });
    });

    return placed;
  }

  function findPartnerNodePosition(anchorPos, preferredDir, occupied) {
    const minDistance = H_SEP * MIN_PARTNER_DISTANCE_FACTOR;
    const isOccupied = (x, y) => occupied.some(position =>
      Math.abs(position.y - y) < PARTNER_ROW_PROXIMITY && Math.abs(position.x - x) < minDistance
    );

    for (let step = 1; step <= MAX_PARTNER_PLACEMENT_STEPS; step++) {
      const firstDir = preferredDir ?? 1;
      const directions = step === 1 ? [firstDir] : [firstDir, -firstDir];
      for (const direction of directions) {
        const x = anchorPos.x + direction * H_SEP * step;
        const y = anchorPos.y;
        if (!isOccupied(x, y)) return { x, y };
      }
    }

    return { x: anchorPos.x + (preferredDir ?? 1) * H_SEP, y: anchorPos.y };
  }

  function buildForceRenderGraph(data) {
    const persons = (data.persons || []).slice();
    const personIdSet = new Set(persons.map(person => person.id));
    const partnerships = (data.partnerships || []).filter(partnership =>
      personIdSet.has(partnership.person1Id) && personIdSet.has(partnership.person2Id)
    );

    const partnershipLinks = partnerships.map(partnership => ({
      source: partnership.person1Id,
      target: partnership.person2Id,
      linkClass: partnership.type,
      strength: 0.9
    }));

    const parentChildLinks = [];
    persons.forEach(child => {
      (child.parents || []).forEach(parentRef => {
        if (!personIdSet.has(parentRef.personId) || parentRef.personId === child.id) return;
        parentChildLinks.push({
          source: parentRef.personId,
          target: child.id,
          linkClass: parentRef.type === 'adopted' ? 'adopted' : 'parent-child',
          strength: 0.6
        });
      });
    });

    const siblingBondLinks = buildSiblingBondLinks(persons, personIdSet);

    return {
      renderMode: 'force',
      nodes: persons.map(person => ({ id: person.id, data: person })),
      links: partnershipLinks.concat(parentChildLinks, siblingBondLinks)
    };
  }

  function buildSiblingBondLinks(persons, personIdSet) {
    const childIdsByParentId = new Map();
    persons.forEach(person => {
      getRenderableParentIdSet(person, personIdSet).forEach(parentId => {
        if (!childIdsByParentId.has(parentId)) childIdsByParentId.set(parentId, []);
        childIdsByParentId.get(parentId).push(person.id);
      });
    });

    const sharedParentCounts = new Map();
    childIdsByParentId.forEach(childIds => {
      for (let i = 0; i < childIds.length; i++) {
        for (let j = i + 1; j < childIds.length; j++) {
          const pairKey = buildPersonPairKey(childIds[i], childIds[j]);
          sharedParentCounts.set(pairKey, (sharedParentCounts.get(pairKey) || 0) + 1);
        }
      }
    });

    return Array.from(sharedParentCounts.entries(), ([pairKey, commonParentCount]) => {
      const [source, target] = pairKey.split('\u0000');
      return {
        source,
        target,
        linkClass: 'sibling-bond',
        strength: FORCE_SIBLING_BOND_STRENGTH * (1 + 0.2 * (commonParentCount - 1))
      };
    });
  }

  function getRenderableParentIdSet(person, personIdSet) {
    return new Set(
      (person.parents || [])
        .map(parentRef => parentRef.personId)
        .filter(parentId => personIdSet.has(parentId) && parentId !== person.id)
    );
  }

  function buildPersonPairKey(personIdA, personIdB) {
    return personIdA < personIdB
      ? `${personIdA}\u0000${personIdB}`
      : `${personIdB}\u0000${personIdA}`;
  }

  function buildPersonMap(persons) {
    const map = {};
    (persons || []).forEach(person => {
      map[person.id] = person;
    });
    return map;
  }

  return {
    NODE_R,
    H_SEP,
    V_SEP,
    buildRenderGraph,
    getParentChildRelation
  };
})();
