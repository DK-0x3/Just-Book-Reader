import type { Book, BookFile, BookVault, LibrarySnapshot, MetadataReader, VaultChange } from '../domain/library';
import { MAX_EPUB_BYTES } from '../domain/epub-limits';

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
  private active?: { path: string; controller: AbortController };

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
      }
    } catch {
      if (!this.destroyed && generation === this.scanGeneration) this.scanError = 'vault';
    } finally {
      if (!this.destroyed && generation === this.scanGeneration) {
        this.scanning = false;
        this.emit();
        void this.loadNext();
      }
    }
  }

  setVisible(path: string, visible: boolean): void {
    if (this.destroyed) return;
    if (visible) this.visible.add(path);
    else {
      this.visible.delete(path);
      this.cancel(path);
      const book = this.records.get(path);
      if (book && (book.coverUrl || book.metadataStatus === 'loading')) {
        this.releaseCover(book);
        this.records.set(path, { ...book, coverUrl: undefined, metadataStatus: 'idle' });
        this.emit();
      }
    }
    void this.loadNext();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopVault();
    this.active?.controller.abort();
    for (const book of this.records.values()) this.releaseCover(book);
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
    void this.loadNext();
  }

  private upsert(file: BookFile): void {
    const existing = this.records.get(file.path);
    if (existing && existing.name === file.name && existing.size === file.size && existing.mtime === file.mtime) return;
    this.cancel(file.path);
    if (existing) this.releaseCover(existing);
    this.records.set(file.path, { ...file, title: file.name, metadataStatus: 'idle' });
  }

  private cancel(path: string): void {
    if (this.active?.path === path) this.active.controller.abort();
  }

  private releaseCover(book: Book): void {
    if (book.coverUrl) URL.revokeObjectURL(book.coverUrl);
  }

  private remove(path: string): void {
    this.cancel(path);
    const book = this.records.get(path);
    if (book) this.releaseCover(book);
    this.records.delete(path);
  }

  private async loadNext(): Promise<void> {
    if (this.destroyed || this.active) return;
    const next = [...this.visible].map(path => this.records.get(path)).find(book => book?.metadataStatus === 'idle');
    if (!next) return;
    const job = { path: next.path, controller: new AbortController() };
    const loading: Book = { ...next, metadataStatus: 'loading' };
    this.active = job;
    this.records.set(next.path, loading);
    this.emit();
    const signal = job.controller.signal;
    try {
      if (next.size > MAX_EPUB_BYTES) throw new Error('too-large');
      const data = await this.vault.read(next, signal);
      signal.throwIfAborted();
      const metadata = await this.readMetadata(data, signal);
      signal.throwIfAborted();
      // A renamed/replaced file or closed view must never receive an older result.
      if (this.destroyed || this.records.get(next.path) !== loading) return;
      const coverUrl = metadata.cover ? URL.createObjectURL(metadata.cover) : undefined;
      this.records.set(next.path, {
        ...loading, title: metadata.title || next.name, author: metadata.author,
        coverUrl, metadataStatus: 'ready',
      });
    } catch {
      if (!this.destroyed && this.records.get(next.path) === loading) {
        this.records.set(next.path, { ...loading, metadataStatus: signal.aborted ? 'idle' : 'error' });
      }
    } finally {
      this.active = undefined;
      this.emit();
      void this.loadNext();
    }
  }
}
