"use client";

import { Banner } from "fumadocs-ui/components/banner";
import { Badge } from "@czayelements/zay-ui";
import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { localeText } from "@/lib/i18n/config";

const LABELS: { en: { title: string; link: string } } & Partial<Record<Locale, { title: string; link: string }>> = {
  en: { title: "You are viewing the beta docs.", link: "Go to the stable docs" },
  tr: { title: "Beta sürümün dokümanını görüntülüyorsunuz.", link: "Stabil dokümana geç" },
};

/** A bar above every page of the beta docs, with a link to the same page in the stable docs */
export function BetaBanner({ lang }: { lang: Locale }) {
  // Without the base path, so it is the same page on the stable deployment (a full page load)
  const pathname = usePathname();
  const t = localeText(LABELS, lang);

  return (
    // Scrolls away with the page: the site navbar is the sticky bar above the docs
    <Banner changeLayout={false} className="relative gap-2 bg-tint text-accent-text">
      <Badge variant="brand" className="font-mono text-[11px]">Beta</Badge>
      <span className="font-semibold">{t.title}</span>
      <a href={pathname} className="underline underline-offset-4">
        {t.link}
      </a>
    </Banner>
  );
}
