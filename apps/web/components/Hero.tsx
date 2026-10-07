import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";
import ProviderNetwork from "@/components/ProviderNetwork";
import { GitHubIcon } from "@/components/icons";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";

// Entrance order from the approved motion spec (vault: Branding/06)
const at = (ms: number) => ({ "--at": `${ms}ms` }) as React.CSSProperties;

export default function Hero({ lang, t }: { lang: Locale; t: Dictionary["hero"] }) {
  return (
    <section className="relative isolate overflow-hidden md:min-h-[min(880px,100svh)]">
      <div aria-hidden className="bp-parallax absolute inset-0 -z-10 origin-bottom">
        <Image
          src="/brand/hero/hero-a3.webp"
          alt=""
          fill
          priority
          quality={90}
          sizes="100vw"
          className="bp-art object-cover object-bottom max-md:object-[42%_100%] dark:hidden"
        />
        {/* Same render with its lightness inverted onto the dark background */}
        <Image
          src="/brand/hero/hero-a3-dark.webp"
          alt=""
          fill
          quality={90}
          sizes="100vw"
          className="bp-art hidden object-cover object-bottom max-md:object-[42%_100%] dark:block"
        />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 pt-32 pb-52 sm:px-8 md:grid-cols-[1.05fr_0.95fr] md:pt-40 md:pb-64">
        <div className="min-w-0">
          <h1 className="text-[2.6rem] leading-[1.03] font-extrabold tracking-[-0.035em] text-foreground sm:text-5xl lg:text-[3.9rem]">
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
              className={cn(buttonVariants({ variant: "outline" }), "bg-card/85 backdrop-blur-sm")}
            >
              <GitHubIcon data-icon="brand" />
              {t.star}
            </a>
          </div>

          <div
            className="bp-enter mt-5 inline-flex items-center gap-2.5 rounded-[10px] border border-border bg-card/80 px-3.5 py-2.5 font-mono text-sm backdrop-blur-sm"
            style={at(900)}
          >
            <span className="text-muted-foreground select-none">$</span>
            npm install better-payment
          </div>
        </div>

        <div className="bp-enter flex justify-center md:justify-end" style={at(1000)}>
          <ProviderNetwork t={t.network} />
        </div>
      </div>
    </section>
  );
}
