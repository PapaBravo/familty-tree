/**
 * images.js – IndexedDB blob storage for person photos
 *
 * Each record: { key: "{familyId}_{personId}", blob: Blob }
 * Object store: "photos"
 */

const IDB_NAME    = 'familyTreeImages';
const IDB_VERSION = 1;
const STORE_NAME  = 'photos';

let _db = null;

function openImagesDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function imageKey(familyId, personId) {
  return `${familyId}_${personId}`;
}

/** Store a Blob for a person. Returns a Promise. */
async function savePersonImage(familyId, personId, blob) {
  const db = await openImagesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, imageKey(familyId, personId));
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

/** Retrieve a Blob (or null) for a person. Returns a Promise<Blob|null>. */
async function getPersonImage(familyId, personId) {
  const db = await openImagesDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(imageKey(familyId, personId));
    req.onsuccess = e => resolve(e.target.result || null);
    req.onerror   = e => reject(e.target.error);
  });
}

/** Delete the image blob for a person. Returns a Promise. */
async function deletePersonImage(familyId, personId) {
  const db = await openImagesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(imageKey(familyId, personId));
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

/** Delete all images belonging to a family. Returns a Promise. */
async function deleteAllFamilyImages(familyId) {
  const db = await openImagesDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAllKeys();
    req.onsuccess = e => {
      const keys = e.target.result.filter(k => k.startsWith(familyId + '_'));
      keys.forEach(k => store.delete(k));
    };
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

/**
 * Load all images for a family into an object-URL map.
 * Returns Promise<Map<personId, objectURL>>
 *
 * Callers are responsible for calling URL.revokeObjectURL when done.
 */
async function loadFamilyImageCache(familyId, personIds) {
  const cache = new Map();
  if (!personIds || personIds.length === 0) return cache;

  const db = await openImagesDB();

  await Promise.all(personIds.map(personId =>
    new Promise(resolve => {
      const tx  = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(imageKey(familyId, personId));
      req.onsuccess = e => {
        const blob = e.target.result;
        if (blob) {
          cache.set(personId, URL.createObjectURL(blob));
        }
        resolve();
      };
      req.onerror = () => resolve(); // ignore per-image errors
    })
  ));

  return cache;
}

/**
 * Retrieve all image blobs for a family.
 * Returns Promise<Map<personId, Blob>>
 */
async function getAllFamilyImageBlobs(familyId) {
  const db = await openImagesDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const result = new Map();
    const prefix = familyId + '_';

    const cursorReq = store.openCursor();
    cursorReq.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) { resolve(result); return; }
      if (cursor.key.startsWith(prefix)) {
        const personId = cursor.key.slice(prefix.length);
        result.set(personId, cursor.value);
      }
      cursor.continue();
    };
    cursorReq.onerror = e => reject(e.target.error);
  });
}

/** Guess a file extension from a Blob's MIME type. */
function imageExtension(blob) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/gif':  'gif',
    'image/webp': 'webp',
  };
  return map[blob.type] || 'jpg';
}
