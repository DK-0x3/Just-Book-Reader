import type {
  Book,
  BookFile,
  BookMetadata,
  BookVault,
  LibrarySnapshot,
  MetadataReader,
  VaultChange,
} from '../domain/library';
import type { LibraryCache } from '../domain/library-cache';
import { sameBookFile } from '../domain/library-cache';
import { MAX_EPUB_BYTES } from '../domain/epub-limits';
import { LibraryWorkBudget, type WorkLease } from './library-work-budget';

const MAX_CACHED_COVERS = 64;
const MAX_CACHED_COVER_BYTES = 24 * 1024 * 1024;
const BACKGROUND_YIELD_MS = 0;

interface Job {
  controller: AbortController;
  lease: WorkLease;
}

/** One view owns live records and URLs; cache and IO budget belong to the host. */
export class LibraryService {
  private records = new Map<string, Book>();
  private indexed = new Set<string>();
  private coverExpected = new Set<string>();
  private listeners = new Set<(snapshot: LibrarySnapshot) => void>();
  private stopVault: () => void;
  private stopBudget: () => void;
  private destroyed = false;
  private cacheReady = false;
  private scanGeneration = 0;
  private changeGeneration = 0;
  private scanning = false;
  private scanError?: 'vault';
  private visible = new Set<string>();
  private queue = new Set<string>();
  private explicitRetries = new Set<string>();
  private jobs = new Map<string, Job>();
  private backgroundTimer?: ReturnType<typeof setTimeout>;
  private covers = new Map<string, {
    url: string;
    size: number;
  }>();
  private coverBytes = 0;

  constructor(private vault: BookVault, private readMetadata: MetadataReader, private cache: LibraryCache,
    private budget = new LibraryWorkBudget()) {
    this.stopVault = vault.subscribe(change => this.onChange(change));
    this.stopBudget = budget.subscribe(() => this.pump());
  }

