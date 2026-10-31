import type { CacheStorage } from '../../src/infrastructure/cache/library-cache';
import { PersistentLibraryCache } from '../../src/infrastructure/cache/library-cache';

export class MemoryCacheStorage implements CacheStorage {
  index?: string;
  covers = new Map<string, ArrayBuffer>();
  indexWrites = 0;
  async readIndex() { return this.index; }
  async writeIndex(json: string) { this.index = json; this.indexWrites++; }
  async readCover(key: string) { return this.covers.get(key); }
  async writeCover(key: string, bytes: ArrayBuffer) { this.covers.set(key, bytes); }
  async removeCover(key: string) { this.covers.delete(key); }
  async listCovers() { return [...this.covers.keys()]; }
}
export function memoryCache() { return new PersistentLibraryCache(new MemoryCacheStorage()); }
