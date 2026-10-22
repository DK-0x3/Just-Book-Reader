import { describe, expect, it, vi } from 'vitest';
import { LibraryService } from '../src/app/library-service';
import type { BookFile, BookVault, LibrarySnapshot, MetadataReader, VaultChange } from '../src/domain/library';

const file = (path: string, mtime = 1, size = 10): BookFile => ({
  path, name: path.split('/').pop()!.replace(/\.epub$/i, ''), size, mtime,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup(initial: BookFile[] = [file('Books/Atlas.epub')], reader: MetadataReader = async () => ({})) {
  let files = initial;
  let listener!: (change: VaultChange) => void;
  const stopVault = vi.fn();
  const list = vi.fn(async (): Promise<readonly BookFile[]> => files);
  const read = vi.fn(async (_file: BookFile, _signal: AbortSignal) => new ArrayBuffer(0));
  const vault: BookVault = {
    list, read,
    subscribe(fn) { listener = fn; return stopVault; },
  };
  const service = new LibraryService(vault, reader);
  let snapshot: LibrarySnapshot = { books: [], scanning: false };
  const notify = vi.fn((value: LibrarySnapshot) => { snapshot = value; });
  const stopUI = service.subscribe(notify);
  return {
    service, list, read, stopVault, stopUI, notify,
    snapshot: () => snapshot,
    files: (value: BookFile[]) => { files = value; },
    change: (event: VaultChange) => listener(event),
  };
}

describe('library catalog', () => {
  it('publishes scanning and empty states, then filename titles without reading content', async () => {
    const s = setup([]);
    const pending = deferred<readonly BookFile[]>();
    s.list.mockReturnValueOnce(pending.promise);
    const scan = s.service.scan();
    expect(s.snapshot()).toEqual({ books: [], scanning: true, error: undefined });
    pending.resolve([]);
    await scan;
    expect(s.snapshot().scanning).toBe(false);
    expect(s.snapshot().books).toEqual([]);
    s.files([file('Books/Atlas.epub'), file('huge.EPUB', 2, 2 ** 40)]);
    await s.service.scan();
    expect(s.snapshot().books.map(book => book.title)).toEqual(['Atlas', 'huge']);
    expect(s.snapshot().books[1]?.size).toBe(2 ** 40);
    s.service.destroy();
  });

  it('applies create/modify/rename/delete events and reconciles a manual refresh', async () => {
    const s = setup();
    await s.service.scan();
    s.change({ type: 'upsert', file: file('New.epub') });
    s.change({ type: 'upsert', file: file('New.epub', 5, 99) });
    expect(s.snapshot().books.find(book => book.path === 'New.epub')).toMatchObject({ mtime: 5, size: 99 });
    s.change({ type: 'rename', oldPath: 'New.epub', file: file('Renamed.epub', 5, 99) });
    expect(s.snapshot().books.map(book => book.title)).toEqual(['Atlas', 'Renamed']);
    s.change({ type: 'remove', path: 'Books/Atlas.epub' });
    expect(s.snapshot().books.map(book => book.path)).toEqual(['Renamed.epub']);
    s.files([file('External.epub')]);
    await s.service.scan();
    expect(s.snapshot().books.map(book => book.path)).toEqual(['External.epub']);
    s.service.destroy();
  });

  it('does not replace create/rename/delete events with a delayed stale listing', async () => {
    const s = setup([file('Old.epub'), file('Deleted.epub')]);
    await s.service.scan();
    const pending = deferred<readonly BookFile[]>();
    s.list.mockReturnValueOnce(pending.promise);
    const scan = s.service.scan();
    s.change({ type: 'rename', oldPath: 'Old.epub', file: file('Renamed.epub') });
    s.change({ type: 'remove', path: 'Deleted.epub' });
    s.change({ type: 'upsert', file: file('Created.epub') });
    expect(s.snapshot().books.map(book => book.path)).toEqual(['Renamed.epub', 'Created.epub']);
    s.files([file('Renamed.epub'), file('Created.epub')]);
    pending.resolve([file('Old.epub'), file('Deleted.epub')]);
    await scan;
    expect(s.snapshot().books.map(book => book.path)).toEqual(['Renamed.epub', 'Created.epub']);
    expect(s.list).toHaveBeenCalledTimes(3);
    expect(s.snapshot().scanning).toBe(false);
    s.service.destroy();
  });

  it('keeps the newer scan when an older scan completes or fails later', async () => {
    for (const rejectOld of [false, true]) {
      const s = setup([file('Current.epub')]);
      const pending = deferred<readonly BookFile[]>();
      s.list.mockReturnValueOnce(pending.promise);
      const oldScan = s.service.scan();
      await s.service.scan();
      if (rejectOld) pending.reject(new Error('stale failure'));
      else pending.resolve([file('Stale.epub')]);
      await oldScan;
      expect(s.snapshot().books.map(book => book.path)).toEqual(['Current.epub']);
      expect(s.snapshot().error).toBeUndefined();
      expect(s.snapshot().scanning).toBe(false);
      s.service.destroy();
    }
  });

  it('retains the last known catalog on failure and clears the error after retry', async () => {
    const s = setup();
    await s.service.scan();
    s.list.mockRejectedValueOnce(new Error('vault unavailable'));
    await s.service.scan();
    expect(s.snapshot().error).toBe('vault');
    expect(s.snapshot().books[0]?.title).toBe('Atlas');
    expect(s.snapshot().scanning).toBe(false);
    s.files([file('Recovered.epub')]);
    await s.service.scan();
    expect(s.snapshot().error).toBeUndefined();
    expect(s.snapshot().books.map(book => book.title)).toEqual(['Recovered']);
    s.service.destroy();
  });

  it('rescans folder/reset events and invalidates a pending earlier listing', async () => {
    const s = setup();
    const pending = deferred<readonly BookFile[]>();
    s.list.mockReturnValueOnce(pending.promise);
    const scan = s.service.scan();
    s.files([file('Moved/Atlas.epub')]);
    s.change({ type: 'reset' });
    await vi.waitFor(() => expect(s.snapshot().books[0]?.path).toBe('Moved/Atlas.epub'));
    pending.resolve([file('Books/Atlas.epub')]);
    await scan;
    expect(s.snapshot().books.map(book => book.path)).toEqual(['Moved/Atlas.epub']);
    s.service.destroy();
  });

  it('unsubscribes the UI independently, destroys once and ignores late events/results', async () => {
    const s = setup();
    s.stopUI();
    const calls = s.notify.mock.calls.length;
    await s.service.scan();
    expect(s.notify).toHaveBeenCalledTimes(calls);
    const observer = vi.fn();
    s.service.subscribe(observer);
    const pending = deferred<readonly BookFile[]>();
    s.list.mockReturnValueOnce(pending.promise);
    const scan = s.service.scan();
    s.service.destroy();
    s.service.destroy();
    const before = observer.mock.calls.length;
    s.change({ type: 'upsert', file: file('Late.epub') });
    pending.resolve([file('Late.epub')]);
    await scan;
    await s.service.scan();
    s.service.subscribe(observer)();
    expect(s.stopVault).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledTimes(before);
    expect(s.list).toHaveBeenCalledTimes(2);
  });
});

describe('lazy metadata lifecycle', () => {
  it('reads only visible cards, handles one job at a time and retains the filename fallback', async () => {
    const pending = deferred<ArrayBuffer>();
    const reader = vi.fn(async () => ({ author: 'Author' }));
    const s = setup([file('One.epub'), file('Two.epub'), file('Hidden.epub')], reader);
    s.read.mockReturnValueOnce(pending.promise);
    await s.service.scan();
    expect(s.read).not.toHaveBeenCalled();
    s.service.setVisible('One.epub', true);
    s.service.setVisible('Two.epub', true);
    expect(s.read).toHaveBeenCalledTimes(1);
    pending.resolve(new ArrayBuffer(0));
    await vi.waitFor(() => expect(s.snapshot().books[1]?.metadataStatus).toBe('ready'));
    expect(s.read.mock.calls.map(([book]) => book.path)).toEqual(['One.epub', 'Two.epub']);
    expect(s.snapshot().books[0]).toMatchObject({ title: 'One', author: 'Author' });
    s.service.destroy();
  });

  it('rejects large files before binary reading, and retries metadata errors on refresh', async () => {
    const reader = vi.fn(async () => ({ title: 'Recovered' }));
    const s = setup([file('Huge.epub', 1, 128 * 1024 * 1024 + 1), file('Normal.epub')], reader);
    await s.service.scan();
    s.service.setVisible('Huge.epub', true);
    expect(s.snapshot().books[0]?.metadataStatus).toBe('error');
    expect(s.read).not.toHaveBeenCalled();
    s.read.mockRejectedValueOnce(new Error('unreadable'));
    s.service.setVisible('Normal.epub', true);
    await vi.waitFor(() => expect(s.snapshot().books[1]?.metadataStatus).toBe('error'));
    expect(s.snapshot().books[1]?.title).toBe('Normal');
    await s.service.scan();
    await vi.waitFor(() => expect(s.snapshot().books[1]?.title).toBe('Recovered'));
    s.service.destroy();
  });

  it('ignores an old parser result after file modification and loads the replacement', async () => {
    const pending = deferred<{ title: string }>();
    const reader = vi.fn<MetadataReader>().mockReturnValueOnce(pending.promise).mockResolvedValue({ title: 'New title' });
    const s = setup([file('Book.epub')], reader);
    await s.service.scan();
    s.service.setVisible('Book.epub', true);
    await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce());
    const oldSignal = reader.mock.calls[0]![1];
    s.change({ type: 'upsert', file: file('Book.epub', 2) });
    expect(oldSignal.aborted).toBe(true);
    pending.resolve({ title: 'Old title' });
    await vi.waitFor(() => expect(s.snapshot().books[0]?.title).toBe('New title'));
    s.service.destroy();
  });

  it('revokes hidden, replaced, removed and destroyed cover URLs', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-cover');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const s = setup([file('Book.epub')], async () => ({ title: 'Title', cover: new Blob(['image']) }));
    await s.service.scan();
    s.service.setVisible('Book.epub', true);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    s.service.setVisible('Book.epub', false);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(s.snapshot().books[0]?.coverUrl).toBeUndefined();
    s.service.setVisible('Book.epub', true);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    s.change({ type: 'upsert', file: file('Book.epub', 2) });
    expect(revoke).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    s.change({ type: 'remove', path: 'Book.epub' });
    expect(revoke).toHaveBeenCalledTimes(3);
    // A remove/create pair can reuse the same Vue card before it ever unmounts.
    s.change({ type: 'upsert', file: file('Book.epub', 3) });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(4));
    s.service.destroy();
    expect(revoke).toHaveBeenCalledTimes(4);
    create.mockRestore();
    revoke.mockRestore();
  });

  it.each(['hide', 'rename', 'delete', 'destroy'] as const)('cancels a pending read on %s without parsing its late result', async action => {
    const pending = deferred<ArrayBuffer>();
    const reader = vi.fn(async () => ({ title: 'Late' }));
    const s = setup([file('Book.epub')], reader);
    s.read.mockReturnValueOnce(pending.promise);
    await s.service.scan();
    s.service.setVisible('Book.epub', true);
    const abort = s.read.mock.calls[0]![1];
    if (action === 'hide') s.service.setVisible('Book.epub', false);
    if (action === 'rename') s.change({ type: 'rename', oldPath: 'Book.epub', file: file('Renamed.epub') });
    if (action === 'delete') s.change({ type: 'remove', path: 'Book.epub' });
    if (action === 'destroy') s.service.destroy();
    expect(abort.aborted).toBe(true);
    const before = s.notify.mock.calls.length;
    pending.resolve(new ArrayBuffer(0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reader).not.toHaveBeenCalled();
    if (action === 'destroy') expect(s.notify).toHaveBeenCalledTimes(before);
    s.service.destroy();
  });
});
