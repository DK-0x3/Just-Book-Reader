import { describe, expect, it, vi } from 'vitest';
import { LibraryService } from '../src/app/library-service';
import { LibraryWorkBudget } from '../src/app/library-work-budget';
import { PersistentLibraryCache } from '../src/infrastructure/cache/library-cache';
import { MemoryCacheStorage } from './fixtures/cache';
import { filterBooks, type BookFile, type BookVault, type LibrarySnapshot, type MetadataReader, type VaultChange } from '../src/domain/library';

const file = (path: string, size = 10, mtime = 1): BookFile => ({ path, name: path.replace(/\.epub$/, ''), size, mtime });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(files: BookFile[], cache = new PersistentLibraryCache(new MemoryCacheStorage()), budget = new LibraryWorkBudget(),
  reader: MetadataReader = async () => ({ title: 'Indexed title', author: 'Hidden author', cover: new Blob(['cover'], { type: 'image/png' }) })) {
  let change!: (value: VaultChange) => void;
  const read = vi.fn(async (_file: BookFile, _signal: AbortSignal) => new ArrayBuffer(1));
  const vault: BookVault = { list: async () => files, read, subscribe: listener => { change = listener; return () => {}; } };
  const service = new LibraryService(vault, reader, cache, budget);
  let snapshot: LibrarySnapshot = { books: [], scanning: false };
  const notify = vi.fn((value: LibrarySnapshot) => { snapshot = value; });
  service.subscribe(notify);
  return { service, read, change: (value: VaultChange) => change(value), snapshot: () => snapshot, notify, cache };
}
const wait = (check: () => void) => vi.waitFor(check, { interval: 1 });

