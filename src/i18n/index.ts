import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import ru from './locales/ru.json';

export type Locale = 'en' | 'ru';
export type MessageSchema = typeof en;

export function resolveLocale(locale: string): Locale {
  const language = locale.trim().toLowerCase().split(/[-_]/)[0];
  return language === 'ru' ? 'ru' : 'en';
}

/** Each Vue app owns its instance; unmount disposes it. Native UI owns a separate one. */
export function createLocalization(locale = 'en') {
  return createI18n({
    legacy: false,
    globalInjection: false,
    locale: resolveLocale(locale),
    fallbackLocale: 'en',
    messages: { en, ru } satisfies Record<Locale, MessageSchema>,
  });
}

export type Localization = ReturnType<typeof createLocalization>;
