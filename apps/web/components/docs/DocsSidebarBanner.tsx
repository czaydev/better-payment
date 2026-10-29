"use client";

import { DocsSectionPicker, type DocsSection } from "@/components/docs/DocsSectionPicker";
import { VersionPicker } from "@/components/docs/VersionPicker";
import type { Locale } from "@/lib/i18n/config";

interface DocsSidebarBannerProps {
  section: DocsSection;
  lang: Locale;
  showVersionPicker?: boolean;
  beta?: boolean;
}

export function DocsSidebarBanner({
  section,
  lang,
  showVersionPicker,
  beta = false,
}: DocsSidebarBannerProps) {
  return (
    <div className="flex w-full flex-col gap-2 pb-1">
      <DocsSectionPicker current={section} lang={lang} />
      {showVersionPicker && <VersionPicker lang={lang} beta={beta} />}
    </div>
  );
}
