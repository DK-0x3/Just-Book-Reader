export const galleryThemes = ['obsidian', 'dark', 'light', 'sepia', 'eink'] as const;
export type GalleryTheme = (typeof galleryThemes)[number];
export type DeviceProfile = 'desktop' | 'mobile';
export type PreferencesData = Record<string, unknown>;

export function isGalleryTheme(value: unknown): value is GalleryTheme {
  return galleryThemes.some(theme => theme === value);
}

export interface PreferencesStorage {
  read(): Promise<unknown>;
  /** Apply a validated merge to the latest stored document. */
  update(change: (data: unknown) => PreferencesData): Promise<void>;
}

export interface PreferencesSnapshot {
  readonly theme: GalleryTheme;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error?: 'load' | 'save';
}
