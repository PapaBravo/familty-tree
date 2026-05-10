/**
 * modals.js – Modal lifecycle management for Family Tree
 */

/* -------------------------------------------------------
   Generic helpers
------------------------------------------------------- */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
}

// Close on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAllModals();
});

/* -------------------------------------------------------
   Person Detail Modal
------------------------------------------------------- */
// Object URL created for the detail modal avatar (blob from IDB)
let _detailAvatarObjectUrl = null;

function _clearDetailAvatarObjectUrl() {
  if (_detailAvatarObjectUrl) {
    URL.revokeObjectURL(_detailAvatarObjectUrl);
    _detailAvatarObjectUrl = null;
  }
}

function showPersonDetail(personId) {
  const data = getFamilyData(getActiveId());
  if (!data) return;
  const person = data.persons.find(p => p.id === personId);
  if (!person) return;

  document.getElementById('detail-name').textContent = person.name || '—';

  // Avatar – load from IDB first, fall back to URL
  const avatarEl = document.getElementById('detail-avatar');
  avatarEl.innerHTML = '';
  _clearDetailAvatarObjectUrl();
  getPersonImage(getActiveId(), personId).then(blob => {
    if (blob) {
      _clearDetailAvatarObjectUrl();
      _detailAvatarObjectUrl = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = _detailAvatarObjectUrl;
      img.alt = person.name;
      avatarEl.innerHTML = '';
      avatarEl.appendChild(img);
    } else if (person.image) {
      const safeUrl = sanitizeImageUrl(person.image);
      if (safeUrl) {
        const img = document.createElement('img');
        img.src = safeUrl;
        img.alt = person.name;
        avatarEl.innerHTML = '';
        avatarEl.appendChild(img);
      } else {
        avatarEl.textContent = getInitials(person.name);
      }
    } else {
      avatarEl.textContent = getInitials(person.name);
    }
  }).catch(() => {
    if (person.image) {
      const safeUrl = sanitizeImageUrl(person.image);
      if (safeUrl) {
        const img = document.createElement('img');
        img.src = safeUrl;
        img.alt = person.name;
        avatarEl.appendChild(img);
      } else {
        avatarEl.textContent = getInitials(person.name);
      }
    } else {
      avatarEl.textContent = getInitials(person.name);
    }
  });
  // Show initials immediately as a placeholder while loading
  if (!avatarEl.firstChild) {
    avatarEl.textContent = getInitials(person.name);
  }

  // Dates
  let datesStr = person.birthDate ? `Born: ${formatDate(person.birthDate)}` : '';
  if (person.deathDate) datesStr += ` · Died: ${formatDate(person.deathDate)}`;
  document.getElementById('detail-dates').textContent = datesStr;

  // Status badge
  const statusEl = document.getElementById('detail-status');
  if (isAssumedDeceased(person)) {
    statusEl.textContent = 'Deceased';
    statusEl.className = 'badge deceased';
  } else {
    statusEl.textContent = 'Living';
    statusEl.className = 'badge living';
  }

  // Description
  const descEl = document.getElementById('detail-desc');
  descEl.textContent = person.description || '';

  // Parents
  const parentsList = document.getElementById('detail-parents');
  parentsList.innerHTML = '';
  if (person.parents && person.parents.length > 0) {
    person.parents.forEach(pRef => {
      const parent = data.persons.find(p => p.id === pRef.personId);
      if (parent) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = `${parent.name} (${pRef.type})`;
        a.addEventListener('click', ev => {
          ev.preventDefault();
          closeModal('person-detail-modal');
          showPersonDetail(parent.id);
        });
        li.appendChild(a);
        parentsList.appendChild(li);
      }
    });
  } else {
    parentsList.innerHTML = '<li style="color:var(--text-muted)">None recorded</li>';
  }

  // Children
  const childrenList = document.getElementById('detail-children');
  childrenList.innerHTML = '';
  const children = data.persons.filter(p =>
    p.parents && p.parents.some(pr => pr.personId === personId)
  );
  if (children.length > 0) {
    children.forEach(child => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = child.name;
      a.addEventListener('click', ev => {
        ev.preventDefault();
        closeModal('person-detail-modal');
        showPersonDetail(child.id);
      });
      li.appendChild(a);
      childrenList.appendChild(li);
    });
  } else {
    childrenList.innerHTML = '<li style="color:var(--text-muted)">None recorded</li>';
  }

  // Partnerships
  const partnersList = document.getElementById('detail-partners');
  partnersList.innerHTML = '';
  const partnerships = (data.partnerships || []).filter(
    pp => pp.person1Id === personId || pp.person2Id === personId
  );
  if (partnerships.length > 0) {
    partnerships.forEach(pp => {
      const partnerId = pp.person1Id === personId ? pp.person2Id : pp.person1Id;
      const partner = data.persons.find(p => p.id === partnerId);
      if (partner) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#';
        let label = `${partner.name} (${pp.type}`;
        if (pp.startDate) label += `, ${formatDate(pp.startDate)}`;
        if (pp.endDate) label += ` – ${formatDate(pp.endDate)}`;
        label += ')';
        a.textContent = label;
        a.addEventListener('click', ev => {
          ev.preventDefault();
          closeModal('person-detail-modal');
          showPersonDetail(partner.id);
        });
        li.appendChild(a);
        partnersList.appendChild(li);
      }
    });
  } else {
    partnersList.innerHTML = '<li style="color:var(--text-muted)">None recorded</li>';
  }

  // Edit button
  document.getElementById('detail-edit-btn').onclick = () => {
    closeModal('person-detail-modal');
    openEditModal(personId);
  };

  openModal('person-detail-modal');
}

