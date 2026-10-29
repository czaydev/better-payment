"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { buttonVariants } from "@/lib/button-variants";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowUpRight, Check, ChevronDown, ChevronRight, Globe, Menu, X,
} from "lucide-react";
import { GitHubIcon } from "@/components/icons";
import ThemeToggle from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { LOCALES, localeName, localePath, type Locale } from "@/lib/i18n/config";
import { switchLocale, switchLocalePath } from "@/lib/i18n/switch";
import { withBasePath } from "@/lib/base-path";
import { GITHUB_URL, MENU_ICON_ASSETS, MENU_KEYS, menus, type MenuIcon, type MenuKey } from "@/lib/nav-menu";

// Homepage sections are reached by scrolling, without a #hash in the address bar
export const SCROLL_TARGET_KEY = "bp-scroll-to";

function MenuIconVisual({ icon, className }: { icon: MenuIcon; className?: string }) {
  if (icon === "github") {
    return <GitHubIcon aria-hidden className={className} />;
  }

  return (
    <Image
      src={withBasePath(MENU_ICON_ASSETS[icon])}
      width={64}
      height={64}
      alt=""
      aria-hidden
      className={cn("object-contain", className)}
    />
  );
}

/** Menu of every supported language; switches to the same page in the chosen one */
function LanguageMenu({ lang, label }: { lang: Locale; label: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
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

  const menuItems = LOCALES.map((target) => {
    const current = target === lang;
    return (
      <Link
        key={target}
        href={switchLocalePath(target, pathname)}
        hrefLang={target}
        aria-current={current ? "true" : undefined}
        // Not prefetched: the other language is opened with a full load (see switchLocale)
        prefetch={false}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          setOpen(false);
          if (current) return;
          switchLocale(target, pathname);
        }}
        className={cn(
          "flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
          current ? "text-foreground bg-accent/50" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
        )}
      >
        <span className="font-mono uppercase">{target}</span>
        <span>{localeName(target, lang)}</span>
        {current && <Check className="size-3.5 shrink-0 text-primary" />}
      </Link>
    );
  });

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "h-9 gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground uppercase hover:text-foreground"
        )}
      >
        <Globe className="size-3.5" />
        {lang}
        <ChevronDown className={cn("size-3 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full end-0 z-50 mt-1 min-w-40 rounded-2xl border border-border bg-card p-1"
        >
          {menuItems}
        </div>
      )}
    </div>
  );
}

