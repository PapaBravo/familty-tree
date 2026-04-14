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
function showPersonDetail(personId) {
  const data = getFamilyData(getActiveId());
  if (!data) return;
  const person = data.persons.find(p => p.id === personId);
  if (!person) return;

  document.getElementById('detail-name').textContent = person.name || '—';

  // Avatar
  const avatarEl = document.getElementById('detail-avatar');
  avatarEl.innerHTML = '';
  if (person.image) {
    const img = document.createElement('img');
    img.src = sanitizeImageUrl(person.image);
    img.alt = person.name;
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = getInitials(person.name);
  }

  // Dates
  let datesStr = person.birthDate ? `Born: ${formatDate(person.birthDate)}` : '';
  if (person.deathDate) datesStr += ` · Died: ${formatDate(person.deathDate)}`;
  document.getElementById('detail-dates').textContent = datesStr;

  // Status badge
  const statusEl = document.getElementById('detail-status');
  if (person.deathDate) {
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

function openEditModal(personId) {
  _editingPersonId = personId || null;
  const data = getFamilyData(getActiveId());
  const person = personId && data ? data.persons.find(p => p.id === personId) : null;

  document.getElementById('edit-modal-title').textContent = person ? 'Edit Person' : 'New Person';
  document.getElementById('edit-name').value = person ? person.name : '';
  document.getElementById('edit-birth').value = person ? (person.birthDate || '') : '';
  document.getElementById('edit-death').value = person ? (person.deathDate || '') : '';
  document.getElementById('edit-description').value = person ? (person.description || '') : '';
  document.getElementById('edit-image').value = person ? (person.image || '') : '';

  // Populate parents list
  buildParentsEditor(person ? (person.parents || []) : [], data ? data.persons : []);

  openModal('edit-modal');
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

  const personSel = document.createElement('select');
  personSel.innerHTML = '<option value="">— Select person —</option>';
  allPersons.forEach(p => {
    if (_editingPersonId && p.id === _editingPersonId) return;
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === selectedId) opt.selected = true;
    personSel.appendChild(opt);
  });

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

  row.appendChild(personSel);
  row.appendChild(typeSel);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function collectParentsFromEditor() {
  const rows = document.querySelectorAll('#parents-list .parent-entry');
  const parents = [];
  rows.forEach(row => {
    const selects = row.querySelectorAll('select');
    const personId = selects[0].value;
    const type = selects[1].value;
    if (personId) parents.push({ personId, type });
  });
  return parents;
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

  const personData = {
    name,
    birthDate: document.getElementById('edit-birth').value || '',
    deathDate: document.getElementById('edit-death').value || '',
    description: document.getElementById('edit-description').value.trim(),
    image: document.getElementById('edit-image').value.trim(),
    parents: collectParentsFromEditor()
  };

  if (_editingPersonId) {
    const idx = data.persons.findIndex(p => p.id === _editingPersonId);
    if (idx !== -1) {
      data.persons[idx] = { ...data.persons[idx], ...personData };
    }
  } else {
    data.persons.push({ id: generateId(), ...personData });
  }

  saveFamilyData(activeId, data);
  closeModal('edit-modal');
  showToast(_editingPersonId ? 'Person updated' : 'Person added', 'success');
  window.app && window.app.refresh();
}

function deletePersonFromModal() {
  if (!_editingPersonId) return;
  const activeId = getActiveId();
  const data = getFamilyData(activeId);
  if (!data) return;

  // Remove from persons
  data.persons = data.persons.filter(p => p.id !== _editingPersonId);
  // Remove parent refs
  data.persons.forEach(p => {
    p.parents = (p.parents || []).filter(pr => pr.personId !== _editingPersonId);
  });
  // Remove partnerships
  data.partnerships = (data.partnerships || []).filter(
    pp => pp.person1Id !== _editingPersonId && pp.person2Id !== _editingPersonId
  );

  saveFamilyData(activeId, data);
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
