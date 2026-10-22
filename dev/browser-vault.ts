import { isEpubPath, type BookFile, type BookVault, type VaultChange } from '../src/domain/library';

/** Selected files stay in memory. Reading stays local; there is no upload. */
export class BrowserVault implements BookVault {
  private files = new Map<string, File>();
  private listeners = new Set<(change: VaultChange) => void>();

  async list(): Promise<BookFile[]> {
    return [...this.files.values()].map(file => this.describe(file));
  }

  async read(book: BookFile, signal: AbortSignal): Promise<ArrayBuffer> {
    signal.throwIfAborted();
    const file = this.files.get(book.path);
    if (!file || file.size !== book.size || file.lastModified !== book.mtime) throw new Error('file-changed');
    const data = await file.arrayBuffer();
    signal.throwIfAborted();
    return data;
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
