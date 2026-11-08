import {
  isGalleryTheme,
  type DeviceProfile,
  type GalleryTheme,
  type PreferencesData,
} from '../domain/preferences';

function isRecord(value: unknown): value is PreferencesData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validate(data: unknown): PreferencesData {
  if (data === undefined) return { schemaVersion: 1 };
  if (!isRecord(data) || data.schemaVersion !== 1
    || (data.profiles !== undefined && !isRecord(data.profiles))) throw new Error('invalid-preferences');
  return data;
}

function profileData(data: PreferencesData, profile: DeviceProfile): PreferencesData {
  const profiles = data.profiles as PreferencesData | undefined;
  const settings = profiles?.[profile];
  if (settings === undefined) return {};
  if (!isRecord(settings)) throw new Error('invalid-profile');
  return settings;
}

export function readTheme(data: unknown, profile: DeviceProfile): GalleryTheme {
  const value = profileData(validate(data), profile).galleryTheme;
  if (value === undefined) return 'obsidian';
  if (!isGalleryTheme(value)) throw new Error('invalid-theme');
  return value;
}

export function withTheme(data: unknown, profile: DeviceProfile, theme: GalleryTheme): PreferencesData {
  if (!isGalleryTheme(theme)) throw new Error('invalid-theme');
  const record = validate(data);
  readTheme(record, profile);
  return {
    ...record, profiles: {
      ...(record.profiles as PreferencesData | undefined),
      [profile]: { ...profileData(record, profile), galleryTheme: theme }
    }
  };
}
