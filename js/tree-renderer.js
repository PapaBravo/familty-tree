window.treeRenderer = (() => {
  const { NODE_R, H_SEP } = window.treeGraph;

  let _treeZoom = null;
  let _svg = null;
  let _forceSimulation = null;

  function init() {
    if (_svg) return;

    _svg = d3.select('#tree-svg');
    _treeZoom = d3.zoom().scaleExtent([0.15, 3]).on('zoom', event => {
      _svg.select('#tree-g').attr('transform', event.transform);
    });
    _svg.call(_treeZoom);
    _svg.append('g').attr('id', 'tree-g');
  }

  function draw(graph) {
    stopForceSimulation();

    if (graph.renderMode === 'force') {
      drawForceGraph(graph);
      return;
    }

    drawStructuredGraph(graph);
  }

  function clear(message) {
    stopForceSimulation();
    const group = _svg ? _svg.select('#tree-g') : null;
    if (group) group.selectAll('*').remove();
    if (!message || !group) return;

    const svgEl = document.getElementById('tree-svg');
    const width = svgEl ? svgEl.clientWidth || 800 : 800;
    const height = svgEl ? svgEl.clientHeight || 600 : 600;
    group.append('text')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--text-muted)')
      .text(message);
  }

  function drawStructuredGraph(graph) {
    const group = _svg.select('#tree-g');
    group.selectAll('*').remove();

    drawParentChildLinks(group, graph);
    drawPartnershipLinks(group, graph.partnerships, graph.nodePositions);
    drawNodes(group, graph.allNodes, 'tree-clip-');
    fitGraphToViewport(group);
  }

  function drawParentChildLinks(group, graph) {
    if (graph.renderMode === 'ancestors') {
      group.selectAll('.link.parent-child')
        .data(graph.parentChildEdges)
        .join('path')
        .attr('class', edge => `link ${edge.type === 'adopted' ? 'adopted' : 'parent-child'}`)
        .attr('d', edge => {
          const source = graph.nodePositions[edge.parentId];
          const target = graph.nodePositions[edge.childId];
          if (!source || !target) return '';
          return `M${source.x},${source.y} L${target.x},${target.y}`;
        });
      return;
    }

    const linkGenerator = d3.linkVertical().x(point => point.x).y(point => point.y);
    group.selectAll('.link.parent-child')
      .data(graph.treeParentChildLinks)
      .join('path')
      .attr('class', link => {
        const relation = window.treeGraph.getParentChildRelation(link.source.data, link.target.data);
        const linkType = relation ? relation.type : 'parent-child';
        return `link ${linkType === 'adopted' ? 'adopted' : 'parent-child'}`;
      })
      .attr('d', linkGenerator);
  }

  function drawPartnershipLinks(group, partnerships, nodePositions) {
    partnerships.forEach(partnership => {
      const person1Pos = nodePositions[partnership.person1Id];
      const person2Pos = nodePositions[partnership.person2Id];
      if (!person1Pos || !person2Pos) return;

      const midpointX = (person1Pos.x + person2Pos.x) / 2;
      const midpointY = (person1Pos.y + person2Pos.y) / 2;
      group.append('path')
        .attr('class', `link ${partnership.type}`)
        .attr('d', `M${person1Pos.x},${person1Pos.y} Q${midpointX},${midpointY - 30} ${person2Pos.x},${person2Pos.y}`);
    });
  }

  function drawNodes(group, nodes, clipPrefix) {
    const clipIds = createClipPaths(nodes, clipPrefix);
    const nodeGroups = group.selectAll('.node')
      .data(nodes)
      .join('g')
      .attr('class', node => `node ${isAssumedDeceased(node.data) ? 'deceased' : 'living'}`)
      .attr('transform', node => `translate(${node.x},${node.y})`)
      .style('cursor', 'pointer')
      .on('click', (event, node) => {
        event.stopPropagation();
        showPersonDetail(node.data.id);
      });

    nodeGroups.append('circle').attr('r', NODE_R);

    nodeGroups.each(function(node, index) {
      const cachedUrl = _imageCache.get(node.data.id);
      const safeUrl = cachedUrl || sanitizeImageUrl(node.data.image);
      if (!safeUrl) return;

      d3.select(this)
        .append('image')
        .attr('href', safeUrl)
        .attr('x', -NODE_R)
        .attr('y', -NODE_R)
        .attr('width', NODE_R * 2)
        .attr('height', NODE_R * 2)
        .attr('clip-path', `url(#${clipIds[index]})`);
    });

    nodeGroups.append('text')
      .attr('y', NODE_R + 16)
      .attr('text-anchor', 'middle')
      .text(node => truncate(node.data.name || '—', 20));

    nodeGroups.append('text')
      .attr('class', 'date-text')
      .attr('y', NODE_R + 30)
      .attr('text-anchor', 'middle')
      .text(node => buildDateLabel(node.data));
  }

  function fitGraphToViewport(group) {
    const bounds = group.node().getBBox();
    if (!bounds.width || !bounds.height) return;

    const svgEl = document.getElementById('tree-svg');
    const width = svgEl.clientWidth || 800;
    const height = svgEl.clientHeight || 600;
    const scale = Math.min(0.9 * width / bounds.width, 0.9 * height / bounds.height, 1.5);
    const tx = width / 2 - scale * (bounds.x + bounds.width / 2);
    const ty = height / 2 - scale * (bounds.y + bounds.height / 2);
    _svg.call(_treeZoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  function createClipPaths(nodes, prefix) {
    let defs = _svg.select('defs');
    if (defs.empty()) defs = _svg.append('defs');
    defs.selectAll(`clipPath[id^="${prefix}"]`).remove();

    return nodes.map((node, index) => {
      const clipId = `${prefix}${sanitizeId(node.data.id || String(index))}-${index}`;
      defs.append('clipPath')
        .attr('id', clipId)
        .append('circle')
        .attr('r', NODE_R);
      return clipId;
    });
  }

  function drawForceGraph(graph) {
    const { nodes, links } = graph;
    const group = _svg.select('#tree-g');
    group.selectAll('*').remove();

    const svgEl = document.getElementById('tree-svg');
    const width = svgEl.clientWidth || 800;
    const height = svgEl.clientHeight || 600;
    const simulationNodes = nodes.map(node => ({ ...node }));
    const simulationLinks = links.map(link => ({ ...link }));

    const linkEls = group.selectAll('.link')
      .data(simulationLinks)
      .join('line')
      .attr('class', link => `link ${link.linkClass}`);

    const nodeGroups = group.selectAll('.node')
      .data(simulationNodes)
      .join('g')
      .attr('class', node => `node ${isAssumedDeceased(node.data) ? 'deceased' : 'living'}`)
      .style('cursor', 'pointer')
      .on('click', (event, node) => {
        event.stopPropagation();
        showPersonDetail(node.data.id);
      })
      .call(d3.drag()
        .on('start', (event, node) => {
          if (!event.active) _forceSimulation.alphaTarget(0.3).restart();
          node.fx = node.x;
          node.fy = node.y;
        })
        .on('drag', (event, node) => {
          node.fx = event.x;
          node.fy = event.y;
        })
        .on('end', (event, node) => {
          if (!event.active) _forceSimulation.alphaTarget(0);
          node.fx = null;
          node.fy = null;
        })
      );

    nodeGroups.append('circle').attr('r', NODE_R);
    const clipIds = createClipPaths(simulationNodes, 'force-clip-');

    nodeGroups.each(function(node, index) {
      const cachedUrl = _imageCache.get(node.data.id);
      const safeUrl = cachedUrl || sanitizeImageUrl(node.data.image);
      if (!safeUrl) return;

      d3.select(this)
        .append('image')
        .attr('href', safeUrl)
        .attr('x', -NODE_R)
        .attr('y', -NODE_R)
        .attr('width', NODE_R * 2)
        .attr('height', NODE_R * 2)
        .attr('clip-path', `url(#${clipIds[index]})`);
    });

    nodeGroups.append('text')
      .attr('y', NODE_R + 16)
      .attr('text-anchor', 'middle')
      .text(node => truncate(node.data.name || '—', 20));

    nodeGroups.append('text')
      .attr('class', 'date-text')
      .attr('y', NODE_R + 30)
      .attr('text-anchor', 'middle')
      .text(node => buildDateLabel(node.data));

    _forceSimulation = d3.forceSimulation(simulationNodes)
      .force('link', d3.forceLink(simulationLinks)
        .id(node => node.id)
        .strength(link => link.strength)
        .distance(H_SEP * 1.1))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(NODE_R + 10))
      .on('tick', () => {
        linkEls
          .attr('x1', link => link.source.x)
          .attr('y1', link => link.source.y)
          .attr('x2', link => link.target.x)
          .attr('y2', link => link.target.y);

        nodeGroups.attr('transform', node => `translate(${node.x},${node.y})`);
      });
  }

  function buildDateLabel(person) {
    const parts = [];
    if (person.birthDate) parts.push(person.birthDate.slice(0, 4));
    if (person.deathDate) parts.push(person.deathDate.slice(0, 4));
    return parts.join(' – ');
  }

  function truncate(value, max) {
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
  }

  function sanitizeId(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '-');
  }

  function stopForceSimulation() {
    if (_forceSimulation) {
      _forceSimulation.stop();
      _forceSimulation = null;
    }
  }

  return {
    init,
    draw,
    clear
  };
})();
