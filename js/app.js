/**
 * app.js – Application bootstrap, family management, import/export
 */

// Global image object-URL cache: Map<personId, objectURL>
// Populated before each render via refreshImageCache().
let _imageCache = new Map();

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
  await refresh();
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
async function refresh() {
  // Revoke old object URLs to prevent memory leaks
  _imageCache.forEach(url => URL.revokeObjectURL(url));
  _imageCache = new Map();

  const activeId = getActiveId();
  if (activeId) {
    const data = getFamilyData(activeId);
    if (data && data.persons) {
      const personIds = data.persons.map(p => p.id);
      try {
        _imageCache = await loadFamilyImageCache(activeId, personIds);
      } catch (e) {
        console.warn('Could not load image cache:', e);
      }
    }
  }

  renderList();
  populateRootSelect();
  // Only re-render tree if it's visible
  const treePanel = document.getElementById('tree-panel');
  if (treePanel && treePanel.classList.contains('active')) {
    renderTree();
  }
  // Only re-render map if it's visible
  const mapPanel = document.getElementById('map-panel');
  if (mapPanel && mapPanel.classList.contains('active')) {
    initMap();
    renderMap();
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
      if (btn.dataset.panel === 'map-panel') { initMap(); renderMap(); }
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
  document.getElementById('add-person-list-btn').addEventListener('click', () => {
    openEditModal(null);
  });

  // Tree render button
  document.getElementById('render-btn').addEventListener('click', renderTree);

  // Hide root/depth controls for Force mode (they are irrelevant there)
  document.getElementById('tree-mode-select').addEventListener('change', e => {
    const isForce = e.target.value === 'force';
    const rootLabel   = document.querySelector('#tree-controls label[for="root-select"]');
    const depthLabel  = document.querySelector('#tree-controls label[for="depth-input"]');
    const rootSel     = document.getElementById('root-select');
    const depthInput  = document.getElementById('depth-input');
    [rootLabel, rootSel, depthLabel, depthInput].forEach(el => {
      if (el) el.style.display = isForce ? 'none' : '';
    });
  });

  // Edit modal save/delete
  document.getElementById('edit-save-btn').addEventListener('click', savePersonFromModal);
  document.getElementById('edit-delete-btn').addEventListener('click', () => {
    if (!confirm('Delete this person?')) return;
    deletePersonFromModal();
  });
  document.getElementById('edit-cancel-btn').addEventListener('click', () => closeModal('edit-modal'));
  document.getElementById('edit-close-btn').addEventListener('click', () => closeModal('edit-modal'));
  document.getElementById('detail-close-btn').addEventListener('click', () => {
    _clearDetailAvatarObjectUrl();
    closeModal('person-detail-modal');
  });
  document.getElementById('detail-close-footer-btn').addEventListener('click', () => {
    _clearDetailAvatarObjectUrl();
    closeModal('person-detail-modal');
  });

  // Photo upload in edit modal
  document.getElementById('photo-upload-btn').addEventListener('click', () => {
    document.getElementById('photo-file-input').click();
  });
  document.getElementById('photo-file-input').addEventListener('change', handlePhotoFileChange);
  document.getElementById('photo-remove-btn').addEventListener('click', handlePhotoRemove);

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
  document.getElementById('export-zip-btn').addEventListener('click', downloadExportZip);
  document.getElementById('export-close-btn').addEventListener('click', () => closeModal('export-modal'));

  // Import
  document.getElementById('import-btn').addEventListener('click', () => openModal('import-modal'));
  document.getElementById('import-file-btn').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', handleImportFile);
  document.getElementById('import-confirm-btn').addEventListener('click', doImport);
  document.getElementById('import-cancel-btn').addEventListener('click', () => closeModal('import-modal'));
  document.getElementById('import-close-btn').addEventListener('click', () => closeModal('import-modal'));
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

async function downloadExportZip() {
  const activeId = getActiveId();
  if (!activeId) return;

  const families = getFamilies();
  const family = families.find(f => f.id === activeId);
  const data = getFamilyData(activeId);
  if (!data) return;

  const exportObj = {
    name: family ? family.name : 'Family',
    ...data
  };

  const zip = new JSZip();
  zip.file('family.json', JSON.stringify(exportObj, null, 2));

  // Add images from IDB
  const imageBlobs = await getAllFamilyImageBlobs(activeId);
  if (imageBlobs.size > 0) {
    const imgFolder = zip.folder('images');
    imageBlobs.forEach((blob, personId) => {
      const ext = imageExtension(blob);
      imgFolder.file(`${personId}.${ext}`, blob);
    });
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(family ? family.name : 'family').replace(/\s+/g, '_')}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('ZIP downloaded', 'success');
}

/* -------------------------------------------------------
   Import
------------------------------------------------------- */
// Stores image blobs extracted from a ZIP during file load,
// keyed by person ID (from the images/ folder filename).
let _pendingImportImages = new Map();

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  _pendingImportImages = new Map();

  if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip') {
    _handleImportZip(file);
  } else {
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('import-input').value = ev.target.result;
    };
    reader.readAsText(file);
  }
  // Reset input for re-selection
  e.target.value = '';
}