describe('whole-library index and shared scheduling', () => {
  it('indexes hidden books, stores their covers without creating URLs and reopens with zero EPUB reads', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new PersistentLibraryCache(storage);
    const files = [file('001.epub'), file('002.epub'), file('003.epub')];
    const create = vi.spyOn(URL, 'createObjectURL');
    const first = setup(files, cache);
    await first.service.scan();
    await wait(() => expect(first.snapshot().indexing).toEqual({ completed: 3, total: 3, failed: 0 }));
    await cache.flush();
    expect(filterBooks(first.snapshot().books, 'hidden AUTHOR')).toHaveLength(3);
    expect(first.read).toHaveBeenCalledTimes(3);
    expect(storage.covers.size).toBe(3);
    expect(create).not.toHaveBeenCalled();
    first.service.destroy();
    const reopened = setup(files, new PersistentLibraryCache(storage));
    await reopened.service.scan();
    expect(reopened.snapshot().indexing?.completed).toBe(3);
    expect(reopened.snapshot().books[0]?.title).toBe('Indexed title');
    reopened.service.setVisible('001.epub', true);
    await wait(() => expect(reopened.snapshot().books[0]?.coverUrl).toBeDefined());
    await reopened.service.scan();
    expect(reopened.read).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledOnce();
    reopened.service.destroy();
    create.mockRestore();
  });

  it('promotes a visible book ahead of queued background books without duplicating a running task', async () => {
    const s = setup([file('a.epub'), file('b.epub'), file('c.epub'), file('d.epub')]);
    const first = deferred<ArrayBuffer>();
    const next = deferred<ArrayBuffer>();
    s.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    await s.service.scan();
    await wait(() => expect(s.read).toHaveBeenCalledOnce());
    expect(s.read.mock.calls[0]?.[0].path).toBe('a.epub');
    s.service.setVisible('d.epub', true);
    s.service.setVisible('d.epub', true);
    expect(s.read.mock.calls.map(([book]) => book.path)).toEqual(['a.epub', 'd.epub']);
    s.service.setVisible('a.epub', true);
    s.service.setVisible('a.epub', false);
    expect(s.read.mock.calls[0]?.[1].aborted).toBe(false);
    first.resolve(new ArrayBuffer(1));
    next.resolve(new ArrayBuffer(1));
    await wait(() => expect(s.snapshot().indexing?.completed).toBe(4));
    expect(s.read.mock.calls.filter(([book]) => book.path === 'a.epub')).toHaveLength(1);
    expect(s.read.mock.calls.filter(([book]) => book.path === 'd.epub')).toHaveLength(1);
    s.service.destroy();
  });

  it('runs only one background job even when another slot is available', async () => {
    const gate = deferred<ArrayBuffer>();
    const s = setup([file('a.epub'), file('b.epub'), file('c.epub')]);
    s.read.mockReturnValueOnce(gate.promise);
    await s.service.scan();
    await wait(() => expect(s.read).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(s.read).toHaveBeenCalledOnce();
    gate.resolve(new ArrayBuffer(1));
    await wait(() => expect(s.snapshot().indexing?.completed).toBe(3));
    s.service.destroy();
  });

  it('processes large EPUBs separately within the shared source-buffer budget', async () => {
    const gate = deferred<ArrayBuffer>();
    const s = setup([file('a.epub', 80 * 1024 * 1024), file('b.epub', 80 * 1024 * 1024)]);
    s.read.mockReturnValueOnce(gate.promise);
    await s.service.scan();
    s.service.setVisible('a.epub', true);
    s.service.setVisible('b.epub', true);
    expect(s.read).toHaveBeenCalledOnce();
    gate.resolve(new ArrayBuffer(1));
    await wait(() => expect(s.snapshot().indexing?.completed).toBe(2));
    expect(s.read).toHaveBeenCalledTimes(2);
    s.service.destroy();
  });

  it('keeps cancelled native reads in the shared budget across view close and reopen', async () => {
    const cache = new PersistentLibraryCache(new MemoryCacheStorage());
    const budget = new LibraryWorkBudget();
    const files = [file('a.epub'), file('b.epub')];
    const gates = [deferred<ArrayBuffer>(), deferred<ArrayBuffer>()];
    const first = setup(files, cache, budget);
    first.read.mockReturnValueOnce(gates[0]!.promise).mockReturnValueOnce(gates[1]!.promise);
    await first.service.scan();
    for (const book of files) first.service.setVisible(book.path, true);
    expect(first.read).toHaveBeenCalledTimes(2);
    first.service.destroy();
    const notifications = first.notify.mock.calls.length;
    const second = setup(files, cache, budget);
    await second.service.scan();
    for (const book of files) second.service.setVisible(book.path, true);
    expect(second.read).not.toHaveBeenCalled();
    gates[0]!.resolve(new ArrayBuffer(1));
    gates[1]!.resolve(new ArrayBuffer(1));
    await wait(() => expect(second.snapshot().indexing?.completed).toBe(2));
    expect(first.notify).toHaveBeenCalledTimes(notifications);
    expect(second.read).toHaveBeenCalledTimes(2);
    second.service.destroy();
  });

  it('uses spare memory for a smaller visible book instead of blocking behind a large queued book', async () => {
    const large = deferred<ArrayBuffer>();
    const small = deferred<ArrayBuffer>();
    const s = setup([file('large-a.epub', 80 * 1024 * 1024), file('large-b.epub', 80 * 1024 * 1024), file('small.epub')]);
    s.read.mockReturnValueOnce(large.promise).mockReturnValueOnce(small.promise);
    await s.service.scan();
    for (const path of ['large-a.epub', 'large-b.epub', 'small.epub']) s.service.setVisible(path, true);
    expect(s.read.mock.calls.map(([book]) => book.path)).toEqual(['large-a.epub', 'small.epub']);
    small.resolve(new ArrayBuffer(1));
    await wait(() => expect(s.snapshot().indexing?.completed).toBe(1));
    expect(s.read).toHaveBeenCalledTimes(2);
    large.resolve(new ArrayBuffer(1));
    await wait(() => expect(s.snapshot().indexing?.completed).toBe(3));
    s.service.destroy();
  });

  it('keeps indexed text and rereads only the requested EPUB when a persistent cover is missing', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new PersistentLibraryCache(storage);
    const files = [file('a.epub'), file('b.epub')];
    const first = setup(files, cache);
    await first.service.scan();
    await wait(() => expect(first.snapshot().indexing?.completed).toBe(2));
    await cache.flush();
    first.service.destroy();
    storage.covers.clear();
    const second = setup(files, cache);
    await second.service.scan();
    expect(second.snapshot().books.every(book => book.title === 'Indexed title')).toBe(true);
    second.service.setVisible('b.epub', true);
    await wait(() => expect(second.snapshot().books[1]?.coverUrl).toBeDefined());
    expect(second.read.mock.calls.map(([book]) => book.path)).toEqual(['b.epub']);
    second.service.destroy();
  });

  it('reuses unchanged entries, indexes modified/new books and removes deleted cache entries', async () => {
    const storage = new MemoryCacheStorage();
    const cache = new PersistentLibraryCache(storage);
    const first = setup([file('same.epub'), file('changed.epub'), file('deleted.epub')], cache);
    await first.service.scan();
    await wait(() => expect(first.snapshot().indexing?.completed).toBe(3));
    await cache.flush();
    first.service.destroy();
    const second = setup([file('same.epub'), file('changed.epub', 11, 2), file('new.epub')], cache);
    await second.service.scan();
    await wait(() => expect(second.snapshot().indexing?.completed).toBe(3));
    await cache.flush();
    expect(second.read.mock.calls.map(([book]) => book.path)).toEqual(['changed.epub', 'new.epub']);
    expect(cache.get(file('deleted.epub'))).toBeUndefined();
    expect(cache.get(file('changed.epub'))).toBeUndefined();
    second.service.destroy();
  });

  it('continues indexing in memory when persistent storage fails and exposes a safe warning', async () => {
    const storage = new MemoryCacheStorage();
    vi.spyOn(storage, 'readIndex').mockRejectedValue(new Error('private filesystem path'));
    const s = setup([file('a.epub')], new PersistentLibraryCache(storage));
    await s.service.scan();
    await wait(() => expect(s.snapshot().indexing?.completed).toBe(1));
    expect(s.snapshot().cacheError).toBe(true);
    expect(filterBooks(s.snapshot().books, 'hidden author')).toHaveLength(1);
    expect(JSON.stringify(s.snapshot())).not.toContain('private filesystem');
    s.service.destroy();
  });
});
