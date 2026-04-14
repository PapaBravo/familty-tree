/**
 * list.js – Person list view with full-text search
 */

let _listFilter = '';

function renderList() {
  const activeId = getActiveId();
  const data = activeId ? getFamilyData(activeId) : null;
  const persons = data ? (data.persons || []) : [];
  const search = _listFilter.toLowerCase();

  const filtered = persons.filter(p => {
    if (!search) return true;
    return (
      (p.name || '').toLowerCase().includes(search) ||
      (p.description || '').toLowerCase().includes(search)
    );
  });

  const listEl = document.getElementById('person-list');
  const countEl = document.getElementById('person-count');

  countEl.textContent = `${filtered.length} of ${persons.length} person${persons.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="no-results">${search ? 'No matching persons found.' : 'No persons yet. Add one!'}</p>`;
    return;
  }

  listEl.innerHTML = '';
  filtered.forEach(person => {
    listEl.appendChild(buildPersonCard(person, data));
  });
}

function buildPersonCard(person, data) {
  const card = document.createElement('div');
  card.className = 'person-card';
  card.dataset.id = person.id;

  // Avatar
  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'avatar';
  const safeImgSrc = sanitizeImageUrl(person.image);
  if (safeImgSrc) {
    const img = document.createElement('img');
    img.src = safeImgSrc;
    img.alt = person.name;
    avatarDiv.appendChild(img);
  } else {
    avatarDiv.textContent = getInitials(person.name);
  }

  // Info
  const infoDiv = document.createElement('div');
  infoDiv.className = 'info';

  const nameEl = document.createElement('h3');
  nameEl.textContent = person.name || '—';

  const datesEl = document.createElement('div');
  datesEl.className = 'dates';
  const parts = [];
  if (person.birthDate) parts.push(`b. ${formatDate(person.birthDate)}`);
  if (person.deathDate) parts.push(`d. ${formatDate(person.deathDate)}`);
  datesEl.textContent = parts.join(' · ');

  // Status badge
  const badge = document.createElement('span');
  if (person.deathDate) {
    badge.className = 'badge deceased';
    badge.textContent = 'Deceased';
  } else {
    badge.className = 'badge living';
    badge.textContent = 'Living';
  }

  // Adopted badge
  const isAdopted = (data.persons || []).some(p =>
    p.id === person.id &&
    (p.parents || []).some(pr => pr.type === 'adopted')
  );

  if (isAdopted) {
    const adoptedBadge = document.createElement('span');
    adoptedBadge.className = 'badge adopted';
    adoptedBadge.textContent = 'Adopted';
    infoDiv.appendChild(nameEl);
    infoDiv.appendChild(datesEl);
    infoDiv.appendChild(badge);
    infoDiv.appendChild(adoptedBadge);
  } else {
    infoDiv.appendChild(nameEl);
    infoDiv.appendChild(datesEl);
    infoDiv.appendChild(badge);
  }

  if (person.description) {
    const descEl = document.createElement('div');
    descEl.className = 'desc';
    descEl.textContent = person.description;
    infoDiv.appendChild(descEl);
  }

  card.appendChild(avatarDiv);
  card.appendChild(infoDiv);

  card.addEventListener('click', () => showPersonDetail(person.id));
  return card;
}

function initList() {
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    _listFilter = searchInput.value;
    renderList();
  });
}
