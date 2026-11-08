import { describe, expect, it, vi } from 'vitest';
import type { DataAdapter } from 'obsidian';
import { readTheme, withTheme } from '../src/app/preferences';
import { PreferencesService } from '../src/app/preferences-service';
import { createObsidianPreferencesStorage } from '../src/obsidian/preferences';
import type { GalleryTheme, PreferencesStorage } from '../src/domain/preferences';

function memoryStorage(initial?: unknown) {
  let data = initial;
  const storage: PreferencesStorage = {
    read: vi.fn(async () => data),
    update: vi.fn(async change => {
      data = change(data);
    }),
  };
  return {
    storage, data: () => data, replace: (value: unknown) => {
      data = value;
    }
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('theme preference format', () => {
  it('defaults missing data and missing profiles to Obsidian without adding future settings', () => {
    expect(readTheme(undefined, 'desktop')).toBe('obsidian');
    expect(readTheme({ schemaVersion: 1 }, 'mobile')).toBe('obsidian');
    expect(withTheme(undefined, 'desktop', 'sepia')).toEqual({ schemaVersion: 1, profiles: { desktop: { galleryTheme: 'sepia' } } });
  });

  it('merges immutably and preserves unknown root fields, profile fields and other profiles', () => {
    const mobile = Object.freeze({ galleryTheme: 'eink', extra: { keep: true } });
    const desktop = Object.freeze({ galleryTheme: 'dark', custom: 'keep' });
    const source = Object.freeze({ schemaVersion: 1, unknown: ['keep'], profiles: Object.freeze({ desktop, mobile, tablet: { custom: 7 } }) });
    const changed = withTheme(source, 'desktop', 'light');
    expect(changed).toEqual({
      schemaVersion: 1, unknown: ['keep'], profiles: {
        desktop: { galleryTheme: 'light', custom: 'keep' }, mobile, tablet: { custom: 7 },
      }
    });
    expect(readTheme(source, 'desktop')).toBe('dark');
    expect(readTheme(changed, 'mobile')).toBe('eink');
    expect(changed).not.toBe(source);
  });

  it.each([null, [], false, 'invalid', {}, { schemaVersion: 2 }, { schemaVersion: 1, profiles: [] },
    { schemaVersion: 1, profiles: { desktop: null } }, { schemaVersion: 1, profiles: { desktop: { galleryTheme: 'future' } } }])(
      'refuses malformed/future data without replacing it: %j', data => {
        expect(() => readTheme(data, 'desktop')).toThrow();
        expect(() => withTheme(data, 'desktop', 'dark')).toThrow();
      });

  it('validates a runtime theme value and leaves unknown profiles untouched', () => {
    expect(() => withTheme(undefined, 'desktop', 'invalid' as GalleryTheme)).toThrow('invalid-theme');
    const source = { schemaVersion: 1, profiles: { other: 'opaque future data' } };
    expect(withTheme(source, 'desktop', 'dark')).toMatchObject({ profiles: { other: 'opaque future data', desktop: { galleryTheme: 'dark' } } });
  });
});

describe('host preference service', () => {
  it('loads once, notifies subscribers and keeps the selected device profile', async () => {
    const s = memoryStorage({ schemaVersion: 1, profiles: { desktop: { galleryTheme: 'light' }, mobile: { galleryTheme: 'eink' } } });
    const service = new PreferencesService(s.storage, 'mobile');
    const listener = vi.fn();
    const stop = service.subscribe(listener);
    await Promise.all([service.load(), service.load()]);
    expect(s.storage.read).toHaveBeenCalledOnce();
    expect(service.snapshot()).toEqual({ theme: 'eink', loading: false, saving: false, error: undefined });
    stop();
    const calls = listener.mock.calls.length;
    await service.setTheme('sepia');
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(readTheme(s.data(), 'desktop')).toBe('light');
    expect(readTheme(s.data(), 'mobile')).toBe('sepia');
    service.dispose();
  });

  it('serializes rapid changes and merges each against the latest document', async () => {
    const s = memoryStorage({ schemaVersion: 1 });
    const gate = deferred();
    let active = 0;
    let peak = 0;
    let updates = 0;
    s.storage.update = vi.fn(async change => {
      active++; peak = Math.max(peak, active);
      if (++updates === 1) await gate.promise;
      s.replace(change(s.data()));
      active--;
    });
    const service = new PreferencesService(s.storage, 'desktop');
    await service.load();
    const first = service.setTheme('dark');
    const second = service.setTheme('sepia');
    await vi.waitFor(() => expect(s.storage.update).toHaveBeenCalledOnce(), { interval: 1 });
    expect(service.snapshot()).toMatchObject({ theme: 'sepia', saving: true });
    s.replace({ schemaVersion: 1, keep: 42, profiles: { mobile: { galleryTheme: 'eink' } } });
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    await service.flush();
    expect(peak).toBe(1);
    expect(service.snapshot()).toMatchObject({ theme: 'sepia', saving: false, error: undefined });
    expect(s.data()).toEqual({ schemaVersion: 1, keep: 42, profiles: { mobile: { galleryTheme: 'eink' }, desktop: { galleryTheme: 'sepia' } } });
    service.dispose();
  });

  it('rolls back a failed write, hides raw errors and allows the next queued change', async () => {
    const s = memoryStorage(withTheme(undefined, 'desktop', 'light'));
    const original = s.storage.update;
    s.storage.update = vi.fn().mockRejectedValueOnce(new Error('private filesystem detail')).mockImplementation(original);
    const service = new PreferencesService(s.storage, 'desktop');
    await service.load();
    expect(await service.setTheme('dark')).toBe(false);
    expect(service.snapshot()).toMatchObject({ theme: 'light', saving: false, error: 'save' });
    expect(JSON.stringify(service.snapshot())).not.toContain('filesystem');
    expect(await service.setTheme('sepia')).toBe(true);
    expect(service.snapshot()).toMatchObject({ theme: 'sepia', error: undefined });
    service.dispose();
  });

  it('keeps the latest requested theme visible and rolls back its failure to the last successful write', async () => {
    const s = memoryStorage();
    const gate = deferred();
    const original = s.storage.update;
    let count = 0;
    s.storage.update = vi.fn(async change => {
      if (++count === 1) {
        await gate.promise;
        await original(change);
      }
      else throw new Error('failed later write');
    });
    const service = new PreferencesService(s.storage, 'desktop');
    await service.load();
    const first = service.setTheme('dark');
    const latest = service.setTheme('light');
    await vi.waitFor(() => expect(s.storage.update).toHaveBeenCalledOnce(), { interval: 1 });
    expect(service.snapshot()).toMatchObject({ theme: 'light', saving: true });
    gate.resolve();
    expect(await Promise.all([first, latest])).toEqual([true, false]);
    expect(service.snapshot()).toMatchObject({ theme: 'dark', saving: false, error: 'save' });
    expect(readTheme(s.data(), 'desktop')).toBe('dark');
    service.dispose();
  });

  it('does not replace a pending choice when the initial read completes', async () => {
    const s = memoryStorage(withTheme(undefined, 'desktop', 'dark'));
    const gate = deferred();
    const read = s.storage.read;
    s.storage.read = vi.fn(async () => {
      await gate.promise;
      return read();
    });
    const service = new PreferencesService(s.storage, 'desktop');
    const writing = service.setTheme('light');
    expect(service.snapshot()).toMatchObject({ theme: 'light', loading: true, saving: true });
    gate.resolve();
    expect(await writing).toBe(true);
    expect(service.snapshot()).toMatchObject({ theme: 'light', loading: false, saving: false });
    service.dispose();
  });

  it('does not expose an older failed write as the error of a newer pending choice', async () => {
    const s = memoryStorage();
    const firstGate = deferred();
    const lastGate = deferred();
    const update = s.storage.update;
    let count = 0;
    s.storage.update = vi.fn(async change => {
      if (++count === 1) {
        await firstGate.promise;
        throw new Error('older request failed');
      }
      await lastGate.promise;
      await update(change);
    });
    const service = new PreferencesService(s.storage, 'desktop');
    await service.load();
    const first = service.setTheme('dark');
    const latest = service.setTheme('sepia');
    firstGate.resolve();
    await vi.waitFor(() => expect(s.storage.update).toHaveBeenCalledTimes(2), { interval: 1 });
    expect(service.snapshot()).toMatchObject({ theme: 'sepia', saving: true, error: undefined });
    lastGate.resolve();
    expect(await Promise.all([first, latest])).toEqual([false, true]);
    service.dispose();
  });

  it('rejects writes against a corrupt/future document, including a document changed since loading', async () => {
    const s = memoryStorage({ schemaVersion: 2, data: 'keep' });
    const service = new PreferencesService(s.storage, 'desktop');
    await service.load();
    expect(service.snapshot()).toMatchObject({ theme: 'obsidian', error: 'load' });
    expect(await service.setTheme('light')).toBe(false);
    expect(s.data()).toEqual({ schemaVersion: 2, data: 'keep' });
    s.replace(withTheme(undefined, 'desktop', 'light'));
    expect(await service.setTheme('dark')).toBe(true);
    s.replace({ schemaVersion: 99, data: 'newer' });
    expect(await service.setTheme('sepia')).toBe(false);
    expect(service.snapshot().theme).toBe('dark');
    expect(s.data()).toEqual({ schemaVersion: 99, data: 'newer' });
    service.dispose();
  });

  it('finishes authorized writes after disposal, stops notifications and refuses new requests', async () => {
    const s = memoryStorage();
    const gate = deferred();
    const original = s.storage.update;
    s.storage.update = vi.fn(async change => {
      await gate.promise;
      await original(change);
    });
    const service = new PreferencesService(s.storage, 'desktop');
    await service.load();
    const listener = vi.fn();
    service.subscribe(listener);
    const writing = service.setTheme('dark');
    await vi.waitFor(() => expect(s.storage.update).toHaveBeenCalledOnce(), { interval: 1 });
    service.dispose();
    const calls = listener.mock.calls.length;
    gate.resolve();
    expect(await writing).toBe(true);
    expect(await service.setTheme('light')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(readTheme(s.data(), 'desktop')).toBe('dark');
  });
});

describe('native preference storage', () => {
  function storage(json?: string) {
    let contents = json;
    const adapter = {
      exists: vi.fn(async () => contents !== undefined), read: vi.fn(async () => contents),
      write: vi.fn(async (_path: string, next: string) => {
        contents = next;
      }),
      process: vi.fn(async (_path: string, change: (value: string) => string) => {
        contents = change(contents ?? '');
        return contents;
      }),
    };
    return { adapter, port: createObsidianPreferencesStorage(adapter as unknown as DataAdapter, '.obsidian/plugins/just-book-reader'), contents: () => contents };
  }

  it('creates missing data and updates existing data through the adapter process API', async () => {
    const s = storage();
    const service = new PreferencesService(s.port, 'desktop');
    await service.load();
    expect(await service.setTheme('dark')).toBe(true);
    expect(s.adapter.write).toHaveBeenCalledOnce();
    expect(s.adapter.write.mock.calls[0]?.[0]).toBe('.obsidian/plugins/just-book-reader/data.json');
    expect(await service.setTheme('sepia')).toBe(true);
    expect(s.adapter.process).toHaveBeenCalledOnce();
    expect(readTheme(JSON.parse(s.contents() ?? ''), 'desktop')).toBe('sepia');
    service.dispose();
  });

  it.each(['{broken', 'null', '{"schemaVersion":9,"keep":true}'])(
    'preserves raw malformed/future JSON %s when loading and saving fail', async json => {
      const s = storage(json);
      const service = new PreferencesService(s.port, 'desktop');
      await service.load();
      expect(service.snapshot().error).toBe('load');
      expect(await service.setTheme('dark')).toBe(false);
      expect(s.contents()).toBe(json);
      expect(s.adapter.write).not.toHaveBeenCalled();
      service.dispose();
    });
});
