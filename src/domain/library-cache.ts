import type { BookFile, BookMetadata } from './library';

export interface CachedBook extends BookFile {
  readonly title?: string;
  readonly author?: string;
  readonly hasCover: boolean;
  readonly cover?: {
    readonly key: string;
    readonly size: number;
    readonly type: string;
    readonly used: number;
  };
}

/** Text remains indexed when a binary cover is evicted. */
export interface LibraryCache {
  readonly failed: boolean;
  open(): Promise<void>;
  get(file: BookFile): CachedBook | undefined;
  readCover(file: BookFile, signal: AbortSignal): Promise<Blob | undefined>;
  put(file: BookFile, metadata: BookMetadata, signal: AbortSignal): Promise<void>;
  retain(files: readonly BookFile[]): Promise<void>;
  remove(path: string): Promise<void>;
  flush(): Promise<void>;
}

export function sameBookFile(a: BookFile, b: BookFile): boolean {
  return a.path === b.path && a.name === b.name && a.size === b.size && a.mtime === b.mtime;
}
