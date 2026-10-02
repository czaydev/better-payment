import { Shield, Zap, CreditCard, Lock, ChevronRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import SectionHeading from "@/components/SectionHeading";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";

const highlightIcons = [Lock, CreditCard, Shield, Zap];

// Akbank is live; the rest are tracked in issues (logo sources: public/brand/banks/SOURCES.md)
const route = [
  { name: "Akbank", logo: "/akbank.svg", w: 75, h: 38, live: true },
  { name: "Garanti BBVA", logo: "/brand/banks/garanti-bbva.svg", w: 389, h: 69, issue: 37 },
  { name: "Yapı Kredi", logo: "/brand/banks/yapi-kredi.svg", w: 146, h: 26, issue: 38 },
  { name: "İş Bankası", logo: "/brand/banks/is-bankasi.svg", w: 157, h: 49, issue: 36 },
  { name: "Ziraat Bankası", logo: "/brand/banks/ziraat.svg", w: 142, h: 27, issue: 36 },
] as const;

// Nodes sit on alternating heights; the dashed wave passes through their centres
const X = [10, 30, 50, 70, 90];
const Y = [30, 70, 30, 70, 30];
const WAVE = X.slice(1)
  .map((x, i) => {
    const px = X[i] * 10;
    const py = Y[i] * 2.2;
    const nx = x * 10;
    const ny = Y[i + 1] * 2.2;
    return `${i === 0 ? `M${px},${py} ` : ""}C${px + 100},${py} ${nx - 100},${ny} ${nx},${ny}`;
  })
  .join(" ");

function RouteNode({ bank, t }: { bank: (typeof route)[number]; t: Dictionary["banks"] }) {
  const live = "live" in bank;
  const body = (
    <>
      <span className="grid h-16 w-[168px] place-items-center rounded-2xl border border-border bg-card px-5 shadow-[0_1px_2px_rgb(19_19_43/0.04)] transition-[border-color,box-shadow] duration-(--bp-d-md) group-hover:border-line-strong group-hover:shadow-[0_10px_30px_-14px_rgb(19_19_43/0.22)]">
        <Image
          src={bank.logo}
          alt={bank.name}
          width={bank.w}
          height={bank.h}
          className={cn(
            "w-auto max-w-full object-contain transition-[filter,opacity] duration-(--bp-d-md)",
            // akbank.svg carries its own padding, so it needs more room to match the others
            live ? "max-h-12" : "max-h-7 opacity-85 grayscale-[80%] group-hover:opacity-100 group-hover:grayscale-0",
          )}
        />
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
          live ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
        )}
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {live ? t.live : `${t.planned} · #${"issue" in bank ? bank.issue : ""}`}
      </span>
    </>
  );
  const cls = "group flex flex-col items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary rounded-2xl";
  return live ? (
    <div className={cls}>{body}</div>
  ) : (
    <a href={`https://github.com/czaydev/better-payment/issues/${"issue" in bank ? bank.issue : ""}`} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  );
}

export default function Banks({ lang, t }: { lang: Locale; t: Dictionary["banks"] }) {
  const highlights = t.highlights.map((h, i) => ({ ...h, icon: highlightIcons[i] }));
  return (
    <section id="banks" className="scroll-mt-20 px-5 py-24 sm:px-8 md:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeading line1={t.titleLine1} line2={t.titleLine2} lead={t.lead} />

        <div className="bp-reveal grid gap-3">
          <div className="grid gap-x-10 gap-y-4 rounded-2xl border border-border bg-card p-6 sm:p-7 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-xl border border-border bg-background">
                <Image src="/akbank.svg" alt="" width={75} height={38} className="h-6 w-10 object-contain" />
              </span>
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-lg leading-tight font-bold text-foreground">
                  Akbank
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] font-semibold text-success">
                    <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                    {t.live}
                  </span>
                </h3>
                <p className="text-sm text-muted-foreground">{t.akbankTagline}</p>
              </div>
            </div>
            <div>
              <p className="text-[14.5px] leading-relaxed text-muted-foreground">{t.akbankDescription}</p>
              <Link
                href={localePath(lang, "/docs/banks/akbank")}
                className="group mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary"
              >
                {t.viewDocs}
                <ChevronRight className="size-4 transition-transform duration-(--bp-d-md) ease-spring group-hover:translate-x-[3px]" />
              </Link>
            </div>
          </div>

          <ul className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {highlights.map((h) => (
              <li key={h.label} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5">
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-tint text-primary">
                  <h.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-semibold text-foreground">{h.label}</span>
                  <span className="mt-1 block text-[13.5px] leading-snug text-muted-foreground">{h.desc}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bp-reveal mt-14">
          <h3 className="mb-6 text-[17px] font-bold text-foreground">{t.roadmap}</h3>

          {/* Desktop: a dashed wave through alternating nodes */}
          <div className="relative hidden aspect-[1000/220] md:block">
            <svg viewBox="0 0 1000 220" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
              <path d={WAVE} fill="none" stroke="#cfcde6" strokeWidth="2" strokeDasharray="6 8" vectorEffect="non-scaling-stroke" />
            </svg>
            {route.map((bank, i) => (
              <div key={bank.name} className="absolute -translate-x-1/2 -translate-y-[38%]" style={{ left: `${X[i]}%`, top: `${Y[i]}%` }}>
                <RouteNode bank={bank} t={t} />
              </div>
            ))}
          </div>

          {/* Mobile: the same route, vertically */}
          <ol className="relative grid gap-6 border-l-2 border-dashed border-line-strong pl-6 md:hidden">
            {route.map((bank) => (
              <li key={bank.name} className="relative flex justify-start">
                <span className="absolute top-8 -left-[31px] size-3 rounded-full border-2 border-card bg-line-strong" aria-hidden="true" />
                <RouteNode bank={bank} t={t} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