/* -------------------------------------------------------
   Person Edit / Create Modal
------------------------------------------------------- */
let _editingPersonId = null;
// Tracks a newly-selected image file before saving (null = no pending upload)
let _pendingImageFile = null;
// Tracks whether the user explicitly removed the current image
let _imageRemoved = false;
// Tracks object URL created for the modal preview (for cleanup)
let _previewObjectUrl = null;

function _clearPreviewObjectUrl() {
  if (_previewObjectUrl) {
    URL.revokeObjectURL(_previewObjectUrl);
    _previewObjectUrl = null;
  }
}

function openEditModal(personId) {
  _editingPersonId = personId || null;
  _pendingImageFile = null;
  _imageRemoved = false;
  _clearPreviewObjectUrl();

  const data = getFamilyData(getActiveId());
  const person = personId && data ? data.persons.find(p => p.id === personId) : null;

  document.getElementById('edit-modal-title').textContent = person ? 'Edit Person' : 'New Person';
  document.getElementById('edit-name').value = person ? person.name : '';
  document.getElementById('edit-birth').value = person ? (person.birthDate || '') : '';
  document.getElementById('edit-death').value = person ? (person.deathDate || '') : '';
  document.getElementById('edit-description').value = person ? (person.description || '') : '';

  // Reset photo UI
  const previewEl = document.getElementById('photo-preview');
  const removeBtn = document.getElementById('photo-remove-btn');
  previewEl.innerHTML = '';
  removeBtn.style.display = 'none';
  document.getElementById('photo-file-input').value = '';

  // Populate parents list
  buildParentsEditor(person ? (person.parents || []) : [], data ? data.persons : []);

  // Populate partnerships list
  const existingPartnerships = personId && data
    ? (data.partnerships || []).filter(pp => pp.person1Id === personId || pp.person2Id === personId)
    : [];
  buildPartnershipsEditor(existingPartnerships, data ? data.persons : [], personId);

  openModal('edit-modal');

  // Load existing photo asynchronously (IDB first, then legacy URL)
  if (personId) {
    const activeId = getActiveId();
    getPersonImage(activeId, personId).then(blob => {
      if (blob) {
        _clearPreviewObjectUrl();
        _previewObjectUrl = URL.createObjectURL(blob);
        _setPhotoPreview(_previewObjectUrl, true);
      } else if (person && person.image) {
        const safeUrl = sanitizeImageUrl(person.image);
        if (safeUrl) _setPhotoPreview(safeUrl, false);
      }
    }).catch(() => {
      if (person && person.image) {
        const safeUrl = sanitizeImageUrl(person.image);
        if (safeUrl) _setPhotoPreview(safeUrl, false);
      }
    });
  }
}

