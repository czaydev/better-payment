import { buttonVariants } from "@/lib/button-variants";
import { ChevronRight, Star } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import Code from "@/components/Code";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";

const heroCode = `import { betterPayment, iyzico, paytr } from "better-payment";

const payment = betterPayment({
  providers: {
    iyzico: iyzico({ ... }),
    paytr:  paytr({ ... }),
  },
  plugins: [/* events, routing, your own */],
});

// Same request and result types on every provider
const result = await payment.iyzico.initThreeDSPayment(order);

// One listener for every provider, after the callback is verified
payment.on("payment.succeeded", (e) => markOrderPaid(e.conversationId));`;

export default function Hero({
  version,
  lang,
  t,
}: {
  version: string;
  lang: Locale;
  t: Dictionary["hero"];
}) {
  return (
    <section className="relative pt-32 pb-24 lg:pt-40 lg:pb-28 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col lg:flex-row items-center gap-16 lg:gap-12">
          {/* Left */}
          <div className="flex-1 flex flex-col items-start gap-7 min-w-0 max-w-xl">
            <Link
              href={localePath(lang, "/docs/whats-new")}
              className="group inline-flex items-center gap-2 rounded-full border border-border bg-card hover:bg-muted px-3.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="font-mono text-foreground">{version}</span>
              <span className="w-px h-3 bg-border" />
              {t.badge}
              <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>

            <h1 className="text-[2.75rem] sm:text-[3.5rem] lg:text-[3.9rem] font-bold tracking-[-0.03em] leading-[1.05] text-foreground">
              {t.titleLine1}
              <br />
              {t.titleLine2}
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-[460px]">
              <strong className="text-foreground font-semibold">better-payment</strong> {t.lead}
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href={localePath(lang, "/docs")}
                className={cn(buttonVariants({ size: "lg" }), "gap-2 h-11 px-6 text-sm font-medium")}
              >
                {t.getStarted} <ChevronRight data-icon="chevron" className="w-4 h-4" />
              </Link>
              <a
                href="https://github.com/czaydev/better-payment"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "gap-2 h-11 px-6 text-sm font-medium",
                )}
              >
                <Star data-icon="brand" className="w-3.5 h-3.5" />
                {t.star}
              </a>
            </div>

            <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground bg-muted/50 border border-border rounded-lg px-4 py-3 w-full max-w-[340px]">
              <span className="select-none">$</span>
              <span className="text-foreground/80">npm install better-payment</span>
            </div>

            <dl className="flex flex-wrap items-center gap-x-8 gap-y-4 pt-1">
              {t.stats.map((s) => (
                <div key={s.label}>
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="text-xl font-semibold tabular-nums text-foreground">{s.value}</dd>
                  <dd className="text-xs text-muted-foreground mt-0.5">{s.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Right */}
          <div className="flex-1 flex justify-center lg:justify-end w-full min-w-0">
            <Code code={heroCode} file="lib/payment.ts" className="w-full max-w-[560px] shadow-sm" />
          </div>
        </div>
      </div>
    </section>
  );
}
