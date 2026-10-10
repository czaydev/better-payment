import { Shield, Zap, CreditCard, Lock, ChevronRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import SectionHeading from "@/components/SectionHeading";
import RoadmapScroller from "@/components/RoadmapScroller";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";

const highlightIcons = [Lock, CreditCard, Shield, Zap];

type RouteItem = {
  name: string;
  // Logo files live in public/brand; a missing logo falls back to the name
  logo?: string;
  w?: number;
  h?: number;
  // Stacked or square logos read small at the default height
  tall?: boolean;
  live?: boolean;
  issue?: number;
};

// Akbank and Kuveyt Türk are live; the rest are tracked in issues (logo sources: public/brand/banks/SOURCES.md)
const banks: RouteItem[] = [
  { name: "Akbank", logo: "/akbank.svg", w: 75, h: 38, live: true },
  { name: "Kuveyt Türk", logo: "/brand/banks/kuveyt-turk.svg", w: 227, h: 41, live: true },
  { name: "Garanti BBVA", logo: "/brand/banks/garanti-bbva.svg", w: 389, h: 69, issue: 37 },
  { name: "Yapı Kredi", logo: "/brand/banks/yapi-kredi.svg", w: 146, h: 26, issue: 38 },
  { name: "İş Bankası", logo: "/brand/banks/is-bankasi.svg", w: 157, h: 49, issue: 36 },
  { name: "Ziraat Bankası", logo: "/brand/banks/ziraat.svg", w: 142, h: 27, issue: 36 },
  { name: "Halkbank", logo: "/brand/banks/halkbank.svg", w: 512, h: 99, issue: 36 },
  { name: "TEB", logo: "/brand/banks/teb.png", w: 971, h: 421, issue: 36 },
  { name: "QNB", logo: "/brand/banks/qnb.svg", w: 1550, h: 452, issue: 39 },
  { name: "DenizBank", logo: "/brand/banks/denizbank.svg", w: 183, h: 32, issue: 39 },
  { name: "VakıfBank", logo: "/brand/banks/vakifbank.svg", w: 529, h: 64, issue: 133 },
];

const institutions: RouteItem[] = [
  { name: "Sipay", logo: "/brand/institutions/sipay.svg", w: 140, h: 68, issue: 40 },
  { name: "Moka United", logo: "/brand/institutions/moka-united.svg", w: 196, h: 80, tall: true, issue: 40 },
  { name: "Papara", logo: "/brand/institutions/papara.png", w: 1280, h: 354, issue: 40 },
  { name: "Lidio", logo: "/brand/institutions/lidio.svg", w: 197, h: 91, tall: true, issue: 40 },
];

const ISSUES = "https://github.com/czaydev/better-payment/issues";

function RouteNode({ item, t }: { item: RouteItem; t: Dictionary["banks"] }) {
  const live = item.live === true;
  const body = (
    <>
      <span className="grid h-16 w-[150px] place-items-center rounded-2xl border border-border bg-card px-4 shadow-[0_1px_2px_rgb(19_19_43/0.04)] dark:bg-logo transition-[border-color,box-shadow] duration-(--bp-d-md) group-hover:border-line-strong group-hover:shadow-[0_10px_30px_-14px_var(--bp-shadow)]">
        {item.logo ? (
          <Image
            src={item.logo}
            alt={item.name}
            width={item.w}
            height={item.h}
            className={cn(
              "w-auto max-w-full object-contain transition-[filter,opacity] duration-(--bp-d-md)",
              // akbank.svg carries its own padding, so it needs more room to match the others
              live ? "max-h-12" : cn(item.tall ? "max-h-10" : "max-h-7", "opacity-85 grayscale-[80%] group-hover:opacity-100 group-hover:grayscale-0"),
            )}
          />
        ) : (
          <span className="text-[15px] font-bold tracking-tight text-muted-foreground">{item.name}</span>
        )}
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
          live ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
        )}
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {live ? t.live : item.issue ? `${t.planned} · #${item.issue}` : t.planned}
      </span>
    </>
  );
  const cls = "group flex flex-col items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary rounded-2xl";
  return live || !item.issue ? (
    <div className={cls}>{body}</div>
  ) : (
    <a href={`${ISSUES}/${item.issue}`} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  );
}