/** Show a preview image inside the upload area. */
function _setPhotoPreview(src, showRemove) {
  if (!src || typeof src !== 'string') return;
  // Accept blob: URLs (from createObjectURL - always safe) or URLs validated by sanitizeImageUrl.
  const isBlob = src.startsWith('blob:');
  const safeSrc = isBlob ? src : sanitizeImageUrl(src);
  if (!safeSrc) return;

  const previewEl = document.getElementById('photo-preview');
  const removeBtn = document.getElementById('photo-remove-btn');
  previewEl.innerHTML = '';
  const img = document.createElement('img');
  // safeSrc is either a blob: URL (createObjectURL output, cannot execute scripts)
  // or a value returned by sanitizeImageUrl() which only allows https:// and
  // well-formed data:image/...;base64,... URIs.  Setting .src is therefore safe.
  img.setAttribute('src', safeSrc);
  img.alt = 'Photo preview';
  previewEl.appendChild(img);
  removeBtn.style.display = showRemove ? '' : 'none';
}

/** Called when the user picks a file. */
function handlePhotoFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  _clearPreviewObjectUrl();
  _pendingImageFile = file;
  _imageRemoved = false;
  _previewObjectUrl = URL.createObjectURL(file);
  _setPhotoPreview(_previewObjectUrl, true);
}

/** Called when the user clicks "Remove". */
function handlePhotoRemove() {
  _clearPreviewObjectUrl();
  _pendingImageFile = null;
  _imageRemoved = true;
  const previewEl = document.getElementById('photo-preview');
  const removeBtn = document.getElementById('photo-remove-btn');
  previewEl.innerHTML = '';
  removeBtn.style.display = 'none';
  document.getElementById('photo-file-input').value = '';
}

/**
 * Creates a person picker widget: a sorted <select>.
 * The returned element is a .person-picker div containing the <select>.
 * Pass extraClass to add an extra class to the <select>.
 */
function createPersonPicker(allPersons, selectedId, placeholder, extraClass) {
  const sorted = [...allPersons]
    .filter(p => !(_editingPersonId && p.id === _editingPersonId))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const wrapper = document.createElement('div');
  wrapper.className = 'person-picker';

  const sel = document.createElement('select');
  if (extraClass) sel.className = extraClass;

  sel.innerHTML = `<option value="">${placeholder}</option>`;
  sorted.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (String(p.id) === String(selectedId)) opt.selected = true;
    sel.appendChild(opt);
  });

  wrapper.appendChild(sel);

  return wrapper;
}

function buildParentsEditor(currentParents, allPersons) {
  const container = document.getElementById('parents-list');
  container.innerHTML = '';

  currentParents.forEach(pRef => {
    addParentRow(container, allPersons, pRef.personId, pRef.type);
  });

  document.getElementById('add-parent-btn').onclick = () => {
    addParentRow(container, allPersons, '', 'mother');
  };
}

function addParentRow(container, allPersons, selectedId, selectedType) {
  const row = document.createElement('div');
  row.className = 'parent-entry';

  const picker = createPersonPicker(allPersons, selectedId, '— Select person —');

  const typeSel = document.createElement('select');
  typeSel.className = 'type-select';
  ['mother', 'father', 'adopted'].forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === selectedType) opt.selected = true;
    typeSel.appendChild(opt);
  });

  const removeBtn = document.createElement('button');
  removeBtn.textContent = '✕';
  removeBtn.title = 'Remove parent';
  removeBtn.onclick = () => row.remove();

  row.appendChild(picker);
  row.appendChild(typeSel);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function collectParentsFromEditor() {
  const rows = document.querySelectorAll('#parents-list .parent-entry');
  const parents = [];
  rows.forEach(row => {
    const personId = row.querySelector('.person-picker select').value;
    const type = row.querySelector('.type-select').value;
    if (personId) parents.push({ personId, type });
  });
  return parents;
}

