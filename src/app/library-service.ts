import type { Book, BookFile, BookVault, LibrarySnapshot, VaultChange } from '../domain/library';

/** One view owns one catalog subscription. No EPUB contents are read here. */
export class LibraryService {
  private records = new Map<string, Book>();
  private listeners = new Set<(snapshot: LibrarySnapshot) => void>();
  private stopVault: () => void;
  private destroyed = false;
  private scanGeneration = 0;
  private changeGeneration = 0;
  private scanning = false;
  private scanError?: 'vault';

  constructor(private vault: BookVault) {
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
      for (const path of this.records.keys()) if (!found.has(path)) this.records.delete(path);
      for (const file of files) this.upsert(file);
    } catch {
      if (!this.destroyed && generation === this.scanGeneration) this.scanError = 'vault';
    } finally {
      if (!this.destroyed && generation === this.scanGeneration) {
        this.scanning = false;
        this.emit();
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopVault();
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
    if (change.type === 'remove') this.records.delete(change.path);
    else {
      if (change.type === 'rename') this.records.delete(change.oldPath);
      this.upsert(change.file);
    }
    this.emit();
  }

  private upsert(file: BookFile): void {
    const existing = this.records.get(file.path);
    if (existing && existing.name === file.name && existing.size === file.size && existing.mtime === file.mtime) return;
    this.records.set(file.path, { ...file, title: file.name });
  }
}
