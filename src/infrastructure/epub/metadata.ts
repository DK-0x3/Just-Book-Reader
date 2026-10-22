import JSZip from 'jszip';
import type { BookMetadata } from '../../domain/library';
import { MAX_EPUB_BYTES } from '../../domain/epub-limits';

const MAX_XML_BYTES = 2 * 1024 * 1024;
const MAX_COVER_BYTES = 8 * 1024 * 1024;

export function resolveArchivePath(base: string, reference: string): string {
  return normalizeArchivePath(base, decodeURIComponent(reference.split(/[?#]/, 1)[0] || ''));
}

function normalizeArchivePath(base: string, clean: string): string {
  if (!clean || /^[a-z][a-z\d+.-]*:|^\//i.test(clean) || /[\\\u0000-\u001f\u007f]/.test(clean)) {
    throw new Error('invalid-path');
  }
  const parts = base.split('/').slice(0, -1);
  for (const part of clean.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new Error('archive-traversal');
      parts.pop();
    } else parts.push(part);
  }
  if (!parts.length) throw new Error('invalid-path');
  return parts.join('/');
}

export function parseXml(text: string): XMLDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('unsafe-xml');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('invalid-xml');
  return doc;
}

function elements(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', name));
}

export async function boundedEntry(zip: JSZip, path: string, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const entry = zip.file(path);
  if (!entry) throw new Error('missing-resource');
  // JSZip sanitizes ZIP paths. Check the original too, so an escaped entry cannot become trusted XML.
  if (entry.unsafeOriginalName) normalizeArchivePath('', entry.unsafeOriginalName);
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    // The public runtime API is missing from JSZipObject's TypeScript declarations.
    const stream = (entry as JSZip.JSZipObject & {
      internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
    }).internalStream('uint8array');
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      chunks.length = 0;
      signal.removeEventListener('abort', abort);
      reject(error);
    };
    const abort = () => fail(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    stream.on('data', chunk => {
      if (settled) return;
      total += chunk.length;
      // Stop inflation before the whole resource is allocated, including compressed ZIP bombs.
      if (total > limit) { fail(new Error('resource-too-large')); return; }
      chunks.push(chunk);
    });
    stream.on('error', fail);
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
      chunks.length = 0;
      resolve(result);
    });
    stream.resume();
  });
}

function rasterMime(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return 'image/png';
  const start = new TextDecoder().decode(bytes.subarray(0, 12));
  if (start.startsWith('GIF87a') || start.startsWith('GIF89a')) return 'image/gif';
  if (start.startsWith('RIFF') && start.slice(8) === 'WEBP') return 'image/webp';
  return undefined;
}

export async function readEpubMetadata(data: ArrayBuffer, signal: AbortSignal): Promise<BookMetadata> {
  signal.throwIfAborted();
  if (data.byteLength > MAX_EPUB_BYTES) throw new Error('too-large');
  // CRC checking here would inflate every entry, including chapters we never need for a card.
  const zip = await JSZip.loadAsync(data);
  signal.throwIfAborted();
  if (Object.keys(zip.files).length > 10_000) throw new Error('too-many-resources');
  const decoder = new TextDecoder();
  const container = parseXml(decoder.decode(await boundedEntry(zip, 'META-INF/container.xml', MAX_XML_BYTES, signal)));
  if (container.documentElement.localName !== 'container') throw new Error('invalid-container');
  const roots = elements(container, 'rootfile');
  const root = roots.find(node => node.getAttribute('media-type') === 'application/oebps-package+xml') || roots[0];
  const fullPath = root?.getAttribute('full-path');
  if (!fullPath) throw new Error('missing-package');
  const packagePath = resolveArchivePath('', fullPath);
  const opf = parseXml(decoder.decode(await boundedEntry(zip, packagePath, MAX_XML_BYTES, signal)));
  if (opf.documentElement.localName !== 'package') throw new Error('invalid-package');
  const metadata = elements(opf, 'metadata')[0];
  const title = metadata && elements(metadata, 'title')[0]?.textContent?.trim();
  const author = metadata && elements(metadata, 'creator').map(node => node.textContent?.trim()).filter(Boolean).join(', ');
  const result: BookMetadata = { title: title || undefined, author: author || undefined };
  const manifest = elements(opf, 'manifest')[0];
  const items = manifest ? elements(manifest, 'item') : [];
  const legacyId = metadata && elements(metadata, 'meta').find(node => node.getAttribute('name') === 'cover')?.getAttribute('content');
  const cover = items.find(node => (node.getAttribute('properties') || '').split(/\s+/).includes('cover-image'))
    || items.find(node => legacyId && node.getAttribute('id') === legacyId);
  const href = cover?.getAttribute('href');
  if (!href) return result;
  try {
    const bytes = await boundedEntry(zip, resolveArchivePath(packagePath, href), MAX_COVER_BYTES, signal);
    const mime = rasterMime(bytes);
    // Never insert EPUB markup into the gallery, even when its filename or MIME claims it is an image.
    if (mime) return { ...result, cover: new Blob([bytes.slice().buffer], { type: mime }) };
  } catch {
    signal.throwIfAborted();
    // A broken cover must not hide otherwise valid title and author metadata.
  }
  return result;
}
