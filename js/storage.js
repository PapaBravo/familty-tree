/**
 * storage.js – localStorage persistence for Family Tree
 *
 * Keys:
 *   familyTree_families        – JSON array of {id, name}
 *   familyTree_data_{id}       – family data object {persons, partnerships}
 *   familyTree_active          – id of currently selected family
 */

const FAMILIES_KEY = 'familyTree_families';
const ACTIVE_KEY   = 'familyTree_active';

function dataKey(id) {
  return `familyTree_data_${id}`;
}

function getFamilies() {
  try {
    return JSON.parse(localStorage.getItem(FAMILIES_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveFamilies(families) {
  localStorage.setItem(FAMILIES_KEY, JSON.stringify(families));
}

function getActiveId() {
  return localStorage.getItem(ACTIVE_KEY) || null;
}

function setActiveId(id) {
  localStorage.setItem(ACTIVE_KEY, id);
}

function getFamilyData(id) {
  try {
    return JSON.parse(localStorage.getItem(dataKey(id)) || 'null');
  } catch {
    return null;
  }
}

function saveFamilyData(id, data) {
  localStorage.setItem(dataKey(id), JSON.stringify(data));
}

function deleteFamilyData(id) {
  localStorage.removeItem(dataKey(id));
}

function createFamily(name, data) {
  const id = generateId();
  const families = getFamilies();
  families.push({ id, name });
  saveFamilies(families);
  saveFamilyData(id, data || { persons: [], partnerships: [] });
  return id;
}

function renameFamily(id, name) {
  const families = getFamilies();
  const entry = families.find(f => f.id === id);
  if (entry) {
    entry.name = name;
    saveFamilies(families);
  }
}

function deleteFamily(id) {
  const families = getFamilies().filter(f => f.id !== id);
  saveFamilies(families);
  deleteFamilyData(id);
}

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
