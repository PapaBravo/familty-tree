/**
 * app.js – Application bootstrap, family management, import/export
 */

window.app = { refresh };

/* -------------------------------------------------------
   Bootstrap
------------------------------------------------------- */
async function boot() {
  // Load sample data on first run
  if (getFamilies().length === 0) {
    await loadSampleFamily();
  }

  populateFamilySelect();
  setActiveFamilyFromStorage();
  initList();
  initTree();
  refresh();
  bindEvents();
}

async function loadSampleFamily() {
  try {
    const resp = await fetch('./data/sample-family.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    const id = createFamily(json.name || 'Sample Family', {
      persons: json.persons || [],
      partnerships: json.partnerships || []
    });
    setActiveId(id);
  } catch (err) {
    console.warn('Could not load sample family:', err);
    // Create empty family as fallback
    const id = createFamily('My Family', { persons: [], partnerships: [] });
    setActiveId(id);
  }
}

/* -------------------------------------------------------
   Family selector
------------------------------------------------------- */
function populateFamilySelect() {
  const sel = document.getElementById('family-select');
  const families = getFamilies();
  sel.innerHTML = '';
  families.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    sel.appendChild(opt);
  });
}

function setActiveFamilyFromStorage() {
  const stored = getActiveId();
  const families = getFamilies();
  if (!stored || !families.find(f => f.id === stored)) {
    if (families.length > 0) setActiveId(families[0].id);
  }
  const sel = document.getElementById('family-select');
  if (sel) sel.value = getActiveId();
}

/* -------------------------------------------------------
   Refresh (re-render current view)
------------------------------------------------------- */
function refresh() {
  renderList();
  populateRootSelect();
  // Only re-render tree if it's visible
  const treePanel = document.getElementById('tree-panel');
  if (treePanel && treePanel.classList.contains('active')) {
    renderTree();
  }
}

/* -------------------------------------------------------
   Events
------------------------------------------------------- */
function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.panel).classList.add('active');
      if (btn.dataset.panel === 'tree-panel') renderTree();
    });
  });

  // Family selector change
  document.getElementById('family-select').addEventListener('change', e => {
    setActiveId(e.target.value);
    refresh();
  });

  // New family
  document.getElementById('new-family-btn').addEventListener('click', () => {
    const name = prompt('New family name:');
    if (!name || !name.trim()) return;
    const id = createFamily(name.trim(), { persons: [], partnerships: [] });
    setActiveId(id);
    populateFamilySelect();
    document.getElementById('family-select').value = id;
    refresh();
    showToast('Family created', 'success');
  });

  // Delete family
  document.getElementById('delete-family-btn').addEventListener('click', () => {
    const families = getFamilies();
    if (families.length <= 1) {
      showToast('Cannot delete the last family', 'error');
      return;
    }
    const name = families.find(f => f.id === getActiveId())?.name || 'this family';
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const oldId = getActiveId();
    const remaining = families.filter(f => f.id !== oldId);
    deleteFamily(oldId);
    setActiveId(remaining[0].id);
    populateFamilySelect();
    document.getElementById('family-select').value = getActiveId();
    refresh();
    showToast('Family deleted', 'success');
  });

  // Add person
  document.getElementById('add-person-btn').addEventListener('click', () => {
    openEditModal(null);
  });

  // Tree render button
  document.getElementById('render-btn').addEventListener('click', renderTree);

  // Edit modal save/delete
  document.getElementById('edit-save-btn').addEventListener('click', savePersonFromModal);
  document.getElementById('edit-delete-btn').addEventListener('click', () => {
    if (!confirm('Delete this person?')) return;
    deletePersonFromModal();
  });
  document.getElementById('edit-cancel-btn').addEventListener('click', () => closeModal('edit-modal'));
  document.getElementById('detail-close-btn').addEventListener('click', () => closeModal('person-detail-modal'));

  // Export
  document.getElementById('export-btn').addEventListener('click', openExportModal);
  document.getElementById('export-copy-btn').addEventListener('click', () => {
    const ta = document.getElementById('export-output');
    ta.select();
    navigator.clipboard.writeText(ta.value).then(
      () => showToast('Copied to clipboard', 'success'),
      () => { document.execCommand('copy'); showToast('Copied', 'success'); }
    );
  });
  document.getElementById('export-download-btn').addEventListener('click', downloadExport);
  document.getElementById('export-close-btn').addEventListener('click', () => closeModal('export-modal'));

  // Import
  document.getElementById('import-btn').addEventListener('click', () => openModal('import-modal'));
  document.getElementById('import-file-btn').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', handleImportFile);
  document.getElementById('import-confirm-btn').addEventListener('click', doImport);
  document.getElementById('import-cancel-btn').addEventListener('click', () => closeModal('import-modal'));
}

/* -------------------------------------------------------
   Export
------------------------------------------------------- */
function openExportModal() {
  const activeId = getActiveId();
  const data = activeId ? getFamilyData(activeId) : null;
  const families = getFamilies();
  const family = families.find(f => f.id === activeId);
  const exportObj = {
    name: family ? family.name : 'Family',
    ...(data || { persons: [], partnerships: [] })
  };
  document.getElementById('export-output').value = JSON.stringify(exportObj, null, 2);
  openModal('export-modal');
}

function downloadExport() {
  const content = document.getElementById('export-output').value;
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const families = getFamilies();
  const family = families.find(f => f.id === getActiveId());
  a.download = `${(family ? family.name : 'family').replace(/\s+/g, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------
   Import
------------------------------------------------------- */
function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById('import-input').value = ev.target.result;
  };
  reader.readAsText(file);
  // Reset input for re-selection
  e.target.value = '';
}

function doImport() {
  const raw = document.getElementById('import-input').value.trim();
  if (!raw) { showToast('Paste or load JSON first', 'error'); return; }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    showToast('Invalid JSON', 'error');
    return;
  }

  if (!Array.isArray(parsed.persons)) {
    showToast('JSON must have a "persons" array', 'error');
    return;
  }

  const name = (parsed.name || 'Imported Family').trim();
  const data = {
    persons:      parsed.persons      || [],
    partnerships: parsed.partnerships || []
  };

  const id = createFamily(name, data);
  setActiveId(id);
  populateFamilySelect();
  document.getElementById('family-select').value = id;
  document.getElementById('import-input').value = '';
  closeModal('import-modal');
  refresh();
  showToast(`Imported "${name}"`, 'success');
}

/* -------------------------------------------------------
   Toast notifications
------------------------------------------------------- */
let _toastTimer = null;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show${type ? ' ' + type : ''}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.className = '';
  }, 2800);
}

/* -------------------------------------------------------
   DOMContentLoaded
------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', boot);
