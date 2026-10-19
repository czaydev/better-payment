import Link from "next/link";
import { ArrowRight } from "lucide-react";
import AnimatedIcon from "@/components/AnimatedIcon";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";

// Each feature pairs with an icon from the frosted-glass set
const layout = [
  { key: "unified", icon: "unified-api", href: "/docs/reference/api", span: "lg:col-span-2" },
  { key: "footprint", icon: "edge", href: "/docs/integrations/edge" },
  { key: "callbacks", icon: "callback", href: "/docs/concepts/events" },
  { key: "handler", icon: "handler", href: "/docs/concepts/handler" },
  { key: "doubleCharge", icon: "idempotency", href: "/docs/reference/error-codes" },
] as const;

export default function Features({ lang, t }: { lang: Locale; t: Dictionary["features"] }) {
  const features = layout.map((item) => ({ ...item, ...t.items[item.key] }));
  return (
    <section id="features" className="scroll-mt-20 px-5 py-24 sm:px-8 md:py-28">
      <div className="mx-auto max-w-7xl">
        <h2 className="bp-reveal mb-12 max-w-2xl text-title-lg text-foreground sm:text-title-xl">
          {t.titleLine1}
          <br />
          <span className="text-muted-foreground">{t.titleLine2}</span>
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <article
              key={f.key}
              style={{ "--at": `${(i % 3) * 110}ms` } as React.CSSProperties}
              className={[
                "bp-reveal group relative flex flex-col rounded-2xl border border-border bg-card p-6 transition-[translate,box-shadow,border-color] duration-(--bp-d-md) ease-spring hover:-translate-y-[3px] hover:border-line-strong hover:shadow-[0_10px_30px_-14px_var(--bp-shadow)]",
                "span" in f ? f.span : "",
              ].join(" ")}
            >
              <AnimatedIcon
                name={f.icon}
                className="-mt-1.5 -ml-2 mb-3 transition-transform duration-(--bp-d-lg) ease-spring group-hover:-translate-y-1 group-hover:scale-[1.08] group-hover:-rotate-[5deg]"
              />
              <h3 className="mb-2 text-body-lg font-bold tracking-snug text-foreground">{f.title}</h3>
              <p className="text-body leading-relaxed text-muted-foreground">{f.description}</p>
              <Link
                href={localePath(lang, f.href)}
                className="group/link mt-auto inline-flex w-fit pt-4 items-center gap-1 text-sm font-semibold text-accent-text after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              >
                {t.learnMore}
                <ArrowRight className="size-3.5 transition-transform duration-(--bp-d-sm) group-hover/link:translate-x-0.5" />
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
