import { isEpubPath, type BookFile, type BookVault, type VaultChange } from '../src/domain/library';

/** Selected files stay in memory. There is no upload or binary read in this stage. */
export class BrowserVault implements BookVault {
  private files = new Map<string, File>();
  private listeners = new Set<(change: VaultChange) => void>();

  async list(): Promise<BookFile[]> {
    return [...this.files.values()].map(file => this.describe(file));
  }

  subscribe(listener: (change: VaultChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  add(files: readonly File[]): void {
    for (const file of files) {
      if (!isEpubPath(file.name)) continue;
      this.files.set(file.name, file);
      for (const listener of this.listeners) listener({ type: 'upsert', file: this.describe(file) });
    }
  }

  clear(): void {
    this.files.clear();
    for (const listener of this.listeners) listener({ type: 'reset' });
  }

  private describe(file: File): BookFile {
    return { path: file.name, name: file.name.replace(/\.epub$/i, ''), size: file.size, mtime: file.lastModified };
  }
}
