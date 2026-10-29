import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";
import ProviderNetwork from "@/components/ProviderNetwork";
import InstallCommand from "@/components/InstallCommand";
import HeroProof from "@/components/HeroProof";
import { GitHubIcon } from "@/components/icons";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";

// Entrance order from the approved motion spec (vault: Branding/06)
const at = (ms: number) => ({ "--at": `${ms}ms` }) as React.CSSProperties;

export default function Hero({
  lang,
  t,
  version,
  copy,
}: {
  lang: Locale;
  t: Dictionary["hero"];
  version: string;
  copy: Dictionary["code"];
}) {
  return (
    <section className="relative isolate overflow-hidden md:min-h-[min(880px,100svh)]">
      <div className="mx-auto grid max-w-[97rem] items-center gap-10 px-4 pt-32 pb-10 sm:px-6 md:px-4 md:grid-cols-[1.05fr_0.95fr] md:pt-40">
        <div className="min-w-0">
          <Link
            href={localePath(lang, "/docs/reference/changelog")}
            className="bp-enter group/badge mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pr-3 pl-1 text-caption font-medium text-foreground transition-colors hover:border-line-strong"
            style={at(160)}
          >
            <span className="rounded-full bg-tint px-2 py-0.5 font-mono text-label text-accent-text">v{version}</span>
            {t.badge}
            <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover/badge:translate-x-0.5" />
          </Link>
          <h1 className="text-display-sm text-foreground sm:text-display-md lg:text-display-lg">
            <span className="bp-enter block" style={at(300)}>
              {t.titleLine1}
            </span>
            <span className="bp-enter block text-muted-foreground" style={at(440)}>
              {t.titleLine2}
            </span>
          </h1>

          <p className="bp-enter mt-5 max-w-[520px] text-lg leading-relaxed text-muted-foreground" style={at(600)}>
            <strong className="font-semibold text-foreground">Better Payment</strong> {t.lead}
          </p>

          <div className="bp-enter mt-8 flex flex-wrap gap-3" style={at(760)}>
            <Link href={localePath(lang, "/docs")} className={buttonVariants()}>
              {t.getStarted}
              <ChevronRight data-icon="chevron" />
            </Link>
            <a
              href="https://github.com/czaydev/better-payment"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline" }), "bg-card")}
            >
              <GitHubIcon data-icon="brand" />
              {t.star}
            </a>
          </div>

          <div className="bp-enter mt-5" style={at(900)}>
            <InstallCommand labels={copy} />
          </div>
        </div>

        <div className="bp-enter flex justify-center md:justify-end" style={at(1000)}>
          <ProviderNetwork t={t.network} lang={lang} />
        </div>
      </div>

      <div className="bp-enter mx-auto max-w-[97rem] px-4 pb-16 sm:px-6 md:px-4 md:pb-24" style={at(1150)}>
        <HeroProof t={t.proof} />
      </div>
    </section>
  );
}
