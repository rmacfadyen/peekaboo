// Peekaboo — tiny key/value store on IndexedDB.
// Everything is written as it happens so a session survives reloads and navigation
// within the same origin.
//
// Keys:
//   session              session object (metadata, screenshot/annotation/audio index, events)
//   heartbeat            epoch ms of the last moment the session was alive in a page
//   shot-NNN             PNG Blob
//   annotation-NNN       annotation object including raw strokes
//   audio-NNN-CCCCCC     audio Blob chunk CCCCCC of segment NNN
(function () {
  'use strict';
  const P = (window.__peekaboo = window.__peekaboo || {});

  const DB_NAME = 'peekaboo-userscript';
  const STORE = 'kv';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  P.store = {
    get: (key) => run('readonly', (s) => s.get(key)),
    set: (key, value) => run('readwrite', (s) => s.put(value, key)),
    del: (key) => run('readwrite', (s) => s.delete(key)),
    clear: () => run('readwrite', (s) => s.clear()),
    // Keys starting with prefix, in ascending order.
    keys: (prefix) =>
      run('readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿')))
  };

  P.pad = (n, width) => String(n).padStart(width, '0');
})();
