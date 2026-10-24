import { DEFAULT_LOCALE, localeText, type Locale } from "@/lib/i18n/config";
import { releaseStatus, type ReleaseStatus } from "@/lib/release";

export interface SinceProps {
  version: string;
  lang?: Locale;
}

/** Per-language labels; languages without their own copy fall back to English */
type LangText<T> = { en: T } & Partial<Record<Locale, T>>;

const LABELS: Record<ReleaseStatus, LangText<(version: string) => string>> = {
  stable: { en: (v) => `Added in ${v}`, tr: (v) => `${v} sürümünde eklendi` },
  beta: { en: (v) => `Beta · ${v}`, tr: (v) => `Beta · ${v}` },
  unreleased: { en: () => "Not released yet", tr: () => "Henüz yayınlanmadı" },
};

const TITLES: Partial<Record<ReleaseStatus, LangText<string>>> = {
  beta: {
    en: "In the beta release: npm install better-payment@beta",
    tr: "Beta sürümde: npm install better-payment@beta",
  },
};

const STYLES: Record<ReleaseStatus, string> = {
  stable: "border-border bg-secondary text-secondary-foreground",
  beta: "border-primary/30 bg-tint text-accent-text",
  unreleased: "border-warning/30 bg-warning-soft text-warning",
};

export function Since({ version, lang = DEFAULT_LOCALE }: SinceProps) {
  const status = releaseStatus(version);

  return (
    <span
      className={`not-prose my-2 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
      title={TITLES[status] ? localeText(TITLES[status], lang) : undefined}
      data-release-status={status}
    >
      {localeText(LABELS[status], lang)(version)}
    </span>
  );
}
