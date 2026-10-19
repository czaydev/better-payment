"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { buttonVariants } from "@/lib/button-variants";
import { withBasePath } from "@/lib/base-path";
import { DEFAULT_LOCALE, isLocale, localePath } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";

export default function NotFound() {
  // Not-found boundaries receive no params prop; use the active route's locale.
  const { lang: value } = useParams<{ lang: string }>();
  const lang = isLocale(value) ? value : DEFAULT_LOCALE;
  const dictionary = getDictionary(lang);
  const t = dictionary.notFound;

  return (
    <div className="relative isolate overflow-hidden bg-background">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 select-none">
        <Image
          src={withBasePath("/brand/not-found/not-found-lanes.webp")}
          alt=""
          fill
          sizes="100vw"
          quality={90}
          className="object-fill sm:object-cover dark:hidden"
        />
        <Image
          src={withBasePath("/brand/not-found/not-found-lanes-dark.webp")}
          alt=""
          fill
          sizes="100vw"
          quality={90}
          className="hidden object-fill sm:object-cover dark:block"
        />
        <div className="absolute inset-0 bg-linear-to-b from-background via-transparent to-background" />
      </div>
      <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-6 sm:px-8">
        <header className="flex items-center justify-between gap-6 py-7">
          <Link
            href={localePath(lang, "/")}
            aria-label={`Better Payment — ${t.home}`}
            className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            <Image
              src={withBasePath("/brand/better-payment-horizontal-color.svg")}
              width={1226}
              height={155}
              alt="Better Payment"
              className="h-5 w-auto dark:hidden"
            />
            <Image
              src={withBasePath("/brand/better-payment-horizontal-dark.svg")}
              width={1226}
              height={155}
              alt="Better Payment"
              className="hidden h-5 w-auto dark:block"
            />
          </Link>
          <ThemeToggle label={dictionary.nav.theme} />
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex flex-1 scroll-mt-20 flex-col items-center justify-center py-16 text-center focus:outline-none"
        >
          <div aria-hidden="true" className="select-none font-display text-[clamp(7rem,24vw,15rem)] leading-none font-semibold tracking-[-0.08em] text-primary">
            404
          </div>
          <h1 className="mt-8 font-display text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
            {t.title}
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
            {t.description}
          </p>
          <div className="mt-9 flex w-full max-w-sm flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
            <Link href={localePath(lang, "/")} className={buttonVariants({ className: "focus-visible:outline-solid" })}>
              <ArrowLeft aria-hidden="true" />
              {t.home}
            </Link>
            <Link href={localePath(lang, "/docs")} className={buttonVariants({ variant: "outline", className: "focus-visible:outline-solid" })}>
              {t.docs}
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </div>
        </main>
        <footer className="border-t border-border py-6 text-center font-mono text-xs text-muted-foreground">
          better-payment
        </footer>
      </div>
    </div>
  );
}
