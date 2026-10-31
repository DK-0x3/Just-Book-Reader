import { describe, expect, it, vi } from 'vitest';
import type { DataAdapter } from 'obsidian';
import { createObsidianCacheStorage } from '../src/obsidian/cache';
import { PersistentLibraryCache } from '../src/infrastructure/cache/library-cache';

function setup() {
  const files = new Map<string, string | ArrayBuffer>();
  const dirs = new Set<string>(['.obsidian/plugins/just-book-reader']);
  const adapter = {
    exists: vi.fn(async (path: string) => files.has(path) || dirs.has(path)),
    mkdir: vi.fn(async (path: string) => { dirs.add(path); }),
    read: vi.fn(async (path: string) => files.get(path) as string),
    readBinary: vi.fn(async (path: string) => files.get(path) as ArrayBuffer),
    write: vi.fn(async (path: string, json: string) => { files.set(path, json); }),
    process: vi.fn(async (path: string, transform: (value: string) => string) => { const value = transform(files.get(path) as string); files.set(path, value); return value; }),
    writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => { files.set(path, data); }),
    remove: vi.fn(async (path: string) => { files.delete(path); }),
    list: vi.fn(async (folder: string) => ({ files: [...files.keys()].filter(path => path.startsWith(`${folder}/`)), folders: [] })),
  };
  const storage = createObsidianCacheStorage(adapter as unknown as DataAdapter, '.obsidian/plugins/just-book-reader');
  return { adapter, storage, files };
}

describe('Obsidian cache storage', () => {
  it('persists only in the plugin cache directory and restores a fresh cache instance', async () => {
    const s = setup();
    const book = { path: 'Books/001.epub', name: '001', size: 100, mtime: 1 };
    const first = new PersistentLibraryCache(s.storage);
    await first.put(book, { title: 'Title', cover: new Blob(['image'], { type: 'image/png' }) }, new AbortController().signal);
    await first.flush();
    expect([...s.files.keys()].every(path => path.startsWith('.obsidian/plugins/just-book-reader/cache/'))).toBe(true);
    const reopened = new PersistentLibraryCache(s.storage);
    await reopened.open();
    expect(reopened.get(book)?.title).toBe('Title');
    expect(await (await reopened.readCover(book, new AbortController().signal))?.text()).toBe('image');
    await reopened.remove(book.path);
    await reopened.flush();
    expect(s.adapter.process).toHaveBeenCalled();
    expect(s.adapter.remove).toHaveBeenCalledOnce();
    expect(s.files.size).toBe(1);
  });

  it('rejects paths in cover keys and ignores unrelated files when reclaiming cache orphans', async () => {
    const s = setup();
    s.files.set('.obsidian/plugins/just-book-reader/cache/covers/notes.txt', 'keep');
    await expect(s.storage.readCover('../outside')).rejects.toThrow('invalid-cache-key');
    await expect(s.storage.writeCover('../../Books/book.epub', new ArrayBuffer(0))).rejects.toThrow('invalid-cache-key');
    const cache = new PersistentLibraryCache(s.storage);
    await cache.open();
    await cache.flush();
    expect(s.adapter.remove).not.toHaveBeenCalled();
  });
});