export default function Navbar({
  version,
  lang,
  t,
  position = "fixed",
}: {
  version: string;
  lang: Locale;
  t: Dictionary["nav"];
  /** `sticky` keeps the bar in the page flow (docs), `fixed` floats it over the content (homepage) */
  position?: "fixed" | "sticky";
}) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<MenuKey | null>(null);
  const [mobileOpen, setMobileOpen] = useState<MenuKey | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const headerRef = useRef<HTMLElement>(null);

  const menu = t.menu;
  const href = (path: string) => (path.startsWith("http") ? path : localePath(lang, path));

  const show = useCallback((key: MenuKey) => {
    clearTimeout(closeTimer.current);
    setActive(key);
  }, []);
  const hideSoon = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setActive(null), 140);
  }, []);
  const close = useCallback(() => {
    clearTimeout(closeTimer.current);
    setActive(null);
    setOpen(false);
  }, []);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    handler();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    const onPointer = (event: PointerEvent) => {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) setActive(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [close]);

  function renderPanel(key: MenuKey) {
    const def = menus[key];
    const copy = menu[key];
    const groupCopy = copy.groups as Record<string, string>;
    const itemCopy = copy.items as Record<string, string>;
    return (
      <div className="grid grid-cols-[minmax(280px,340px)_1fr]">
        {/* Intro */}
        <div className="border-r border-border py-9 pr-10">
          <span className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-primary/10 bg-tint/70">
            <MenuIconVisual icon={def.icon} className="size-10" />
          </span>
          <p className="text-title-sm text-foreground">{copy.label}</p>
          <p className="mt-3 text-body leading-relaxed text-muted-foreground">{copy.desc}</p>
          <Link
            href={href(def.href)}
            onClick={close}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "mt-6 rounded-full",
            )}
          >
            {copy.cta}
          </Link>
        </div>

        {/* Groups */}
        <div
          className="grid content-start gap-x-8 gap-y-9 py-9 pl-12"
          style={{ gridTemplateColumns: `repeat(${def.groups.length}, minmax(0, 1fr))` }}
        >
          {def.groups.map((group) => (
            <div key={group.id}>
              <p className="mb-4 text-caption font-medium text-muted-foreground">
                {groupCopy[group.id]}
              </p>
              <ul className="grid gap-1">
                {group.items.map((item) => {
                  const external = "external" in item && item.external;
                  return (
                    <li key={item.id}>
                      <Link
                        href={href(item.href)}
                        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        onClick={close}
                        className="group/item -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-body font-medium text-foreground transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-primary/10 bg-tint/70 transition-[background-color,border-color] duration-200 group-hover/item:border-primary/25 group-hover/item:bg-tint">
                          <MenuIconVisual
                            icon={item.icon}
                            className={cn(
                              "size-7 transition-transform duration-200 group-hover/item:scale-110",
                              item.icon === "github" && "size-4.5 text-foreground",
                            )}
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{itemCopy[item.id]}</span>
                        {external && <ArrowUpRight className="size-3.5 text-muted-foreground transition-colors group-hover/item:text-primary" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <header
      ref={headerRef}
      onMouseLeave={hideSoon}
      className={cn(
        position === "fixed" ? "fixed" : "sticky",
        "top-0 left-0 right-0 z-50 border-b transition-[background-color,border-color] duration-200",
        active
          ? "border-border bg-card"
          : scrolled || open
            ? "border-border bg-background"
          : "border-transparent bg-background/60 backdrop-blur-xl",
      )}
    >
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-[97rem] items-center px-4 sm:px-6 md:px-4">
        {/* Logo */}
        <Link href={localePath(lang, "/")} className="group flex items-center gap-2.5 lg:flex-1">
          <Image
            src={withBasePath("/brand/better-payment-horizontal-color.svg")}
            width={1226}
            height={155}
            alt="Better Payment"
            priority
            className="h-6 w-auto dark:hidden"
          />
          <Image
            src={withBasePath("/brand/better-payment-horizontal-dark.svg")}
            width={1226}
            height={155}
            alt="Better Payment"
            priority
            className="hidden h-6 w-auto dark:block"
          />
          <Badge variant="secondary" className="hidden px-1.5 py-0 font-mono text-micro tracking-tight min-[1500px]:flex">
            v{version}
          </Badge>
        </Link>

        {/* Desktop nav, centred like the reference */}
        <div className="hidden items-center justify-center lg:flex">
          <div className="flex items-center gap-1">
            {MENU_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-expanded={active === key}
                aria-controls="mega-panel"
                onMouseEnter={() => show(key)}
                onFocus={() => show(key)}
                onClick={() => (active === key ? setActive(null) : show(key))}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-body font-medium whitespace-nowrap transition-colors duration-300 outline-none focus-visible:outline-2 focus-visible:outline-primary",
                  active === key ? "bg-muted text-foreground" : "text-foreground hover:bg-muted",
                )}
              >
                {menu[key].label}
                <ChevronDown className={cn("size-4 transition-transform duration-200", active === key && "rotate-180")} />
              </button>
            ))}
            <Link
              href={localePath(lang, "/examples")}
              onMouseEnter={hideSoon}
              className="rounded-full px-3.5 py-2 text-body font-medium whitespace-nowrap text-foreground transition-colors duration-300 hover:bg-muted"
            >
              {lang === "tr" ? "Örnekler" : "Examples"}
            </Link>
          </div>
        </div>

        {/* Desktop actions */}
        <div className="hidden flex-1 items-center justify-end gap-1.5 pl-6 lg:flex" onMouseEnter={hideSoon}>
          <ThemeToggle label={t.theme} />
          <LanguageMenu lang={lang} label={t.language} />
          <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full")}
          >
            <GitHubIcon data-icon="brand" />
            GitHub
          </a>
          <Link href={localePath(lang, "/docs")} className={cn(buttonVariants({ size: "sm", pill: true }), "px-4")}>
            {t.getStarted}
            <ChevronRight data-icon="chevron" />
          </Link>
        </div>

        {/* Mobile menu toggle */}
        <button
          aria-label={t.openMenu}
          aria-expanded={open}
          className="ml-auto rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground lg:hidden"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* Desktop mega panel: solid surface, dimmed page underneath */}
      <div
        id="mega-panel"
        onMouseEnter={() => active && show(active)}
        className={cn(
          "absolute inset-x-0 top-full hidden border-b border-border bg-card  transition-[opacity,translate,visibility] duration-(--bp-d-sm) ease-brand lg:block",
          active ? "visible translate-y-0 opacity-100" : "pointer-events-none invisible -translate-y-1 opacity-0",
        )}
      >
        <div className="mx-auto max-w-[97rem] px-4 sm:px-6 md:px-4">{active && renderPanel(active)}</div>
      </div>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed inset-x-0 top-16 bottom-0 -z-10 hidden bg-background/30 backdrop-blur-md transition-opacity duration-(--bp-d-sm) lg:block",
          active ? "opacity-100" : "opacity-0",
        )}
      />

      {/* Mobile menu */}
      {open && (
        <div className="flex max-h-[calc(100svh-4rem)] flex-col gap-0.5 overflow-y-auto border-t border-border bg-background px-5 py-3 lg:hidden">
          {MENU_KEYS.map((key) => {
            const expanded = mobileOpen === key;
            const groupCopy = menu[key].groups as Record<string, string>;
            const itemCopy = menu[key].items as Record<string, string>;
            return (
              <div key={key} className="border-b border-border/70 last:border-0">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setMobileOpen(expanded ? null : key)}
                  className="flex w-full items-center justify-between px-1 py-3.5 text-body font-semibold text-foreground"
                >
                  {menu[key].label}
                  <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                </button>
                {expanded && (
                  <div className="grid gap-4 pb-4">
                    {menus[key].groups.map((group) => (
                      <div key={group.id}>
                        <p className="px-1 pb-1.5 text-caption font-medium text-muted-foreground">
                          {groupCopy[group.id]}
                        </p>
                        {group.items.map((item) => {
                          return (
                            <Link
                              key={item.id}
                              href={href(item.href)}
                              onClick={close}
                              className="flex items-center gap-3 rounded-lg px-1 py-2 text-sm font-medium text-foreground hover:text-primary"
                            >
                              <span className="flex size-7 items-center justify-center overflow-hidden rounded-lg border border-primary/10 bg-tint/70">
                                <MenuIconVisual
                                  icon={item.icon}
                                  className={cn("size-6", item.icon === "github" && "size-3.5 text-foreground")}
                                />
                              </span>
                              {itemCopy[item.id]}
                            </Link>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <Link href={localePath(lang, "/examples")} onClick={close} className="px-1 py-3.5 text-body font-semibold text-foreground">
            {lang === "tr" ? "Örnekler" : "Examples"}
          </Link>
          <Separator className="my-1.5" />
          <div className="flex gap-2 pt-2 pb-1">
            <ThemeToggle label={t.theme} className="h-9 shrink-0" />
            <LanguageMenu lang={lang} label={t.language} />
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
            >
              <GitHubIcon data-icon="brand" />
              GitHub
            </a>
            <Link href={localePath(lang, "/docs")} className={cn(buttonVariants({ size: "sm" }), "flex-1")} onClick={close}>
              {t.getStarted}
              <ChevronRight data-icon="chevron" />
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
