import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";
import { GitHubIcon } from "@/components/icons";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";
import { withBasePath } from "@/lib/base-path";

// Sheen colours for buttons that sit on the indigo band
const onIndigo = { "--bp-sheen": "color-mix(in srgb, var(--color-brand-500) 16%, transparent)", "--bp-sheen-soft": "color-mix(in srgb, var(--color-brand-500) 5%, transparent)" } as React.CSSProperties;
const onIndigoOutline = { "--bp-sheen": "rgb(255 255 255 / 0.22)", "--bp-sheen-soft": "rgb(255 255 255 / 0.06)" } as React.CSSProperties;

export default function CTA({ lang, t }: { lang: Locale; t: Dictionary["cta"] }) {
  return (
    <section className="px-5 py-24 sm:px-8">
      <div className="bp-reveal relative mx-auto max-w-7xl overflow-hidden rounded-[20px] bg-primary px-6 py-11 text-primary-foreground sm:px-12 sm:py-14">
        <Image
          src={withBasePath("/brand/cta-lanes.webp")}
          alt=""
          width={520}
          height={364}
          className="pointer-events-none absolute top-1/2 right-[4%] w-[260px] -translate-y-1/2 -rotate-12 max-lg:top-auto max-lg:-right-10 max-lg:-bottom-9 max-lg:w-[170px] max-lg:translate-y-0 max-lg:opacity-20"
        />

        <div className="relative max-w-xl">
          <h2 className="text-title-lg sm:text-title-xl">
            {t.titleLine1}
            <br />
            {t.titleLine2}
          </h2>
          <p className="mt-4 max-w-md leading-relaxed text-brand-100">
            {t.lead}{" "}
            <Link href={localePath(lang, "/docs/whats-new")} className="text-white underline underline-offset-4">
              {t.whatsNew}
            </Link>
            .
          </p>

          <div className="mt-6 inline-flex items-center gap-2.5 rounded-[10px] border border-white/20 bg-white/10 px-3.5 py-2.5 font-mono text-sm">
            <span className="text-brand-200 select-none">$</span>
            npm install better-payment
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href={localePath(lang, "/docs")}
              style={onIndigo}
              className={cn(buttonVariants({ variant: "outline" }), "btn-fx-idle border-transparent bg-white text-primary hover:bg-white")}
            >
              {t.readDocs}
              <ChevronRight data-icon="chevron" />
            </Link>
            <a
              href="https://github.com/czaydev/better-payment"
              target="_blank"
              rel="noopener noreferrer"
              style={onIndigoOutline}
              className={cn(buttonVariants({ variant: "outline" }), "border-white/30 bg-transparent text-white hover:border-white/60")}
            >
              <GitHubIcon data-icon="brand" />
              {t.github}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
