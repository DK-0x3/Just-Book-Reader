export interface BookFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mtime: number;
}

export interface Book extends BookFile {
  readonly title: string;
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

/** Catalog access only. Binary reading is introduced with EPUB metadata. */
export interface BookVault {
  list(): Promise<readonly BookFile[]>;
  subscribe(listener: (change: VaultChange) => void): () => void;
}

export function isEpubPath(path: string): boolean {
  return path.toLowerCase().endsWith('.epub');
}
