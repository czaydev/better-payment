"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";

type Strings = Dictionary["hero"]["network"];

// Geometry of the 470×400 canvas; node positions are percentages of it
const W = 470;
const H = 400;
const HUB = { x: W / 2, y: H / 2 };

const NODES = [
  { key: "iyzico", name: "iyzico", logo: "/iyzico.svg", x: 16, y: 18 },
  { key: "paytr", name: "PayTR", logo: "/paytr.svg", x: 84, y: 18 },
  { key: "parampos", name: "Parampos", logo: "/param.svg", x: 16, y: 82 },
  { key: "akbank", name: "Akbank", logo: "/akbank.svg", x: 84, y: 82 },
] as const;

function wirePath(xPct: number, yPct: number) {
  const x = (xPct / 100) * W;
  const y = (yPct / 100) * H;
  const mx = (x + HUB.x) / 2;
  return `M${HUB.x},${HUB.y} C${mx},${HUB.y} ${mx},${y} ${x},${y}`;
}

// Timings follow the approved motion spec (vault: Branding/06)
const TRAVEL_MS = 1300;
const HOLD_MS = 600;
const GAP_MS = 2200;
const START_MS = 1900;

type Phase = "idle" | "request" | "at" | "return" | "verified";

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduced(onChange: () => void) {
  const media = window.matchMedia(REDUCED_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export default function ProviderNetwork({ t, className }: { t: Strings; className?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [tip, setTip] = useState<number | null>(null);
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );

  const root = useRef<HTMLDivElement>(null);
  const wires = useRef<(SVGPathElement | null)[]>([]);
  const dots = useRef<(SVGGElement | null)[]>([]);
  const generation = useRef(0);
  const visible = useRef(true);

  const wait = (ms: number, gen: number) =>
    new Promise<boolean>((resolve) => setTimeout(() => resolve(gen === generation.current), ms));

  // All four requests (and all four verified returns) travel at the same time.
  // The timer drives the flow; animation frames only draw the dots, so the
  // loop keeps its order even when the browser skips frames.
  const travel = useCallback((reverse: boolean, gen: number) => {
    return new Promise<boolean>((resolve) => {
      const lanes = NODES.map((_, i) => ({ path: wires.current[i], g: dots.current[i] }));
      if (lanes.some((l) => !l.path || !l.g)) return resolve(false);
      const lengths = lanes.map((l) => l.path!.getTotalLength());
      const start = performance.now();
      let done = false;
      lanes.forEach((l) => (l.g!.style.opacity = "1"));
      const step = (now: number) => {
        if (done) return;
        const k = Math.min(1, (now - start) / TRAVEL_MS);
        lanes.forEach((l, i) => {
          const at = easeInOut(k) * lengths[i];
          const p = l.path!.getPointAtLength(reverse ? lengths[i] - at : at);
          l.g!.setAttribute("transform", `translate(${p.x},${p.y})`);
        });
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      setTimeout(() => {
        done = true;
        lanes.forEach((l) => (l.g!.style.opacity = "0"));
        resolve(gen === generation.current);
      }, TRAVEL_MS);
    });
  }, []);

  const run = useCallback(
    async (delay: number) => {
      const gen = ++generation.current;
      if (!(await wait(delay, gen))) return;
      while (gen === generation.current) {
        if (!visible.current) {
          if (!(await wait(400, gen))) return;
          continue;
        }
        setPhase("request");
        if (!(await travel(false, gen))) return;
        setPhase("at");
        if (!(await wait(HOLD_MS, gen))) return;
        setPhase("return");
        if (!(await travel(true, gen))) return;
        setPhase("verified");
        if (!(await wait(GAP_MS, gen))) return;
      }
    },
    [travel],
  );

  // Bumping the generation makes every pending step of the loop stop
  const stop = useCallback(() => {
    generation.current++;
  }, []);

  useEffect(() => {
    if (reduced) {
      stop();
      return;
    }
    run(START_MS);
    return stop;
  }, [reduced, run, stop]);

  // Pause the loop while the network is off screen
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const chip =
    reduced || phase === "idle"
      ? { tone: "ok", text: t.idle }
      : phase === "verified"
        ? { tone: "ok", text: `✓ ${t.verified} · success · 4/4` }
        : { tone: "req", text: `${t.request} → ${t.all}` };

  return (
    <div
      ref={root}
      role="group"
      aria-label={t.label}
      className={cn("relative w-full max-w-[470px] aspect-[47/40] max-md:aspect-[47/50]", className)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
        {NODES.map((n, i) => (
          <path
            key={n.key}
            ref={(el) => {
              wires.current[i] = el;
            }}
            d={wirePath(n.x, n.y)}
            className="bp-wire"
            data-active={!reduced && phase !== "idle" && phase !== "verified" ? "" : undefined}
          />
        ))}
        {NODES.map((n, i) => (
          <g
            key={n.key}
            ref={(el) => {
              dots.current[i] = el;
            }}
            style={{ opacity: 0 }}
          >
            <circle r={11} className={phase === "return" ? "fill-success/20" : "fill-primary/20"} />
            <circle r={5} className={phase === "return" ? "fill-success" : "fill-primary"} />
          </g>
        ))}
      </svg>

      <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-2xl bg-primary px-4 py-3 font-mono text-sm font-semibold text-primary-foreground shadow-[0_14px_30px_-12px_var(--bp-glow)] max-md:gap-2 max-md:px-3 max-md:py-2.5 max-md:text-[12.5px]">
        <Image src="/brand/better-payment-symbol-white.svg" width={22} height={22} alt="" className="size-5.5 max-md:size-4.5" />
        betterPayment()
      </div>

      <div
        aria-live="polite"
        className={cn(
          "absolute left-1/2 top-[calc(50%+38px)] z-20 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-semibold transition-colors duration-(--bp-d-md)",
          chip.tone === "ok" ? "bg-success-soft text-success" : "border border-border bg-card text-muted-foreground",
        )}
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {chip.text}
      </div>

      {NODES.map((n, i) => {
        const on = !reduced;
        return (
          <button
            key={n.key}
            type="button"
            style={{ left: `${n.x}%`, top: `${n.y}%` }}
            aria-label={`${n.name}: ${t.caps[n.key]}`}
            onMouseEnter={() => setTip(i)}
            onMouseLeave={() => setTip(null)}
            onFocus={() => setTip(i)}
            onBlur={() => setTip(null)}
            className={cn(
              "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 rounded-[14px] border border-border bg-card py-2 pr-3 pl-2 transition-[border-color,box-shadow,scale] duration-(--bp-d-md) ease-spring focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary max-md:gap-2 max-md:py-1.5 max-md:pr-2.5 max-md:pl-1.5",
              on && phase === "at" && "scale-[1.04] border-primary shadow-[0_0_0_5px_var(--bp-tint)]",
              on && (phase === "return" || phase === "verified") && "border-success shadow-[0_0_0_5px_var(--bp-success-soft)]",
            )}
          >
            <span className="grid size-9.5 place-items-center rounded-[9px] border border-border bg-background dark:bg-logo max-md:size-7.5">
              <Image src={n.logo} width={32} height={18} alt="" className="h-4.5 w-8 object-contain max-md:h-3.5 max-md:w-6.5" />
            </span>
            <b className="font-display text-[13.5px] max-md:text-[12.5px]">{n.name}</b>
          </button>
        );
      })}

      {tip !== null && (
        <div
          role="tooltip"
          style={{ left: `${NODES[tip].x}%`, top: `calc(${NODES[tip].y}% + 34px)` }}
          className="pointer-events-none absolute z-20 max-w-[220px] -translate-x-1/2 rounded-[9px] bg-foreground px-2.5 py-2 text-[12.5px] leading-snug text-background"
        >
          {t.caps[NODES[tip].key]}
        </div>
      )}
    </div>
  );
}