function buildPartnershipsEditor(currentPartnerships, allPersons, personId) {
  const container = document.getElementById('partnerships-list');
  container.innerHTML = '';

  currentPartnerships.forEach(pp => {
    const partnerId = pp.person1Id === personId ? pp.person2Id : pp.person1Id;
    addPartnershipRow(container, allPersons, pp.id, partnerId, pp.type, pp.startDate || '', pp.endDate || '');
  });

  document.getElementById('add-partnership-btn').onclick = () => {
    addPartnershipRow(container, allPersons, null, '', 'marriage', '', '');
  };
}

function addPartnershipRow(container, allPersons, ppId, selectedPartnerId, selectedType, startDate, endDate) {
  const row = document.createElement('div');
  row.className = 'partnership-entry';
  if (ppId) row.dataset.ppId = ppId;

  const picker = createPersonPicker(allPersons, selectedPartnerId, '— Select partner —', 'partner-select');

  const typeSel = document.createElement('select');
  typeSel.className = 'type-select';
  ['marriage', 'divorced', 'partner'].forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === selectedType) opt.selected = true;
    typeSel.appendChild(opt);
  });

  const startInput = document.createElement('input');
  startInput.type = 'date';
  startInput.className = 'partnership-date';
  startInput.value = startDate || '';
  startInput.title = 'Start date';

  const endInput = document.createElement('input');
  endInput.type = 'date';
  endInput.className = 'partnership-date';
  endInput.value = endDate || '';
  endInput.title = 'End date';

  const removeBtn = document.createElement('button');
  removeBtn.textContent = '✕';
  removeBtn.title = 'Remove partnership';
  removeBtn.onclick = () => row.remove();

  row.appendChild(picker);
  row.appendChild(typeSel);
  row.appendChild(startInput);
  row.appendChild(endInput);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function collectPartnershipsFromEditor() {
  const rows = document.querySelectorAll('#partnerships-list .partnership-entry');
  const partnerships = [];
  let hasIncomplete = false;
  rows.forEach(row => {
    const partnerId = row.querySelector('.partner-select').value;
    const type = row.querySelector('.type-select').value;
    const dates = row.querySelectorAll('.partnership-date');
    const startDate = dates[0] ? dates[0].value : '';
    const endDate = dates[1] ? dates[1].value : '';
    if (partnerId) {
      const entry = { partnerId, type, startDate, endDate };
      if (row.dataset.ppId) entry.ppId = row.dataset.ppId;
      partnerships.push(entry);
    } else {
      hasIncomplete = true;
    }
  });
  if (hasIncomplete) {
    showToast('One or more partnerships have no partner selected and will be skipped', 'error');
  }
  return partnerships;
}

