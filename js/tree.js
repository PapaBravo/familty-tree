function initTree() {
  window.treeRenderer.init();
  populateRootSelect();
}

function populateRootSelect() {
  const select = document.getElementById('root-select');
  const activeId = getActiveId();
  const data = activeId ? getFamilyData(activeId) : null;
  const persons = data ? (data.persons || []) : [];

  select.innerHTML = '';
  if (persons.length === 0) {
    select.innerHTML = '<option value="">No persons</option>';
    return;
  }

  persons
    .slice()
    .sort((left, right) => (left.name || '').localeCompare(right.name || ''))
    .forEach(person => {
      const option = document.createElement('option');
      option.value = person.id;
      option.textContent = person.name;
      select.appendChild(option);
    });
}

function renderTree() {
  const activeId = getActiveId();
  const data = activeId ? getFamilyData(activeId) : null;
  if (!data || !data.persons || data.persons.length === 0) {
    window.treeRenderer.clear('No persons to display');
    return;
  }

  const mode = document.getElementById('tree-mode-select').value;
  const rootId = document.getElementById('root-select').value;
  const depth = parseInt(document.getElementById('depth-input').value, 10) || 3;

  if (!rootId && mode !== 'force') {
    window.treeRenderer.clear('Select a root person');
    return;
  }

  const graph = window.treeGraph.buildRenderGraph(data, rootId, depth, mode);
  if (graph.error) {
    window.treeRenderer.clear(graph.error);
    return;
  }

  window.treeRenderer.draw(graph);
}
