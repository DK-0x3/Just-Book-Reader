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
}

export interface LibrarySnapshot {
  readonly books: readonly Book[];
  readonly scanning: boolean;
  readonly error?: 'vault';
}

export type VaultChange =
  | { type: 'reset' }
  | { type: 'upsert'; file: BookFile }
  | { type: 'remove'; path: string }
  | { type: 'rename'; oldPath: string; file: BookFile };

/** Host-specific file access; metadata parsing belongs to a separate reader. */
export interface BookVault {
  list(): Promise<readonly BookFile[]>;
  read(file: BookFile, signal: AbortSignal): Promise<ArrayBuffer>;
  subscribe(listener: (change: VaultChange) => void): () => void;
}

export function isEpubPath(path: string): boolean {
  return path.toLowerCase().endsWith('.epub');
}
