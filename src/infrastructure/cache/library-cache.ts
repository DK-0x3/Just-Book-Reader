import { sameBookFile, type CachedBook, type LibraryCache } from '../../domain/library-cache';
import type { BookFile, BookMetadata } from '../../domain/library';
import { MAX_EPUB_COVER_BYTES } from '../../domain/epub-limits';

export const MAX_DISK_COVERS = 512;
export const MAX_DISK_COVER_BYTES = 256 * 1024 * 1024;
export const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const INDEX_VERSION = 1;
const FLUSH_DELAY_MS = 100;
const COVER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export interface CacheStorage {
  readIndex(): Promise<string | undefined>;
  writeIndex(json: string): Promise<void>;
  readCover(key: string): Promise<ArrayBuffer | undefined>;
  writeCover(key: string, bytes: ArrayBuffer): Promise<void>;
  removeCover(key: string): Promise<void>;
  listCovers(): Promise<string[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validEntry(value: unknown): value is CachedBook {
  if (!isRecord(value) || typeof value.path !== 'string' || !value.path || typeof value.name !== 'string'
    || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size < 0
    || typeof value.mtime !== 'number' || !Number.isFinite(value.mtime)
    || (value.title !== undefined && typeof value.title !== 'string')
    || (value.author !== undefined && typeof value.author !== 'string') || typeof value.hasCover !== 'boolean') return false;
  const cover = value.cover;
  return cover === undefined || (value.hasCover && isRecord(cover) && typeof cover.key === 'string'
    && /^[a-f0-9-]{36}$/.test(cover.key) && typeof cover.size === 'number' && Number.isSafeInteger(cover.size)
    && cover.size > 0 && cover.size <= MAX_EPUB_COVER_BYTES && typeof cover.type === 'string' && COVER_TYPES.has(cover.type)
    && typeof cover.used === 'number' && Number.isFinite(cover.used));
}

/** One instance per host serializes mutations across view lifetimes. */
export class PersistentLibraryCache implements LibraryCache {
  failed = false;
  private entries = new Map<string, CachedBook>();
  private coverOrder = new Map<string, NonNullable<CachedBook['cover']>>();
  private coverBytes = 0;
  private opening?: Promise<void>;
  private work = Promise.resolve();
  private dirty = false;
  private garbage = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private storage: CacheStorage) {}

  open(): Promise<void> {
    return this.opening ??= this.load();
  }

  private async load(): Promise<void> {
    try {
      const json = await this.storage.readIndex();
      if (json !== undefined) {
        if (new TextEncoder().encode(json).byteLength > MAX_INDEX_BYTES) throw new Error('index-too-large');
        const data: unknown = JSON.parse(json);
        if (!isRecord(data) || data.version !== INDEX_VERSION || !Array.isArray(data.books)
          || !data.books.every(validEntry)) throw new Error('invalid-cache');
        const coverKeys = new Set<string>();
        for (const entry of data.books) {
          if (this.entries.has(entry.path)) throw new Error('duplicate-path');
          if (entry.cover && coverKeys.has(entry.cover.key)) throw new Error('duplicate-cover');
          if (entry.cover) coverKeys.add(entry.cover.key);
          this.entries.set(entry.path, entry);
        }
      }
      const referenced = new Set([...this.entries.values()].flatMap(entry => entry.cover ? [entry.cover.key] : []));
      const ordered = [...this.entries.values()].flatMap(entry => entry.cover ? [{ path: entry.path, cover: entry.cover }] : [])
        .sort((a, b) => a.cover.used - b.cover.used);
      for (const item of ordered) this.trackCover(item.path, item.cover);
      for (const key of await this.storage.listCovers()) {
        if (!referenced.has(key)) this.garbage.add(key);
      }
      this.trim();
      if (this.garbage.size) this.changed();
    } catch {
      // Preserve unreadable or newer cache data; never replace it with an empty index.
      this.entries.clear();
      this.coverOrder.clear();
      this.coverBytes = 0;
      this.failed = true;
    }
  }

  get(file: BookFile): CachedBook | undefined {
    const entry = this.entries.get(file.path);
    return entry && sameBookFile(entry, file) ? entry : undefined;
  }

  async readCover(file: BookFile, signal: AbortSignal): Promise<Blob | undefined> {
    await this.open();
    let result: Blob | undefined;
    await this.run(async () => {
      if (signal.aborted) return;
      const entry = this.get(file);
      if (!entry?.cover) return;
      const data = await this.storage.readCover(entry.cover.key);
      if (signal.aborted) return;
      if (!data || data.byteLength !== entry.cover.size) {
        this.garbage.add(entry.cover.key);
        this.entries.set(file.path, { ...entry, cover: undefined });
        this.trackCover(file.path, undefined);
      } else {
        const cover = { ...entry.cover, used: Date.now() };
        this.entries.set(file.path, { ...entry, cover });
        this.trackCover(file.path, cover);
        result = new Blob([data], { type: entry.cover.type });
      }
      this.changed();
    });
    return result;
  }

  async put(file: BookFile, metadata: BookMetadata, signal: AbortSignal): Promise<void> {
    await this.open();
    await this.run(async () => {
      if (signal.aborted || this.failed) return;
      let cover: CachedBook['cover'];
      if (metadata.cover && metadata.cover.size > 0 && metadata.cover.size <= MAX_EPUB_COVER_BYTES
        && COVER_TYPES.has(metadata.cover.type)) {
        const key = Array.from(crypto.getRandomValues(new Uint8Array(18)), byte => byte.toString(16).padStart(2, '0')).join('');
        const bytes = await metadata.cover.arrayBuffer();
        if (signal.aborted) return;
        await this.storage.writeCover(key, bytes);
        if (signal.aborted) {
          this.garbage.add(key);
          this.changed();
          return;
        }
        cover = { key, size: bytes.byteLength, type: metadata.cover.type, used: Date.now() };
      }
      const previous = this.entries.get(file.path);
      if (previous?.cover) this.garbage.add(previous.cover.key);
      this.entries.set(file.path, {
        path: file.path, name: file.name, size: file.size, mtime: file.mtime,
        title: metadata.title, author: metadata.author, hasCover: !!metadata.cover, cover
      });
      this.trackCover(file.path, cover);
      this.trim();
      this.changed();
    });
  }

  async retain(files: readonly BookFile[]): Promise<void> {
    await this.open();
    await this.run(async () => {
      const current = new Map(files.map(file => [file.path, file]));
      for (const entry of this.entries.values()) {
        const file = current.get(entry.path);
        if (!file || !sameBookFile(file, entry)) this.forget(entry.path);
      }
    });
  }

  async remove(path: string): Promise<void> {
    await this.open();
    await this.run(async () => {
      this.forget(path);
    });
  }

  private forget(path: string): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    if (entry.cover) this.garbage.add(entry.cover.key);
    this.trackCover(path, undefined);
    this.entries.delete(path);
    this.changed();
  }

  private trackCover(path: string, cover: CachedBook['cover']): void {
    const previous = this.coverOrder.get(path);
    if (previous) this.coverBytes -= previous.size;
    this.coverOrder.delete(path);
    if (cover) {
      this.coverOrder.set(path, cover);
      this.coverBytes += cover.size;
    }
  }

  private trim(): void {
    for (const [path, cover] of this.coverOrder) {
      if (this.coverOrder.size <= MAX_DISK_COVERS && this.coverBytes <= MAX_DISK_COVER_BYTES) break;
      this.garbage.add(cover.key);
      const entry = this.entries.get(path);
      if (entry) this.entries.set(path, { ...entry, cover: undefined });
      this.trackCover(path, undefined);
      this.changed();
    }
  }

  private changed(): void {
    this.dirty = true;
    if (!this.timer && !this.failed) this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, FLUSH_DELAY_MS);
  }

  async flush(): Promise<void> {
    await this.open();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.run(async () => {
      if (!this.dirty || this.failed) return;
      const json = JSON.stringify({ version: INDEX_VERSION, books: [...this.entries.values()] });
      if (new TextEncoder().encode(json).byteLength > MAX_INDEX_BYTES) throw new Error('index-too-large');
      await this.storage.writeIndex(json);
      this.dirty = false;
      // Commit references before removing old files; interrupted writes only leave reclaimable orphans.
      for (const key of this.garbage) {
        await this.storage.removeCover(key);
        this.garbage.delete(key);
      }
    });
  }

  private run(task: () => Promise<void>): Promise<void> {
    this.work = this.work.then(task).catch(() => {
      this.failed = true;
    });
    return this.work;
  }
}
