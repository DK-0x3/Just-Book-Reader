import type { CacheStorage } from '../src/infrastructure/cache/library-cache';

/** Cache survives reloads; File selection does not. */
export function createBrowserCacheStorage(): CacheStorage {
  let database: Promise<IDBDatabase> | undefined;
  function open(): Promise<IDBDatabase> {
    return database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('just-book-reader-dev-cache', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('cache');
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('cache-blocked'));
    });
  }
  async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cache', mode);
      const request = operation(tx.objectStore('cache'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('cache-transaction'));
    });
  }
  return {
    async readIndex() {
      return transaction<string | undefined>('readonly', store => store.get('index'));
    },
    async writeIndex(json) {
      await transaction('readwrite', store => store.put(json, 'index'));
    },
    async readCover(key) {
      return transaction<ArrayBuffer | undefined>('readonly', store => store.get(`cover:${key}`));
    },
    async writeCover(key, bytes) {
      await transaction('readwrite', store => store.put(bytes, `cover:${key}`));
    },
    async removeCover(key) {
      await transaction('readwrite', store => store.delete(`cover:${key}`));
    },
    async listCovers() {
      return (await transaction('readonly', store => store.getAllKeys())).filter((key): key is string => typeof key === 'string' && key.startsWith('cover:')).map(key => key.slice(6));
    },
  };
}
