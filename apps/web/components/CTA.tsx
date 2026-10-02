import { buttonVariants } from "@/lib/button-variants";
import { ChevronRight, GitBranch } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";

export default function CTA({ lang, t }: { lang: Locale; t: Dictionary["cta"] }) {
  return (
    <section className="py-24 px-5 sm:px-8 bg-muted/30 border-y border-border">
      <div className="max-w-6xl mx-auto">
        <div className="rounded-xl border border-border bg-card">
          <div className="px-8 sm:px-16 py-16">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-10">
              {/* Copy */}
              <div className="max-w-lg">
                <p className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground mb-4">
                  {t.eyebrow}
                </p>
                <h2 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight leading-tight">
                  {t.titleLine1}
                  <br />
                  {t.titleLine2}
                </h2>
                <p className="mt-4 text-base text-muted-foreground leading-relaxed max-w-md">
                  {t.lead}{" "}
                  <Link
                    href={localePath(lang, "/docs/whats-new")}
                    className="text-foreground underline underline-offset-4"
                  >
                    {t.whatsNew}
                  </Link>
                  .
                </p>

                {/* Install command */}
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground bg-muted/50 border border-border rounded-lg px-4 py-3 mt-6 w-fit">
                  <span className="select-none">$</span>
                  <span className="text-foreground/75">
                    npm install better-payment
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row gap-3 shrink-0">
                <Link
                  href={localePath(lang, "/docs")}
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "gap-2 h-11 px-7 text-sm font-medium whitespace-nowrap",
                  )}
                >
                  {t.readDocs} <ChevronRight data-icon="chevron" className="w-4 h-4" />
                </Link>
                <a
                  href="https://github.com/czaydev/better-payment"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "gap-2 h-11 px-7 text-sm font-medium whitespace-nowrap",
                  )}
                >
                  <GitBranch data-icon="brand" className="w-4 h-4" /> {t.github}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
