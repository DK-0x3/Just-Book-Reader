import { MAX_EPUB_BYTES } from '../domain/epub-limits';

export const MAX_LIBRARY_JOBS = 2;
export const MAX_ACTIVE_EPUB_BYTES = MAX_EPUB_BYTES;

export interface WorkLease { release(): void; promote(): void }

/** Shared by views so cancelled native reads still count during a reopen. */
export class LibraryWorkBudget {
  private leases = new Set<{ bytes: number; background: boolean }>();
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  acquire(bytes: number, background: boolean): WorkLease | undefined {
    const reserved = Math.min(bytes, MAX_EPUB_BYTES);
    const used = [...this.leases].reduce((total, lease) => total + lease.bytes, 0);
    if (this.leases.size >= MAX_LIBRARY_JOBS || (this.leases.size && used + reserved > MAX_ACTIVE_EPUB_BYTES)
      || (background && [...this.leases].some(lease => lease.background))) return;
    const lease = { bytes: reserved, background };
    this.leases.add(lease);
    return {
      release: () => { if (this.leases.delete(lease)) this.notify(); },
      promote: () => { if (lease.background) { lease.background = false; this.notify(); } },
    };
  }

  private notify(): void {
    queueMicrotask(() => { for (const listener of this.listeners) listener(); });
  }
}
