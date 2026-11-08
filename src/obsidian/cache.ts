import type { DataAdapter } from 'obsidian';
import type { CacheStorage } from '../infrastructure/cache/library-cache';

export function createObsidianCacheStorage(adapter: DataAdapter, pluginDirectory: string): CacheStorage {
  const root = `${pluginDirectory}/cache`;
  const covers = `${root}/covers`;
  const index = `${root}/index.json`;
  const coverPath = (key: string) => {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('invalid-cache-key');
    return `${covers}/${key}`;
  };
  async function prepare(): Promise<void> {
    if (!await adapter.exists(root)) await adapter.mkdir(root);
    if (!await adapter.exists(covers)) await adapter.mkdir(covers);
  }
  return {
    async readIndex() {
      return await adapter.exists(index) ? adapter.read(index) : undefined;
    },
    async writeIndex(json) {
      await prepare();
      if (await adapter.exists(index)) await adapter.process(index, () => json);
      else await adapter.write(index, json);
    },
    async readCover(key) {
      const path = coverPath(key);
      return await adapter.exists(path) ? adapter.readBinary(path) : undefined;
    },
    async writeCover(key, bytes) {
      await prepare();
      await adapter.writeBinary(coverPath(key), bytes);
    },
    async removeCover(key) {
      const path = coverPath(key);
      if (await adapter.exists(path)) await adapter.remove(path);
    },
    async listCovers() {
      if (!await adapter.exists(covers)) return [];
      return (await adapter.list(covers)).files.map(path => path.slice(covers.length + 1)).filter(key => /^[a-f0-9-]{36}$/.test(key));
    },
  };
}
