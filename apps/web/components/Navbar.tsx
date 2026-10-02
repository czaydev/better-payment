"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Image from "next/image";
import { useTheme } from "next-themes";
import { buttonVariants } from "@/lib/button-variants";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Menu, X, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { LOCALE_NAMES, localePath, stripLocale, type Locale } from "@/lib/i18n/config";

function navLinks(t: Dictionary["nav"]) {
  return [
    { label: t.features, href: "/#features" },
    { label: t.providers, href: "/#providers" },
    { label: t.quickStart, href: "/#quickstart" },
    { label: t.docs, href: "/docs" },
  ];
}

/** Switches the language and stays on the same page */
function LanguageSwitch({ lang, label }: { lang: Locale; label: string }) {
  const pathname = usePathname();
  const other: Locale = lang === "tr" ? "en" : "tr";
  const path = stripLocale(pathname || "/");
  // "/en/..." makes the proxy remember English and redirect to the unprefixed URL
  const href = other === "en" ? `/en${path === "/" ? "" : path}` : localePath("tr", path);
  return (
    <Link
      href={href}
      hrefLang={other}
      aria-label={`${label}: ${LOCALE_NAMES[other]}`}
      className={cn(
        buttonVariants({ variant: "ghost", size: "sm" }),
        "text-muted-foreground hover:text-foreground h-8 px-2.5 text-xs font-medium font-mono uppercase",
      )}
    >
      {other}
    </Link>
  );
}

function ThemeToggle({ label }: { label: string }) {
  const { theme, setTheme } = useTheme();
  // false during SSR and hydration, true afterwards (the theme is only known on the client)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted) return <div className="w-8 h-8" />;
  return (
    <button
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon" }),
        "h-8 w-8 text-muted-foreground hover:text-foreground",
      )}
      aria-label={label}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? (
        <Sun className="h-[15px] w-[15px]" />
      ) : (
        <Moon className="h-[15px] w-[15px]" />
      )}
    </button>
  );
}

export default function Navbar({
  version,
  lang,
  t,
}: {
  version: string;
  lang: Locale;
  t: Dictionary["nav"];
}) {
  const links = navLinks(t);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-200",
        scrolled
          ? "bg-background/85 backdrop-blur-2xl border-b border-border"
          : "bg-background/60 backdrop-blur-xl border-b border-transparent",
      )}
    >
      <nav className="max-w-6xl mx-auto px-5 sm:px-8 flex items-center justify-between h-14">
        {/* Logo */}
        <Link href={localePath(lang, "/")} className="flex items-center gap-2.5 group">
          <Image
            src="/brand/better-payment-horizontal-color.svg"
            width={1226}
            height={155}
            alt="Better Payment"
            priority
            className="h-6 w-auto"
          />
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 hidden sm:flex font-mono tracking-tight"
          >
            v{version}
          </Badge>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-0.5">
          {links.map((link) => (
            <Link
              key={link.label}
              href={localePath(lang, link.href)}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent/60 font-medium"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop actions */}
        <div className="hidden md:flex items-center gap-1.5">
          <LanguageSwitch lang={lang} label={t.language} />
          <ThemeToggle label={t.toggleTheme} />
          <Separator orientation="vertical" className="h-4 mx-1" />
          <a
            href="https://github.com/czaydev/better-payment"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "text-muted-foreground hover:text-foreground h-8 px-3 text-xs font-medium",
            )}
          >
            GitHub
          </a>
          <a
            href="https://www.npmjs.com/package/better-payment"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ size: "sm" }),
              "h-8 px-3 text-xs font-medium",
            )}
          >
            npm install
          </a>
        </div>

        {/* Mobile menu toggle */}
        <button
          aria-label={t.openMenu}
          className="md:hidden p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent/60"
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <X className="w-4.5 h-4.5" />
          ) : (
            <Menu className="w-4.5 h-4.5" />
          )}
        </button>
      </nav>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-border bg-background/95 backdrop-blur-2xl px-5 py-3 flex flex-col gap-0.5">
          {links.map((link) => (
            <Link
              key={link.label}
              href={localePath(lang, link.href)}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-md hover:bg-accent/60 transition-colors font-medium"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <Separator className="my-2.5" />
          <div className="flex gap-2 pb-1">
            <LanguageSwitch lang={lang} label={t.language} />
            <a
              href="https://github.com/czaydev/better-payment"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "flex-1 justify-center text-xs h-9",
              )}
            >
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/better-payment"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ size: "sm" }),
                "flex-1 justify-center text-xs h-9",
              )}
            >
              npm install
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
