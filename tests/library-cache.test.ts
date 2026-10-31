import { describe, expect, it, vi } from 'vitest';
import { PersistentLibraryCache, MAX_DISK_COVERS, MAX_DISK_COVER_BYTES } from '../src/infrastructure/cache/library-cache';
import { MemoryCacheStorage } from './fixtures/cache';
import type { BookFile } from '../src/domain/library';

const file = (path = 'Books/One.epub', mtime = 1): BookFile => ({ path, name: path, size: 100, mtime });
const signal = () => new AbortController().signal;
const image = () => new Blob(['image bytes'], { type: 'image/png' });

describe('persistent metadata and cover cache', () => {
  it('restores text and binary covers in a fresh instance without storing temporary URLs or EPUB buffers', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new PersistentLibraryCache(storage);
    await cache.put({ ...file(), coverUrl: 'blob:temporary' } as BookFile, { title: 'Title', author: 'Author', cover: image() }, signal());
    await cache.flush();
    expect(storage.index).not.toContain('blob:');
    expect(storage.index).not.toContain('image bytes');
    const reopened = new PersistentLibraryCache(storage);
    await reopened.open();
    expect(reopened.get(file())).toMatchObject({ title: 'Title', author: 'Author', hasCover: true });
    expect(await (await reopened.readCover(file(), signal()))?.text()).toBe('image bytes');
    expect(reopened.get(file(undefined, 2))).toBeUndefined();
    await reopened.flush();
  });

  it('batches index writes and records that an EPUB has no cover', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new PersistentLibraryCache(storage);
    for (let i = 0; i < 20; i++) await cache.put(file(`${i}.epub`), { title: `${i}` }, signal());
    expect(storage.indexWrites).toBe(0);
    await cache.flush();
    expect(storage.indexWrites).toBe(1);
    expect(cache.get(file('0.epub'))).toMatchObject({ hasCover: false });
    expect(storage.covers.size).toBe(0);
  });

  it.each(['{broken', 'null', '{"version":2,"books":[]}', '{"version":1,"books":[{"path":"bad"}]}'])(
    'preserves corrupt or future index %s and does not delete its files', async json => {
      const storage = new MemoryCacheStorage();
      storage.index = json;
      storage.covers.set(crypto.randomUUID(), new ArrayBuffer(1));
      const cache = new PersistentLibraryCache(storage);
      await cache.open();
      await cache.put(file(), { title: 'Replacement', cover: image() }, signal());
      await cache.retain([]);
      await cache.flush();
      expect(cache.failed).toBe(true);
      expect(storage.index).toBe(json);
      expect(storage.covers.size).toBe(1);
      expect(storage.indexWrites).toBe(0);
    });

  it('removes stale/deleted entries and reclaims unreferenced covers after committing the index', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new PersistentLibraryCache(storage);
    await cache.put(file('one.epub'), { cover: image() }, signal());
    await cache.put(file('two.epub'), { cover: image() }, signal());
    await cache.flush();
    await cache.retain([file('one.epub', 2)]);
    expect(cache.get(file('one.epub'))).toBeUndefined();
    await cache.flush();
    expect(storage.covers.size).toBe(0);
    expect(JSON.parse(storage.index!).books).toEqual([]);
    storage.covers.set(crypto.randomUUID(), new ArrayBuffer(1));
    const reopened = new PersistentLibraryCache(storage);
    await reopened.open();
    await reopened.flush();
    expect(storage.covers.size).toBe(0);
  });

  it('keeps searchable text when a cover file is missing or truncated', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new PersistentLibraryCache(storage);
    await cache.put(file(), { title: 'Known title', cover: image() }, signal());
    await cache.flush();
    storage.covers.clear();
    expect(await cache.readCover(file(), signal())).toBeUndefined();
    expect(cache.get(file())).toMatchObject({ title: 'Known title', hasCover: true, cover: undefined });
    await cache.flush();
  });

  it('evicts persistent covers by count without evicting metadata', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new PersistentLibraryCache(storage);
    for (let i = 0; i < MAX_DISK_COVERS; i++) await cache.put(file(`${i}.epub`), { title: `Title ${i}`, cover: image() }, signal());
    await cache.readCover(file('0.epub'), signal());
    await cache.put(file(`${MAX_DISK_COVERS}.epub`), { title: 'Last', cover: image() }, signal());
    await cache.flush();
    expect(storage.covers.size).toBe(MAX_DISK_COVERS);
    expect(cache.get(file('0.epub'))?.cover).toBeDefined();
    expect(cache.get(file('1.epub'))).toMatchObject({ title: 'Title 1', hasCover: true, cover: undefined });
    expect(JSON.parse(storage.index!).books).toHaveLength(MAX_DISK_COVERS + 1);
  });

  it('enforces the byte quota on restored data and retains the most recently used cover', async () => {
    const storage = new MemoryCacheStorage();
    const bytes = 8 * 1024 * 1024;
    const count = MAX_DISK_COVER_BYTES / bytes + 1;
    const books = Array.from({ length: count }, (_, i) => ({ ...file(`${i}.epub`), title: `Title ${i}`, hasCover: true,
      cover: { key: crypto.randomUUID(), size: bytes, type: 'image/png', used: i } }));
    for (const book of books) storage.covers.set(book.cover.key, new ArrayBuffer(0));
    storage.index = JSON.stringify({ version: 1, books });
    const cache = new PersistentLibraryCache(storage);
    await cache.open();
    await cache.flush();
    expect(storage.covers.size).toBe(count - 1);
    expect(cache.get(file('0.epub'))?.cover).toBeUndefined();
    expect(cache.get(file(`${count - 1}.epub`))?.cover).toBeDefined();
  });

  it('does not commit data after cancellation during a cover write', async () => {
    const storage = new MemoryCacheStorage();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const write = storage.writeCover.bind(storage);
    const writing = vi.spyOn(storage, 'writeCover').mockImplementation(async (key, data) => { await write(key, data); await gate; });
    const cache = new PersistentLibraryCache(storage);
    const controller = new AbortController();
    const saving = cache.put(file(), { title: 'Cancelled', cover: image() }, controller.signal);
    await vi.waitFor(() => expect(writing).toHaveBeenCalledOnce(), { interval: 1 });
    controller.abort();
    finish();
    await saving;
    await cache.flush();
    expect(cache.get(file())).toBeUndefined();
    expect(storage.covers.size).toBe(0);
  });

  it('preserves the previous index and cover if writing a newer index fails', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new PersistentLibraryCache(storage);
    await cache.put(file(), { title: 'Old', cover: image() }, signal());
    await cache.flush();
    const original = storage.index;
    const oldKey = cache.get(file())?.cover?.key;
    vi.spyOn(storage, 'writeIndex').mockRejectedValue(new Error('disk full'));
    await cache.put(file(undefined, 2), { title: 'New', cover: image() }, signal());
    await cache.flush();
    expect(cache.failed).toBe(true);
    expect(storage.index).toBe(original);
    expect(storage.covers.has(oldKey!)).toBe(true);
  });
});
