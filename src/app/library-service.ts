import type { Book, BookFile, BookVault, LibrarySnapshot, MetadataReader, VaultChange } from '../domain/library';
import { MAX_EPUB_BYTES } from '../domain/epub-limits';

const MAX_METADATA_JOBS = 2;
const MAX_CACHED_COVERS = 64;
const MAX_CACHED_COVER_BYTES = 24 * 1024 * 1024;

/** One view owns the catalog, lazy metadata work and cover URLs. */
export class LibraryService {
  private records = new Map<string, Book>();
  private listeners = new Set<(snapshot: LibrarySnapshot) => void>();
  private stopVault: () => void;
  private destroyed = false;
  private scanGeneration = 0;
  private changeGeneration = 0;
  private scanning = false;
  private scanError?: 'vault';
  private visible = new Set<string>();
  private queue = new Set<string>();
  private jobs = new Map<string, AbortController>();
  private activeMetadataJobCount = 0;
  private covers = new Map<string, { url: string; size: number }>();
  private coverBytes = 0;

  constructor(private vault: BookVault, private readMetadata: MetadataReader) {
    this.stopVault = vault.subscribe(change => this.onChange(change));
  }

  subscribe(listener: (snapshot: LibrarySnapshot) => void): () => void {
    if (this.destroyed) return () => {};
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }

  async scan(): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.scanGeneration;
    const changes = this.changeGeneration;
    this.scanning = true;
    this.scanError = undefined;
    this.emit();
    try {
      const files = await this.vault.list();
      if (this.destroyed || generation !== this.scanGeneration) return;
      // Events already updated the live catalog; get a fresh listing instead of overwriting them.
      if (changes !== this.changeGeneration) {
        await this.scan();
        return;
      }
      const found = new Set(files.map(file => file.path));
      for (const path of this.records.keys()) if (!found.has(path)) this.remove(path);
      for (const file of files) this.upsert(file);
      for (const [path, book] of this.records) {
        if (book.metadataStatus === 'error') this.records.set(path, { ...book, metadataStatus: 'idle' });
        this.enqueue(path);
      }
    } catch {
      if (!this.destroyed && generation === this.scanGeneration) this.scanError = 'vault';
    } finally {
      if (!this.destroyed && generation === this.scanGeneration) {
        this.scanning = false;
        this.emit();
        this.pump();
      }
    }
  }

  setVisible(path: string, visible: boolean): void {
    if (this.destroyed) return;
    let changed = false;
    if (visible) {
      this.visible.add(path);
      const cover = this.covers.get(path);
      if (cover) {
        this.covers.delete(path);
        this.covers.set(path, cover);
      }
      this.enqueue(path);
    } else {
      this.visible.delete(path);
      this.cancel(path);
      const book = this.records.get(path);
      if (book?.metadataStatus === 'loading') {
        this.records.set(path, { ...book, metadataStatus: 'idle' });
        changed = true;
      }
      changed = this.trimCovers() || changed;
    }
    if (changed) this.emit();
    this.pump();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopVault();
    for (const controller of this.jobs.values()) controller.abort();
    this.jobs.clear();
    this.queue.clear();
    for (const path of this.covers.keys()) this.releaseCover(path);
    this.visible.clear();
    this.records.clear();
    this.listeners.clear();
  }

  private snapshot(): LibrarySnapshot {
    return { books: [...this.records.values()], scanning: this.scanning, error: this.scanError };
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
    if (existing && existing.name === file.name && existing.size === file.size && existing.mtime === file.mtime) return;
    this.cancel(file.path);
    this.releaseCover(file.path);
    this.records.set(file.path, { ...file, title: file.name, metadataStatus: 'idle' });
    this.enqueue(file.path);
  }

  private cancel(path: string): void {
    this.queue.delete(path);
    this.jobs.get(path)?.abort();
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
    // Map order is least recently used first. Visible covers stay even when they exceed the budget.
    for (const path of this.covers.keys()) {
      if (this.covers.size <= MAX_CACHED_COVERS && this.coverBytes <= MAX_CACHED_COVER_BYTES) break;
      if (this.visible.has(path)) continue;
      this.releaseCover(path);
      const book = this.records.get(path);
      if (book) this.records.set(path, { ...book, coverUrl: undefined, metadataStatus: 'idle' });
      changed = true;
    }
    return changed;
  }

  private remove(path: string): void {
    this.cancel(path);
    this.releaseCover(path);
    this.records.delete(path);
    // Vue may reuse a card for a remove/create pair within one render; unmount clears visibility.
  }

  private enqueue(path: string): void {
    if (this.visible.has(path) && this.records.get(path)?.metadataStatus === 'idle') this.queue.add(path);
  }

  private pump(): void {
    while (!this.destroyed && this.activeMetadataJobCount < MAX_METADATA_JOBS && this.queue.size) {
      const path = this.queue.values().next().value!;
      this.queue.delete(path);
      const book = this.records.get(path);
      if (!this.visible.has(path) || !book || book.metadataStatus !== 'idle' || this.jobs.has(path)) continue;
      const controller = new AbortController();
      const loading: Book = { ...book, metadataStatus: 'loading' };
      this.jobs.set(path, controller);
      this.records.set(path, loading);
      this.activeMetadataJobCount++;
      this.emit();
      void this.load(loading, controller).finally(() => {
        // A cancelled native read still occupies its slot until it actually settles.
        this.activeMetadataJobCount--;
        if (this.jobs.get(path) === controller) this.jobs.delete(path);
        this.enqueue(path);
        this.pump();
      });
    }
  }

  private async load(loading: Book, controller: AbortController): Promise<void> {
    const { signal } = controller;
    const current = () => !this.destroyed && this.jobs.get(loading.path) === controller
      && this.records.get(loading.path) === loading;
    try {
      if (loading.size > MAX_EPUB_BYTES) throw new Error('too-large');
      const data = await this.vault.read(loading, signal);
      signal.throwIfAborted();
      const metadata = await this.readMetadata(data, signal);
      signal.throwIfAborted();
      if (!current()) return;
      const coverUrl = metadata.cover ? URL.createObjectURL(metadata.cover) : undefined;
      if (coverUrl && metadata.cover) {
        this.covers.set(loading.path, { url: coverUrl, size: metadata.cover.size });
        this.coverBytes += metadata.cover.size;
      }
      this.records.set(loading.path, {
        ...loading, title: metadata.title || loading.name, author: metadata.author,
        coverUrl, metadataStatus: 'ready',
      });
      this.trimCovers();
    } catch {
      if (!current()) return;
      this.records.set(loading.path, { ...loading, metadataStatus: signal.aborted ? 'idle' : 'error' });
    }
    this.emit();
  }
}
