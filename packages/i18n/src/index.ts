export const locales = ['zh-CN', 'en-US'] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = 'zh-CN';

export function isAppLocale(value: string): value is AppLocale {
  return locales.some((locale) => locale === value);
}

export function negotiateLocale(
  requested: string | null | undefined,
  fallback: AppLocale = defaultLocale
): AppLocale {
  if (!requested) return fallback;

  const normalized = requested.toLowerCase();
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('en')) return 'en-US';
  return fallback;
}
