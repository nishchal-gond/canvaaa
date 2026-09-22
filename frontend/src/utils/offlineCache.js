// Offline IndexedDB storage for 100% resilient 24/7 digital signage playback
// Stores full-resolution slide blobs directly on the display device so playback NEVER goes black
const DB_NAME = 'LPH_Signage_Storage';
const STORE_NAME = 'slides_blobs';
const META_STORE = 'signage_meta';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return resolve(null);
    }
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function saveSlideBlob(key, blob) {
  try {
    const db = await openDB();
    if (!db) return false;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function getSlideBlob(key) {
  try {
    const db = await openDB();
    if (!db) return null;
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveSignageMeta(key, data) {
  try {
    const db = await openDB();
    if (!db) return false;
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(data, key);
    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function getSignageMeta(key) {
  try {
    const db = await openDB();
    if (!db) return null;
    const tx = db.transaction(META_STORE, 'readonly');
    const req = tx.objectStore(META_STORE).get(key);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
