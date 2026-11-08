export interface BookFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mtime: number;
}

export interface BookMetadata {
  readonly title?: string;
  readonly author?: string;
  readonly cover?: Blob;
}

export type MetadataReader = (data: ArrayBuffer, signal: AbortSignal) => Promise<BookMetadata>;

export interface Book extends BookFile {
  readonly title: string;
  readonly author?: string;
  readonly coverUrl?: string;
  readonly metadataStatus: 'idle' | 'loading' | 'ready' | 'error';
  readonly metadataError?: 'too-large' | 'invalid';
}

export interface LibrarySnapshot {
  readonly books: readonly Book[];
  readonly scanning: boolean;
  readonly error?: 'vault';
  readonly cacheError?: boolean;
  readonly indexing?: {
    readonly completed: number;
    readonly total: number;
    readonly failed: number;
  };
}

export type VaultChange =
  | {
    type: 'reset';
  }
  | {
    type: 'upsert';
    file: BookFile;
  }
  | {
    type: 'remove';
    path: string;
  }
  | {
    type: 'rename';
    oldPath: string;
    file: BookFile;
  };

/** Host-specific file access; metadata parsing belongs to a separate reader. */
export interface BookVault {
  /** A browser with no selected files cannot reconcile a previous session's cache yet. */
  readonly canPruneCache?: boolean;
  list(): Promise<readonly BookFile[]>;
  read(file: BookFile, signal: AbortSignal): Promise<ArrayBuffer>;
  subscribe(listener: (change: VaultChange) => void): () => void;
}

export function isEpubPath(path: string): boolean {
  return path.toLowerCase().endsWith('.epub');
}

export type BookSort = 'title' | 'author';

const bookCollator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

function normalizeBookText(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

export function filterBooks(books: readonly Book[], query: string, sort?: BookSort): Book[] {
  const needle = normalizeBookText(query.trim());
  const filtered = books.filter(book => normalizeBookText(`${book.title} ${book.author || ''}`).includes(needle));
  if (!sort) return filtered;
  return filtered.sort((a, b) => bookCollator.compare(normalizeBookText(a[sort] || ''), normalizeBookText(b[sort] || ''))
    || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
