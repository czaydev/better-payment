import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";
import { GitHubIcon } from "@/components/icons";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";
import { withBasePath } from "@/lib/base-path";

export default function CTA({ lang, t }: { lang: Locale; t: Dictionary["cta"] }) {
  return (
    <section className="px-4 py-24 sm:px-6 md:px-4">
      <div className="bp-reveal relative mx-auto max-w-[97rem] overflow-hidden rounded-card panel-dark px-6 py-11 sm:px-14 sm:py-16">
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
          <p className="mt-4 max-w-md leading-relaxed text-muted-foreground">
            {t.lead}{" "}
            <Link href={localePath(lang, "/docs/whats-new")} className="text-white underline underline-offset-4">
              {t.whatsNew}
            </Link>
            .
          </p>

          <div className="mt-6 inline-flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 font-mono text-sm">
            <span className="text-accent-text select-none">$</span>
            npm install better-payment
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href={localePath(lang, "/docs")}
              className={buttonVariants()}
            >
              {t.readDocs}
              <ChevronRight data-icon="chevron" />
            </Link>
            <a
              href="https://github.com/czaydev/better-payment"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline" }), "bg-transparent")}
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