function savePersonFromModal() {
  const activeId = getActiveId();
  if (!activeId) return;

  const data = getFamilyData(activeId) || { persons: [], partnerships: [] };

  const name = document.getElementById('edit-name').value.trim();
  if (!name) {
    showToast('Name is required', 'error');
    return;
  }

  // Determine the person ID (existing or new)
  const personId = _editingPersonId || generateId();

  // Determine image field value:
  // - If a new file was picked → will save to IDB, clear image URL field
  // - If image was removed → clear image URL and delete from IDB
  // - Otherwise keep existing image field unchanged
  let imageValue;
  if (_editingPersonId) {
    const existing = data.persons.find(p => p.id === _editingPersonId);
    imageValue = existing ? (existing.image || '') : '';
  } else {
    imageValue = '';
  }
  if (_pendingImageFile || _imageRemoved) {
    imageValue = '';
  }

  const personData = {
    name,
    birthDate: document.getElementById('edit-birth').value || '',
    deathDate: document.getElementById('edit-death').value || '',
    description: document.getElementById('edit-description').value.trim(),
    image:       imageValue,
    parents:     collectParentsFromEditor()
  };

  if (_editingPersonId) {
    const idx = data.persons.findIndex(p => p.id === _editingPersonId);
    if (idx !== -1) {
      data.persons[idx] = { ...data.persons[idx], ...personData };
    }
  } else {
    data.persons.push({ id: personId, ...personData });
  }

  // Update partnerships: replace all partnerships involving this person
  const editorPartnerships = collectPartnershipsFromEditor();
  data.partnerships = (data.partnerships || []).filter(
    pp => pp.person1Id !== personId && pp.person2Id !== personId
  );
  editorPartnerships.forEach(ep => {
    const pp = {
      id: ep.ppId || generateId(),
      person1Id: personId,
      person2Id: ep.partnerId,
      type: ep.type
    };
    if (ep.startDate) pp.startDate = ep.startDate;
    if (ep.endDate) pp.endDate = ep.endDate;
    data.partnerships.push(pp);
  });

  saveFamilyData(activeId, data);

  // Handle image blob operations asynchronously, then refresh
  const imageOps = [];
  if (_pendingImageFile) {
    imageOps.push(savePersonImage(activeId, personId, _pendingImageFile));
  } else if (_imageRemoved && _editingPersonId) {
    imageOps.push(deletePersonImage(activeId, _editingPersonId));
  }

  Promise.all(imageOps).then(() => {
    _clearPreviewObjectUrl();
    const msg = _editingPersonId ? 'Person updated' : 'Person added';
    closeModal('edit-modal');
    showToast(msg, 'success');
    window.app && window.app.refresh();
  }).catch(err => {
    console.warn('Image operation failed:', err);
    _clearPreviewObjectUrl();
    const msg = _editingPersonId ? 'Person updated' : 'Person added';
    closeModal('edit-modal');
    showToast(msg, 'success');
    window.app && window.app.refresh();
  });
}

function deletePersonFromModal() {
  if (!_editingPersonId) return;
  const activeId = getActiveId();
  const data = getFamilyData(activeId);
  if (!data) return;

  const deletedId = _editingPersonId;

  // Remove from persons
  data.persons = data.persons.filter(p => p.id !== deletedId);
  // Remove parent refs
  data.persons.forEach(p => {
    p.parents = (p.parents || []).filter(pr => pr.personId !== deletedId);
  });
  // Remove partnerships
  data.partnerships = (data.partnerships || []).filter(
    pp => pp.person1Id !== deletedId && pp.person2Id !== deletedId
  );

  saveFamilyData(activeId, data);
  // Best-effort delete image from IDB
  deletePersonImage(activeId, deletedId).catch(() => {});
  closeModal('edit-modal');
  showToast('Person deleted', 'success');
  window.app && window.app.refresh();
}

/* -------------------------------------------------------
   Utility
------------------------------------------------------- */
function getInitials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0].toUpperCase()).join('').slice(0, 2);
}

/**
 * Returns true if a person should be rendered as deceased.
 * A person is considered deceased when they have a recorded deathDate, or
 * when their birthDate indicates they were born more than 110 years ago.
 */
const _currentYear = new Date().getFullYear();
function isAssumedDeceased(person) {
  if (!person) return false;
  if (person.deathDate) return true;
  if (person.birthDate) {
    const birthYear = new Date(person.birthDate + 'T00:00:00').getFullYear();
    if (!isNaN(birthYear) && (_currentYear - birthYear) > 110) return true;
  }
  return false;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Sanitize image URLs – only allow http(s) and data URIs.
 * Returns empty string for anything else.
 */
// Only allow well-formed data URIs for common image types (base64 only).
const SAFE_DATA_URI = /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;

function sanitizeImageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('data:')) {
    return SAFE_DATA_URI.test(trimmed) ? trimmed : '';
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
  } catch {
    // invalid URL
  }
  return '';
}