  subscribe(listener: (snapshot: LibrarySnapshot) => void): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async scan(): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.scanGeneration;
    const changes = this.changeGeneration;
    this.scanning = true;
    this.scanError = undefined;
    this.emit();
    try {
      const [files] = await Promise.all([this.vault.list(), this.cache.open()]);
      if (this.destroyed || generation !== this.scanGeneration) return;
      this.cacheReady = true;
      // File events already updated the live catalog; do not replace them with an older listing.
      if (changes !== this.changeGeneration) {
        await this.scan();
        return;
      }
      const found = new Set(files.map(file => file.path));
      for (const path of this.records.keys()) if (!found.has(path)) this.remove(path);
      for (const file of files) this.upsert(file);
      for (const [path, book] of this.records) {
        if (book.metadataStatus === 'error') this.records.set(path, { ...book, metadataStatus: this.indexed.has(path) ? 'ready' : 'idle', metadataError: undefined });
        this.enqueue(path);
      }
      if (this.vault.canPruneCache !== false) await this.cache.retain(files);
    } catch {
      if (!this.destroyed && generation === this.scanGeneration) this.scanError = 'vault';
    } finally {
      if (!this.destroyed && generation === this.scanGeneration) {
        this.scanning = false;
        this.emit();
        this.pump();
        void this.cache.flush().then(() => this.emit());
      }
    }
  }

  setVisible(path: string, visible: boolean): void {
    if (this.destroyed) return;
    if (visible) {
      this.visible.add(path);
      this.jobs.get(path)?.lease.promote();
      const cover = this.covers.get(path);
      if (cover) {
        this.covers.delete(path);
        this.covers.set(path, cover);
      }
      this.enqueue(path);
    } else {
      this.visible.delete(path);
      if (this.indexed.has(path) && !this.explicitRetries.has(path)) this.queue.delete(path);
      if (this.trimCovers()) this.emit();
    }
    // A scroll must not discard an EPUB read already needed for the search index.
    this.pump();
  }

  retryMetadata(path: string): void {
    if (this.destroyed) return;
    const book = this.records.get(path);
    if (!book || book.metadataStatus !== 'error') return;
    this.records.set(path, { ...book, metadataStatus: this.indexed.has(path) ? 'ready' : 'idle', metadataError: undefined });
    this.explicitRetries.add(path);
    this.queue.add(path);
    this.emit();
    this.pump();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopVault();
    this.stopBudget();
    if (this.backgroundTimer) clearTimeout(this.backgroundTimer);
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
    this.queue.clear();
    this.explicitRetries.clear();
    for (const path of this.covers.keys()) this.releaseCover(path);
    this.visible.clear();
    this.records.clear();
    this.indexed.clear();
    this.coverExpected.clear();
    this.listeners.clear();
    void this.cache.flush();
  }

  private snapshot(): LibrarySnapshot {
    const books = [...this.records.values()];
    return {
      books, scanning: this.scanning, error: this.scanError, cacheError: this.cache.failed || undefined,
      indexing: {
        completed: this.indexed.size, total: books.length,
        failed: books.filter(book => !this.indexed.has(book.path) && book.metadataStatus === 'error').length
      },
    };
  }

  private emit(): void {
    if (!this.destroyed) for (const listener of this.listeners) listener(this.snapshot());
  }

  private onChange(change: VaultChange): void {
    if (this.destroyed) return;
    this.changeGeneration++;
    if (change.type === 'reset') {
      void this.scan();
      return;
    }
    if (change.type === 'remove') this.remove(change.path);
    else {
      if (change.type === 'rename') this.remove(change.oldPath);
      this.upsert(change.file);
    }
    this.emit();
    this.pump();
  }

  private upsert(file: BookFile): void {
    const existing = this.records.get(file.path);
    if (existing && sameBookFile(existing, file)
      && (this.indexed.has(file.path) || !this.cacheReady || !this.cache.get(file))) return;
    this.cancel(file.path);
    this.releaseCover(file.path);
    this.indexed.delete(file.path);
    this.coverExpected.delete(file.path);
    const cached = this.cacheReady ? this.cache.get(file) : undefined;
    if (cached) {
      this.indexed.add(file.path);
      if (cached.hasCover) this.coverExpected.add(file.path);
    } else if (this.cacheReady) void this.cache.remove(file.path);
    this.records.set(file.path, { ...file, title: cached?.title || file.name, author: cached?.author, metadataStatus: cached ? 'ready' : 'idle' });
    this.enqueue(file.path);
  }

  private cancel(path: string): void {
    this.queue.delete(path);
    this.explicitRetries.delete(path);
    this.jobs.get(path)?.controller.abort();
    this.jobs.delete(path);
  }

  private releaseCover(path: string): void {
    const cover = this.covers.get(path);
    if (!cover) return;
    URL.revokeObjectURL(cover.url);
    this.coverBytes -= cover.size;
    this.covers.delete(path);
  }

  private trimCovers(): boolean {
    let changed = false;
    for (const path of this.covers.keys()) {
      if (this.covers.size <= MAX_CACHED_COVERS && this.coverBytes <= MAX_CACHED_COVER_BYTES) break;
      if (this.visible.has(path)) continue;
      this.releaseCover(path);
      const book = this.records.get(path);
      if (book) this.records.set(path, { ...book, coverUrl: undefined });
      changed = true;
    }
    return changed;
  }

  private remove(path: string): void {
    this.cancel(path);
    this.releaseCover(path);
    this.indexed.delete(path);
    this.coverExpected.delete(path);
    this.records.delete(path);
    void this.cache.remove(path);
  }

  private needsWork(path: string): boolean {
    const book = this.records.get(path);
    if (!book || book.metadataStatus === 'error' || book.metadataStatus === 'loading') return false;
    return !this.indexed.has(path) || ((this.visible.has(path) || this.explicitRetries.has(path))
      && this.coverExpected.has(path) && !book.coverUrl);
  }

  private enqueue(path: string): void {
    if (this.needsWork(path)) this.queue.add(path);
  }

  private pump(allowBackground = false): void {
    if (this.destroyed || !this.cacheReady || this.scanning) return;
    while (this.queue.size) {
      const priority = new Set([...this.explicitRetries, ...this.visible]);
      let next = this.reserve(priority, false);
      if (!next && allowBackground) next = this.reserve(this.queue, true);
      if (!next) {
        if (!allowBackground && this.queue.size) {
          this.backgroundTimer ??= setTimeout(() => {
            this.backgroundTimer = undefined;
            this.pump(true);
          }, BACKGROUND_YIELD_MS);
        }
        return;
      }
      const { path, book, lease } = next;
      const requested = this.explicitRetries.has(path);
      this.queue.delete(path);
      this.explicitRetries.delete(path);
      const controller = new AbortController();
      const job = { controller, lease };
      this.jobs.set(path, job);
      const loading: Book = { ...book, metadataStatus: 'loading', metadataError: undefined };
      this.records.set(path, loading);
      this.emit();
      void this.load(loading, controller, requested).finally(() => {
        if (this.jobs.get(path) === job) this.jobs.delete(path);
        // Even an aborted read occupies its shared slot until native IO actually settles.
        lease.release();
        this.enqueue(path);
        this.pump();
        if (!this.jobs.size && !this.queue.size) void this.cache.flush().then(() => this.emit());
      });
      allowBackground = false;
    }
  }

  private reserve(paths: Iterable<string>, background: boolean): {
    path: string;
    book: Book;
    lease: WorkLease;
  } | undefined {
    for (const path of paths) {
      if (!this.queue.has(path) || this.jobs.has(path)) continue;
      if (!this.needsWork(path)) {
        this.queue.delete(path);
        continue;
      }
      if (background && (this.visible.has(path) || this.explicitRetries.has(path))) continue;
      const book = this.records.get(path);
      if (!book) continue;
      const lease = this.budget.acquire(book.size, background);
      if (lease) return { path, book, lease };
    }
  }

  private showCover(path: string, blob: Blob): void {
    if (!this.visible.has(path)) return;
    this.releaseCover(path);
    const url = URL.createObjectURL(blob);
    this.covers.set(path, { url, size: blob.size });
    this.coverBytes += blob.size;
    const book = this.records.get(path);
    if (book) this.records.set(path, { ...book, coverUrl: url });
    this.trimCovers();
  }

  private async load(loading: Book, controller: AbortController, requested: boolean): Promise<void> {
    const { signal } = controller;
    const current = () => !this.destroyed && this.jobs.get(loading.path)?.controller === controller;
    try {
      if (this.indexed.has(loading.path)) {
        const cover = await this.cache.readCover(loading, signal);
        signal.throwIfAborted();
        if (!current()) return;
        if (cover || (!this.visible.has(loading.path) && !requested)) {
          if (cover) this.showCover(loading.path, cover);
          const book = this.records.get(loading.path);
          if (book) this.records.set(loading.path, { ...book, metadataStatus: 'ready' });
          this.emit();
          return;
        }
      }
      if (loading.size > MAX_EPUB_BYTES) throw new Error('too-large');
      const data = await this.vault.read(loading, signal);
      signal.throwIfAborted();
      const metadata: BookMetadata = await this.readMetadata(data, signal);
      signal.throwIfAborted();
      if (!current()) return;
      this.indexed.add(loading.path);
      if (metadata.cover) this.coverExpected.add(loading.path);
      else this.coverExpected.delete(loading.path);
      this.records.set(loading.path, { ...loading, title: metadata.title || loading.name, author: metadata.author, metadataStatus: 'ready' });
      if (metadata.cover) this.showCover(loading.path, metadata.cover);
      this.emit();
      await this.cache.put(loading, metadata, signal);
    } catch (error) {
      if (!current()) return;
      const book = this.records.get(loading.path) ?? loading;
      const metadataError = error instanceof Error && error.message === 'too-large' ? 'too-large' : 'invalid';
      this.records.set(loading.path, {
        ...book, metadataStatus: signal.aborted ? (this.indexed.has(loading.path) ? 'ready' : 'idle') : 'error',
        metadataError: signal.aborted ? undefined : metadataError
      });
    }
    this.emit();
  }
}
