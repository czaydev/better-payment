"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";
import { withBasePath } from "@/lib/base-path";
import { PROVIDER_META } from "@/lib/provider-meta";
import { PROVIDERS_DATA, type ProviderSlug } from "@/lib/providers-data";

type Strings = Dictionary["hero"]["network"];

// The canvas is a 100×100 square; every position is a percentage of it
const INNER: ProviderSlug[] = ["iyzico", "paytr", "sipay", "parampos"];
const OUTER: ProviderSlug[] = ["akbank", "kuveytturk", "isbank", "ziraat", "halkbank", "teb", "sekerbank"];
const R_INNER = 23;
const R_OUTER = 42;

const polar = (r: number, deg: number) => ({
  x: 50 + r * Math.cos((deg * Math.PI) / 180),
  y: 50 + r * Math.sin((deg * Math.PI) / 180),
});

const NODES = [
  ...INNER.map((slug, i) => ({ slug, ring: "inner" as const, ...polar(R_INNER, -135 + i * 90) })),
  ...OUTER.map((slug, i) => ({ slug, ring: "outer" as const, ...polar(R_OUTER, -90 + (i * 360) / OUTER.length) })),
];

// Highlight order alternates between the rings so the flow keeps moving around the hub
const ORDER = [0, 4, 1, 5, 2, 6, 3, 7, 8, 9, 10];

const REQUEST_MS = 800;
const STEP_MS = 2300;

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduced(onChange: () => void) {
  const media = window.matchMedia(REDUCED_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export default function ProviderNetwork({ t, lang, className }: { t: Strings; lang: Locale; className?: string }) {
  const [step, setStep] = useState(0);
  const [verified, setVerified] = useState(false);
  const [paused, setPaused] = useState(false);
  const visible = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );

  const hold = reduced || paused;
  const activeIndex = ORDER[step % ORDER.length];
  const active = NODES[activeIndex];
  const provider = PROVIDERS_DATA[active.slug];
  const caps = (t.caps as Record<string, string>)[active.slug] ?? PROVIDER_META[active.slug].tagline[lang === "tr" ? "tr" : "en"];

  useEffect(() => {
    if (hold) return;
    const ok = setTimeout(() => setVerified(true), REQUEST_MS);
    const next = setTimeout(() => {
      if (!visible.current) return;
      setVerified(false);
      setStep((s) => s + 1);
    }, STEP_MS);
    return () => {
      clearTimeout(ok);
      clearTimeout(next);
    };
  }, [step, hold]);

  // Pause while off screen
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const show = (i: number) => {
    setPaused(true);
    setVerified(true);
    setStep(ORDER.indexOf(i));
  };

  return (
    <div ref={root} role="group" aria-label={t.label} className={cn("w-full max-w-[540px]", className)}>
      <div className="relative aspect-square w-full">
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden="true">
          {/* orbits: hairlines only */}
          <circle cx="50" cy="50" r={R_OUTER} fill="none" stroke="var(--border)" strokeWidth="0.25" />
          <circle cx="50" cy="50" r={R_INNER} fill="none" stroke="var(--border)" strokeWidth="0.25" />
          <circle cx="50" cy="50" r="11" fill="none" stroke="var(--border)" strokeWidth="0.25" strokeDasharray="0.8 1.2" />
          {/* faint spokes to every provider */}
          {NODES.map((n) => (
            <line key={n.slug} x1="50" y1="50" x2={n.x} y2={n.y} stroke="var(--border)" strokeWidth="0.2" />
          ))}
          {/* the live request: draws out to the provider, then settles green */}
          {!reduced && (
            <line
              key={`${step}-${active.slug}`}
              x1="50"
              y1="50"
              x2={active.x}
              y2={active.y}
              pathLength={1}
              className="bp-flow-line"
              data-verified={verified ? "" : undefined}
            />
          )}
        </svg>

        {/* hub */}
        <div className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <div className="grid size-[88px] place-items-center rounded-[28px] bg-primary text-primary-foreground shadow-[var(--bp-button-edge),var(--bp-button-ring),0_6px_14px_-6px_var(--bp-shadow)] max-sm:size-16 max-sm:rounded-[22px]">
            <Image src={withBasePath("/brand/better-payment-symbol-white.svg")} width={40} height={40} alt="" className="size-9 max-sm:size-7" />
          </div>
        </div>

        {/* providers */}
        {NODES.map((n, i) => {
          const meta = PROVIDER_META[n.slug];
          const isActive = i === activeIndex && !reduced;
          return (
            <Link
              key={n.slug}
              href={localePath(lang, `/providers/${n.slug}`)}
              aria-label={`${PROVIDERS_DATA[n.slug].name}`}
              onMouseEnter={() => show(i)}
              onFocus={() => show(i)}
              onMouseLeave={() => setPaused(false)}
              onBlur={() => setPaused(false)}
              style={{ left: `${n.x}%`, top: `${n.y}%` }}
              className={cn(
                "absolute z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl border bg-logo transition-[border-color,scale] duration-300 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                n.ring === "inner" ? "h-[11%] w-[21%]" : "h-[9%] w-[17%]",
                isActive ? (verified ? "scale-[1.06] border-success" : "scale-[1.06] border-primary") : "border-border hover:border-line-strong",
              )}
            >
              <Image
                src={withBasePath(meta.logo)}
                width={meta.w}
                height={meta.h}
                alt=""
                className={cn("w-auto object-contain", n.ring === "inner" ? "max-h-[52%] max-w-[66%]" : "max-h-[50%] max-w-[68%]")}
              />
              {isActive && verified && (
                <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-success text-background max-sm:size-4">
                  <Check className="size-3 max-sm:size-2.5" strokeWidth={3} />
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* status card: what the active provider handles, and the verified result */}
      <div aria-live="polite" className="mt-2 flex items-center justify-between gap-4 rounded-3xl border border-border bg-card px-5 py-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-body font-semibold text-foreground">
            {provider.name}
            <span className="rounded-badge bg-muted px-2 py-0.5 font-mono text-micro font-normal text-muted-foreground">
              {provider.category === "gateway" ? "gateway" : "virtual POS"}
            </span>
          </p>
          <p className="mt-1 truncate text-caption text-muted-foreground">{caps}</p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-medium transition-colors duration-300",
            verified || reduced ? "bg-success-soft text-success" : "bg-muted text-muted-foreground",
          )}
        >
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {verified || reduced ? `${t.verified} · success` : `${t.request}…`}
        </span>
      </div>
    </div>
  );
}
