import type { PreferencesStorage } from '../src/domain/preferences';

export const PREFERENCES_KEY = 'just-book-reader-preferences';

export function createBrowserPreferencesStorage(): PreferencesStorage {
  function read(): unknown {
    const json = localStorage.getItem(PREFERENCES_KEY);
    return json === null ? undefined : JSON.parse(json) as unknown;
  }
  return {
    async read() {
      return read();
    },
    async update(change) {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(change(read())));
    },
  };
}
