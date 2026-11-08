import {
  isGalleryTheme,
  type DeviceProfile,
  type GalleryTheme,
  type PreferencesSnapshot,
  type PreferencesStorage,
} from '../domain/preferences';
import { readTheme, withTheme } from './preferences';

/** One host owns this queue; views only subscribe and request changes. */
export class PreferencesService {
  private state: PreferencesSnapshot = { theme: 'obsidian', loading: true, saving: false };
  private listeners = new Set<(value: PreferencesSnapshot) => void>();
  private loading?: Promise<void>;
  private writeQueue = Promise.resolve();
  private pendingWriteCount = 0;
  private confirmedTheme: GalleryTheme = 'obsidian';
  private latestRequestId = 0;
  private disposed = false;

  constructor(private storage: PreferencesStorage, readonly profile: DeviceProfile) {}

  snapshot(): PreferencesSnapshot {
    return this.state;
  }

  subscribe(listener: (value: PreferencesSnapshot) => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  load(): Promise<void> {
    return this.loading ??= this.read();
  }

  private async read(): Promise<void> {
    try {
      const theme = readTheme(await this.storage.read(), this.profile);
      this.confirmedTheme = theme;
      this.publish({ ...this.state, theme: this.pendingWriteCount ? this.state.theme : theme, loading: false, error: undefined });
    } catch {
      this.publish({ ...this.state, loading: false, error: 'load' });
    }
  }

  setTheme(theme: GalleryTheme): Promise<boolean> {
    if (this.disposed || !isGalleryTheme(theme)) return Promise.resolve(false);
    const requestId = ++this.latestRequestId;
    this.pendingWriteCount++;
    this.publish({ ...this.state, theme, saving: true, error: undefined });
    const write = this.writeQueue.then(async () => {
      await this.load();
      let saved = false;
      try {
        await this.storage.update(data => withTheme(data, this.profile, theme));
        this.confirmedTheme = theme;
        saved = true;
      } catch {
        if (requestId === this.latestRequestId) {
          this.publish({ ...this.state, theme: this.confirmedTheme, error: 'save' });
        }
      } finally {
        this.pendingWriteCount--;
        this.publish({ ...this.state, saving: this.pendingWriteCount > 0 });
      }
      return saved;
    });
    this.writeQueue = write.then(() => {});
    return write;
  }

  flush(): Promise<void> {
    return this.writeQueue;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private publish(value: PreferencesSnapshot): void {
    this.state = value;
    if (!this.disposed) for (const listener of this.listeners) listener(value);
  }
}