// One continuous route: a group label, then its providers, joined by half-oval dashed bridges
const SPACING = 270;
const PAD = 96;
const MID = 104;
const NODE_W = 150;
const LABEL_W = 176;

type Stop = { label: string } | { item: RouteItem };

function RouteTrack({ groups, t }: { groups: { title: string; items: RouteItem[] }[]; t: Dictionary["banks"] }) {
  const stops: Stop[] = groups.flatMap(({ title, items }) => [{ label: title }, ...items.map((item) => ({ item }))]);
  const x = stops.map((_, i) => PAD + i * SPACING);
  const half = (stop: Stop) => ("label" in stop ? LABEL_W : NODE_W) / 2 + 6;
  const width = x[x.length - 1] + PAD;
  // Bridges alternate above and below the line, so the route reads as a gentle wave moving right
  const bridges = stops.slice(1).map((stop, i) => {
    const from = x[i] + half(stops[i]);
    const to = x[i + 1] - half(stop);
    const rx = (to - from) / 2;
    return `M ${from} ${MID} A ${rx} ${rx * 0.78} 0 0 ${i % 2 === 0 ? 1 : 0} ${to} ${MID}`;
  });
  const d = bridges.join(" ");
  return (
    <div data-route-track className="bp-route-track">
      <div className="relative h-[232px]" style={{ width }}>
        <svg viewBox={`0 0 ${width} 232`} className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <defs>
            <clipPath id="bp-route-reached">
              <rect data-route-clip x="0" y="0" width="0" height="232" />
            </clipPath>
          </defs>
          <path d={d} className="bp-route-line" />
          <path d={d} className="bp-route-line bp-route-line-reached" clipPath="url(#bp-route-reached)" />
        </svg>
        <ol className="m-0 list-none p-0">
          {stops.map((stop, i) => (
            <li
              key={"label" in stop ? stop.label : stop.item.name}
              data-route-stop={x[i]}
              data-live={"item" in stop && stop.item.live ? "" : undefined}
              className="bp-route-stop absolute -translate-x-1/2"
              style={{ left: x[i], top: MID - 32 }}
            >
              {"label" in stop ? (
                <h4 className="flex h-16 items-center justify-center rounded-full border border-dashed border-lilac bg-tint/60 px-4 text-center text-[12px] font-semibold tracking-wide text-accent-text uppercase" style={{ width: LABEL_W }}>
                  {stop.label}
                </h4>
              ) : (
                <RouteNode item={stop.item} t={t} />
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default function Banks({ lang, t }: { lang: Locale; t: Dictionary["banks"] }) {
  const highlights = t.highlights.map((h, i) => ({ ...h, icon: highlightIcons[i] }));
  return (
    <section id="banks" className="scroll-mt-20 overflow-x-clip px-5 py-24 sm:px-8 md:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeading line1={t.titleLine1} line2={t.titleLine2} lead={t.lead} />

        <div className="bp-reveal grid gap-3">
          <div className="grid gap-x-10 gap-y-4 rounded-2xl border border-border bg-card p-6 sm:p-7 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-xl border border-border bg-background dark:bg-logo">
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
                className="group mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-text"
              >
                {t.viewDocs}
                <ChevronRight className="size-4 transition-transform duration-(--bp-d-md) ease-spring group-hover:translate-x-[3px]" />
              </Link>
            </div>
          </div>

          <ul className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {highlights.map((h) => (
              <li key={h.label} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5">
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-tint text-accent-text">
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

        <RoadmapScroller title={t.roadmap} hint={t.roadmapHint} previous={t.previous} next={t.next}>
          <RouteTrack
            groups={[
              { title: t.roadmapBanks, items: banks },
              { title: t.roadmapInstitutions, items: institutions },
            ]}
            t={t}
          />
        </RoadmapScroller>
      </div>
    </section>
  );
}
