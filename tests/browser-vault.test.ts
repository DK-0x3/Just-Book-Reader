import { describe, expect, it, vi } from 'vitest';
import { BrowserVault } from '../dev/browser-vault';
import { LibraryService } from '../src/app/library-service';
import type { LibrarySnapshot } from '../src/domain/library';

describe('browser catalog adapter', () => {
  it('filters extensions, uses filename/stat metadata and never reads file contents', async () => {
    const vault = new BrowserVault();
    const book = new File(['not even a valid zip'], 'Атлас.EPUB', { lastModified: 123 });
    const read = vi.spyOn(book, 'arrayBuffer');
    const readText = vi.spyOn(book, 'text');
    vault.add([book, new File(['text'], 'note.md'), new File([], 'fake.epub.zip')]);
    expect(await vault.list()).toEqual([{ path: 'Атлас.EPUB', name: 'Атлас', size: book.size, mtime: 123 }]);
    expect(read).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
  });

  it('updates an existing filename, emits reset on clear and stops detached listeners', async () => {
    const vault = new BrowserVault();
    const changes = vi.fn();
    const stop = vault.subscribe(changes);
    vault.add([new File(['first'], 'book.epub', { lastModified: 1 })]);
    vault.add([new File(['updated'], 'book.epub', { lastModified: 2 })]);
    expect(await vault.list()).toHaveLength(1);
    expect(changes.mock.calls[1]?.[0]).toMatchObject({ type: 'upsert', file: { size: 7, mtime: 2 } });
    vault.clear();
    expect(await vault.list()).toEqual([]);
    expect(changes.mock.calls[2]?.[0]).toEqual({ type: 'reset' });
    stop();
    vault.add([new File([], 'other.epub')]);
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it('keeps selected files across view service close/reopen and clears a live catalog', async () => {
    const vault = new BrowserVault();
    const first = new LibraryService(vault, async () => ({}));
    vault.add([new File([], 'First.epub')]);
    first.destroy();
    vault.add([new File([], 'WhileClosed.epub')]);
    const second = new LibraryService(vault, async () => ({}));
    let snapshot: LibrarySnapshot = { books: [], scanning: false };
    second.subscribe(value => { snapshot = value; });
    await second.scan();
    expect(snapshot.books.map(book => book.title)).toEqual(['First', 'WhileClosed']);
    vault.clear();
    await vi.waitFor(() => expect(snapshot.books).toEqual([]));
    second.destroy();
  });
});

describe('browser binary access', () => {
  it('reads only the requested file and rejects removed, changed and aborted files', async () => {
    const vault = new BrowserVault();
    const file = new File(['local bytes'], 'book.epub', { lastModified: 1 });
    const read = vi.spyOn(file, 'arrayBuffer');
    vault.add([file]);
    const book = (await vault.list())[0]!;
    const signal = new AbortController().signal;
    expect(new TextDecoder().decode(await vault.read(book, signal))).toBe('local bytes');
    const aborted = new AbortController();
    aborted.abort();
    await expect(vault.read(book, aborted.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledOnce();
    vault.add([new File(['replacement'], 'book.epub', { lastModified: 2 })]);
    await expect(vault.read(book, signal)).rejects.toThrow('file-changed');
    vault.clear();
    await expect(vault.read(book, signal)).rejects.toThrow('file-changed');
  });
});