async function _handleImportZip(file) {
  try {
    const zip = await JSZip.loadAsync(file);

    // Find the shallowest JSON file in the ZIP (supports both flat ZIPs and
    // ZIPs where everything is wrapped inside a single top-level folder, as
    // is common when compressing a folder on Ubuntu/Linux).
    let jsonEntry = null;
    let jsonDepth = Infinity;
    zip.forEach((relativePath, entry) => {
      if (!entry.dir && relativePath.endsWith('.json')) {
        const depth = relativePath.split('/').length;
        if (depth < jsonDepth) {
          jsonDepth = depth;
          jsonEntry = { path: relativePath, entry };
        }
      }
    });
    if (!jsonEntry) {
      showToast('No JSON file found in ZIP', 'error');
      return;
    }

    // Determine the base directory prefix (e.g. "" or "my_family/")
    const basePath = jsonEntry.path.substring(0, jsonEntry.path.lastIndexOf('/') + 1);

    const jsonText = await jsonEntry.entry.async('string');
    document.getElementById('import-input').value = jsonText;

    // Extract images from the images/ folder relative to the JSON location
    const imagesPrefix = basePath + 'images/';
    const imagePromises = [];
    zip.forEach((relativePath, entry) => {
      if (!entry.dir && relativePath.startsWith(imagesPrefix)) {
        const filename = relativePath.slice(imagesPrefix.length);
        const personId = filename.replace(/\.[^/.]+$/, ''); // strip extension
        if (personId) {
          imagePromises.push(
            entry.async('blob').then(blob => {
              // Infer MIME type from extension
              const ext = filename.split('.').pop().toLowerCase();
              const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
              const mime = mimeMap[ext] || 'image/jpeg';
              _pendingImportImages.set(personId, new Blob([blob], { type: mime }));
            })
          );
        }
      }
    });
    await Promise.all(imagePromises);
    showToast(`ZIP loaded: ${_pendingImportImages.size} photo(s) found`, 'success');
  } catch (err) {
    showToast('Failed to read ZIP: ' + err.message, 'error');
  }
}

async function doImport() {
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

  // Save any extracted images to IDB, keyed by the imported person IDs
  if (_pendingImportImages.size > 0) {
    const saveOps = [];
    _pendingImportImages.forEach((blob, personId) => {
      saveOps.push(savePersonImage(id, personId, blob));
    });
    await Promise.all(saveOps).catch(err => {
      console.warn('Some images could not be saved:', err);
    });
    _pendingImportImages = new Map();
  }

  setActiveId(id);
  populateFamilySelect();
  document.getElementById('family-select').value = id;
  document.getElementById('import-input').value = '';
  closeModal('import-modal');
  await refresh();
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
