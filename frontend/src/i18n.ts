import { i18n } from "@lingui/core";

export const LOCALES = { en: "English", uk: "Українська" } as const;
export type Locale = keyof typeof LOCALES;

const STORAGE_KEY = "locale";

export function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && saved in LOCALES) return saved as Locale;
  // Ukrainian is the default; an explicitly English browser still gets English.
  const nav = (navigator.language || "uk").toLowerCase();
  return nav.startsWith("en") ? "en" : "uk";
}

export async function activateLocale(locale: Locale) {
  const { messages } = await import(`./locales/${locale}/messages.po`);
  i18n.load(locale, messages);
  i18n.activate(locale);
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
}
