import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { boundedEntry, readEpubMetadata, resolveArchivePath } from '../src/infrastructure/epub/metadata';
import { makeEpub } from './fixtures/epub';

const signal = () => new AbortController().signal;

describe('EPUB archive boundaries', () => {
  it('resolves encoded Unicode and parent paths inside the archive', () => {
    expect(resolveArchivePath('OPS/book.opf', '../Images/%D0%BA%D0%BD%D0%B8%D0%B3%D0%B0%20one.png#cover')).toBe('Images/книга one.png');
    expect(resolveArchivePath('', 'OPS/book%20info.opf')).toBe('OPS/book info.opf');
  });

  it.each(['../../outside', '%2e%2e/%2e%2e/outside', '/etc/file', '%2fetc/file', '//example.org/a', 'https://example.org/a', 'https%3A//example.org/a', 'data:image/png,a', 'C:/file', 'a%5cb', 'a%00b', 'bad%encoding', '#only'])('rejects unsafe path %s', path => {
    expect(() => resolveArchivePath('OPS/book.opf', path)).toThrow();
  });

  it('reads entries up to the limit and stops compressed inflation over it', async () => {
    const source = new JSZip().file('ok', '1234').file('literal%name', 'fine').file('bomb', 'x'.repeat(4 * 1024 * 1024));
    const data = await source.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const zip = await JSZip.loadAsync(data);
    expect(new TextDecoder().decode(await boundedEntry(zip, 'ok', 4, signal()))).toBe('1234');
    expect(new TextDecoder().decode(await boundedEntry(zip, 'literal%name', 4, signal()))).toBe('fine');
    await expect(boundedEntry(zip, 'bomb', 1024, signal())).rejects.toThrow('resource-too-large');
    await expect(boundedEntry(zip, 'missing', 100, signal())).rejects.toThrow('missing-resource');
  });

  it('rejects ZIP entries whose original path escaped the archive root', async () => {
    const source = new JSZip().file('../../evil.xml', '<container/>');
    const zip = await JSZip.loadAsync(await source.generateAsync({ type: 'uint8array' }));
    expect(zip.file('evil.xml')).not.toBeNull();
    await expect(boundedEntry(zip, 'evil.xml', 1024, signal())).rejects.toThrow('archive-traversal');
  });

  it('honors abort before reading and while inflating', async () => {
    const zip = new JSZip().file('large', 'x'.repeat(4 * 1024 * 1024));
    const controller = new AbortController();
    controller.abort();
    await expect(boundedEntry(zip, 'large', 8 * 1024 * 1024, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const pending = new AbortController();
    const result = boundedEntry(zip, 'large', 8 * 1024 * 1024, pending.signal);
    setTimeout(() => pending.abort(), 0);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects corrupt archives, too many entries and an oversized EPUB before parsing XML', async () => {
    await expect(readEpubMetadata(new ArrayBuffer(4), signal())).rejects.toThrow();
    const oversized = new ArrayBuffer(128 * 1024 * 1024 + 1);
    const load = vi.spyOn(JSZip, 'loadAsync');
    await expect(readEpubMetadata(oversized, signal())).rejects.toThrow('too-large');
    expect(load).not.toHaveBeenCalled();
    load.mockRestore();
    const many = await makeEpub({ extraEntries: 10_001 });
    await expect(readEpubMetadata(many.buffer.slice(many.byteOffset, many.byteOffset + many.byteLength) as ArrayBuffer, signal())).rejects.toThrow('too-many-resources');
  });
});
