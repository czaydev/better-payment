"use client";

import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

const LABELS: Record<Locale, { version: string; stable: string; beta: string }> = {
  en: { version: "Version", stable: "Stable", beta: "Beta" },
  tr: { version: "Sürüm", stable: "Stabil", beta: "Beta" },
};

/**
 * Switches between the stable docs (/docs/...) and the beta docs (/beta/docs/...), the same page
 * in the other version. They are separate deployments on one domain, so the links are full page
 * loads (plain <a>), not client-side navigations.
 */
export function VersionPicker({ lang, beta }: { lang: Locale; beta: boolean }) {
  // Without the base path: "/tr/docs/x" in both versions
  const pathname = usePathname();
  const t = LABELS[lang];
  const options = [
    { key: "stable", label: t.stable, href: pathname, current: !beta },
    { key: "beta", label: t.beta, href: `/beta${pathname === "/" ? "" : pathname}`, current: beta },
  ];

  return (
    <nav aria-label={t.version} className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1 text-sm font-medium">
      {options.map((option) =>
        option.current ? (
          <span
            key={option.key}
            aria-current="page"
            className={cn(
              "rounded-lg px-2 py-1 text-center",
              option.key === "beta" ? "bg-tint text-accent-text" : "bg-secondary text-foreground",
            )}
          >
            {option.label}
          </span>
        ) : (
          <a
            key={option.key}
            href={option.href}
            className="rounded-lg px-2 py-1 text-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {option.label}
          </a>
        ),
      )}
    </nav>
  );
}
