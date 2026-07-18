// storage.js — IndexedDB persistence for the raw event log plus a small meta
// store for recording state. Everything stays local; nothing leaves the
// machine. Used by the service worker (not the Node tests).

const DB_NAME = "workflow-recorder";
const DB_VERSION = 1;
const EVENTS = "events";
const META = "meta";

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(EVENTS)) {
          d.createObjectStore(EVENTS, { keyPath: "id" });
        }
        if (!d.objectStoreNames.contains(META)) {
          d.createObjectStore(META, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const s = t.objectStore(store);
        let result;
        Promise.resolve(fn(s)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export async function appendEvent(ev) {
  await tx(EVENTS, "readwrite", (s) => s.put(ev));
}

export async function appendEvents(list) {
  await tx(EVENTS, "readwrite", (s) => {
    for (const ev of list) s.put(ev);
  });
}

export function getAllEvents() {
  return tx(EVENTS, "readonly", (s) => reqToPromise(s.getAll()));
}

export function countEvents() {
  return tx(EVENTS, "readonly", (s) => reqToPromise(s.count()));
}

export async function clearAll() {
  await tx(EVENTS, "readwrite", (s) => s.clear());
}

export async function setMeta(key, value) {
  await tx(META, "readwrite", (s) => s.put({ key, value }));
}

export async function getMeta(key, fallback = null) {
  const row = await tx(META, "readonly", (s) => reqToPromise(s.get(key)));
  return row ? row.value : fallback;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
