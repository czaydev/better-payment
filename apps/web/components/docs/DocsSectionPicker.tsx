"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, ChevronsUpDown, ShoppingBag } from "lucide-react";
import { localePath, localeText, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

export type DocsSection = "docs" | "examples";

interface DocsSectionPickerProps {
  current: DocsSection;
  lang: Locale;
}

type Labels = {
  title: string;
  docs: string;
  docsHint: string;
  examples: string;
  examplesHint: string;
};

const LABELS: { en: Labels } & Partial<Record<Locale, Labels>> = {
  en: {
    title: "Section",
    docs: "Documentation",
    docsHint: "Guides & API Reference",
    examples: "Examples",
    examplesHint: "Storefronts & Demos",
  },
  tr: {
    title: "Bölüm",
    docs: "Dokümantasyon",
    docsHint: "Rehberler ve API",
    examples: "Örnekler",
    examplesHint: "Mağaza ve Demolar",
  },
};

export function DocsSectionPicker({ current, lang }: DocsSectionPickerProps) {
  const t = localeText(LABELS, lang);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sections = [
    {
      key: "docs" as const,
      title: t.docs,
      hint: t.docsHint,
      icon: BookOpen,
      href: localePath(lang, "/docs"),
    },
    {
      key: "examples" as const,
      title: t.examples,
      hint: t.examplesHint,
      icon: ShoppingBag,
      href: localePath(lang, "/examples"),
    },
  ];

  const active = sections.find((s) => s.key === current) ?? sections[0];
  const ActiveIcon = active.icon;

  return (
    <div ref={root} className="relative w-full">
      {/* Trigger button: fits naturally inside sidebar banner */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.title}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-10 w-full items-center gap-2.5 rounded-xl border border-border bg-card px-2.5 text-start transition-all",
          "hover:border-line-strong hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary",
          open && "border-primary/50 ring-2 ring-primary/10"
        )}
      >
        <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-tint text-accent-text">
          <ActiveIcon className="size-3.5" />
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {active.title}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {/* Popover Menu: inset-x-0 perfectly locks width to the trigger with no overflow */}
      {open && (
        <div
          role="listbox"
          aria-label={t.title}
          className="absolute inset-x-0 top-[calc(100%+6px)] z-50 flex flex-col gap-1 rounded-xl border border-border bg-popover/95 p-1.5 shadow-[0_16px_36px_-12px_var(--bp-shadow)] backdrop-blur-xl"
        >
          {sections.map((section) => {
            const isSelected = section.key === current;
            const Icon = section.icon;
            return (
              <Link
                key={section.key}
                href={section.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "group flex items-center gap-2.5 rounded-lg p-2 text-start transition-colors",
                  isSelected
                    ? "bg-accent/80 text-foreground"
                    : "text-foreground hover:bg-muted/80 focus-visible:bg-muted/80 focus-visible:outline-none"
                )}
              >
                <div
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                    isSelected
                      ? "bg-primary text-white shadow-xs"
                      : "bg-muted text-muted-foreground group-hover:text-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {section.title}
                  </div>
                  <div className="truncate text-[11px] leading-tight text-muted-foreground">
                    {section.hint}
                  </div>
                </div>
                {isSelected && (
                  <Check className="size-4 shrink-0 text-primary ms-1" />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

