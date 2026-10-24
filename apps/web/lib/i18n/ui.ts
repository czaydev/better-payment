import { defineI18nUI } from "fumadocs-ui/i18n";
import { i18n, LOCALES, LOCALE_NAMES, type Locale } from "./config";

/**
 * Labels of the fumadocs UI (search, table of contents, language picker, ...).
 * Every language gets its display name from the registry automatically; only the
 * labels a language has translated are listed here. Languages without an entry
 * keep fumadocs' English defaults, so adding a language does not require touching
 * this file (see TRANSLATIONS.md → Adding a language).
 */
const LABELS: Partial<Record<Locale, Record<string, string>>> = {
  tr: {
    displayName: "Türkçe",
    search: "Ara",
    searchNoResult: "Sonuç bulunamadı",
    toc: "Bu sayfada",
    tocNoHeadings: "Başlık yok",
    lastUpdate: "Son güncelleme",
    chooseLanguage: "Dil seçin",
    nextPage: "Sonraki sayfa",
    previousPage: "Önceki sayfa",
    chooseTheme: "Tema",
    editOnGithub: "GitHub'da düzenle",
  },
};

export const i18nUI = defineI18nUI(
  i18n,
  Object.fromEntries(LOCALES.map((lang) => [lang, { displayName: LOCALE_NAMES[lang], ...LABELS[lang] }])) as Partial<
    Record<Locale, Record<string, string> & { displayName: string }>
  >
);
