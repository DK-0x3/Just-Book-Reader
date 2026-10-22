import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { createObsidianVault } from '../src/ui/vault';

describe('Obsidian binary adapter', () => {
  it('reads the current TFile and rejects changed, missing and cancelled reads', async () => {
    const file = new TFile();
    const data = new ArrayBuffer(4);
    const getAbstractFileByPath = vi.fn((): TFile | null => file);
    const readBinary = vi.fn(async () => data);
    const vault = createObsidianVault({ vault: { getAbstractFileByPath, readBinary } } as unknown as App);
    const book = { path: file.path, name: file.basename, size: 4, mtime: 1 };
    const signal = new AbortController().signal;
    expect(await vault.read(book, signal)).toBe(data);
    expect(getAbstractFileByPath).toHaveBeenCalledWith(book.path);
    expect(readBinary).toHaveBeenCalledWith(file);
    await expect(vault.read({ ...book, mtime: 2 }, signal)).rejects.toThrow('file-changed');
    getAbstractFileByPath.mockReturnValueOnce(null);
    await expect(vault.read(book, signal)).rejects.toThrow('file-changed');
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(vault.read(book, cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(readBinary).toHaveBeenCalledOnce();
  });

  it('does not return binary data that arrives after cancellation', async () => {
    const file = new TFile();
    let finish!: (data: ArrayBuffer) => void;
    const pending = new Promise<ArrayBuffer>(resolve => { finish = resolve; });
    const vault = createObsidianVault({ vault: {
      getAbstractFileByPath: () => file, readBinary: () => pending,
    } } as unknown as App);
    const controller = new AbortController();
    const reading = vault.read({ path: file.path, name: file.basename, size: 4, mtime: 1 }, controller.signal);
    controller.abort();
    finish(new ArrayBuffer(4));
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  });
});
