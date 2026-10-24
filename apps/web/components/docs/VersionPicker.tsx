"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";
import type { Locale } from "@/lib/i18n/config";
import { DEFAULT_LOCALE, localeText } from "@/lib/i18n/config";
import { PACKAGE_VERSION } from "@/lib/release";
import { cn } from "@/lib/utils";

type Labels = { version: string; stable: string; beta: string; stableHint: string; betaHint: string };
const LABELS: { en: Labels } & Partial<Record<Locale, Labels>> = {
  en: { version: "Version", stable: "Stable", beta: "Beta", stableHint: "Latest release", betaHint: "Upcoming features" },
  tr: { version: "Sürüm", stable: "Stabil", beta: "Beta", stableHint: "Son sürüm", betaHint: "Yaklaşan özellikler" },
};

/**
 * Switches between the stable docs (/docs/...) and the beta docs (/beta/docs/...), the same page
 * in the other version. They are separate deployments on one domain, so a switch is a full page
 * load. When the other version has no such page, it lands on that version's docs home instead.
 */
export function VersionPicker({ lang, beta }: { lang: Locale; beta: boolean }) {
  // Without the base path: "/tr/docs/x" in both versions
  const pathname = usePathname();
  const t = localeText(LABELS, lang);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const docsHome = lang === DEFAULT_LOCALE ? "/docs" : `/${lang}/docs`;
  const options = [
    { key: "stable", label: t.stable, hint: t.stableHint, prefix: "", current: !beta },
    { key: "beta", label: t.beta, hint: t.betaHint, prefix: "/beta", current: beta },
  ] as const;
  const current = options.find((option) => option.current)!;

  async function go(prefix: string) {
    setBusy(true);
    const target = `${prefix}${pathname === "/" ? "" : pathname}`;
    let href = target;
    try {
      const response = await fetch(target, { method: "HEAD" });
      if (!response.ok) href = `${prefix}${docsHome}`;
    } catch {
      href = `${prefix}${docsHome}`;
    }
    // A different deployment, so this has to be a full page load, not a client-side navigation
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(href);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.version}
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-border bg-card px-3 text-start text-sm font-medium transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 font-mono text-[11px]",
            beta ? "bg-tint text-accent-text" : "bg-secondary text-foreground",
          )}
        >
          v{PACKAGE_VERSION}
        </span>
        <span className="flex-1 text-foreground">{current.label}</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t.version}
          className="absolute inset-x-0 top-[calc(100%+6px)] z-50 grid gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-[0_16px_32px_-16px_var(--bp-shadow)]"
        >
          {options.map((option) => (
            <li key={option.key} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={option.current}
                disabled={busy}
                onClick={() => (option.current ? setOpen(false) : go(option.prefix))}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60"
              >
                <span className="flex-1">
                  <span className="block text-sm font-medium text-foreground">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.hint}</span>
                </span>
                {option.current && <Check className="size-4 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
