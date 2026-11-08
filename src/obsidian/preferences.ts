import type { DataAdapter } from 'obsidian';
import type { PreferencesStorage } from '../domain/preferences';

export function createObsidianPreferencesStorage(adapter: DataAdapter, directory: string): PreferencesStorage {
  const path = `${directory}/data.json`;
  return {
    async read() {
      return await adapter.exists(path) ? JSON.parse(await adapter.read(path)) as unknown : undefined;
    },
    async update(change) {
      if (await adapter.exists(path)) {
        await adapter.process(path, json => JSON.stringify(change(JSON.parse(json)), null, 2));
      } else {
        await adapter.write(path, JSON.stringify(change(undefined), null, 2));
      }
    },
  };
}
