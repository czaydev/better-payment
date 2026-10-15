"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { ROADMAP_PACE, canLinkRoadmapScroll, roadmapProgress, roadmapScrollTarget } from "@/lib/roadmap-scroll.mjs";

/**
 * Pins the roadmap and turns page scroll into a rightward journey along the route.
 * Only reduced motion or a stage too tall to pin falls back to native scrolling.
 */
export default function RoadmapScroller({ children, title, hint, previous, next }: {
  children: ReactNode; title: string; hint: string; previous: string; next: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    const rail = viewport.current;
    const track = rail?.querySelector<HTMLElement>("[data-route-track]");
    const clip = track?.querySelector("[data-route-clip]");
    const stage = el?.firstElementChild as HTMLElement | null;
    if (!el || !rail || !track || !clip || !stage) return;
    const stops = [...track.querySelectorAll<HTMLElement>("[data-route-stop]")].map((node) => ({ node, x: Number(node.dataset.routeStop) }));
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let lastShift = 0;
    const stickyTop = () => parseFloat(getComputedStyle(stage).top) || 0;
    const gutter = () => parseFloat(getComputedStyle(track).paddingLeft) || 0;

    const update = () => {
      frame = 0;
      const travel = Math.max(0, track.offsetWidth - rail.clientWidth);
      const linked = canLinkRoadmapScroll({
        reducedMotion: media.matches,
        viewportHeight: window.innerHeight,
        stageHeight: stage.offsetHeight,
        stickyTop: stickyTop(),
        travel,
      });
      if (linked !== el.hasAttribute("data-scroll-linked")) {
        el.toggleAttribute("data-scroll-linked", linked);
        if (linked) rail.scrollLeft = 0;
        else {
          el.style.height = "";
          track.style.transform = "";
          rail.scrollLeft = lastShift;
        }
      }
      let progress: number;
      let shift: number;
      if (linked) {
        el.style.height = `${stage.offsetHeight + travel * ROADMAP_PACE}px`;
        progress = roadmapProgress(el.getBoundingClientRect().top, stickyTop(), travel);
        shift = progress * travel;
        track.style.transform = `translate3d(${-shift}px,0,0)`;
      } else {
        shift = rail.scrollLeft;
        progress = travel ? shift / travel : 1;
      }
      lastShift = shift;
      // The reached point leads the visible window slightly and lands on the last stop at the end
      // Stops and the clip use the route's own coordinates, inside the track's gutter
      const reached = shift + rail.clientWidth * (0.36 + 0.56 * progress) - gutter();
      clip.setAttribute("width", String(Math.max(0, reached)));
      for (const { node, x } of stops) node.toggleAttribute("data-reached", x <= reached);
      el.style.setProperty("--route-progress", String(progress));
    };
    const queue = () => { if (!frame) frame = requestAnimationFrame(update); };
    // Keyboard focus on a stop scrolls the page so that stop slides into view
    const follow = (event: FocusEvent) => {
      if (!el.hasAttribute("data-scroll-linked")) return;
      rail.scrollLeft = 0;
      const stop = (event.target as HTMLElement).closest<HTMLElement>("[data-route-stop]");
      const travel = track.offsetWidth - rail.clientWidth;
      if (!stop || travel <= 0) return;
      const progress = Math.max(0, Math.min(1, (gutter() + Number(stop.dataset.routeStop) - rail.clientWidth / 2) / travel));
      const top = el.getBoundingClientRect().top + scrollY - stickyTop() + progress * travel * ROADMAP_PACE;
      window.scrollTo({ top, behavior: "instant" });
    };

    // Font wrapping and orientation can change the stage's height without crossing a breakpoint.
    const observer = new ResizeObserver(queue);
    observer.observe(stage);
    observer.observe(rail);
    queue();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    rail.addEventListener("scroll", queue, { passive: true });
    rail.addEventListener("focusin", follow);
    media.addEventListener("change", queue);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      rail.removeEventListener("scroll", queue);
      rail.removeEventListener("focusin", follow);
      media.removeEventListener("change", queue);
      el.removeAttribute("data-scroll-linked");
      el.style.height = "";
      track.style.transform = "";
    };
  }, []);

  const advance = (direction: number) => {
    const el = root.current;
    const rail = viewport.current;
    if (!el || !rail) return;
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    const step = direction * rail.clientWidth * 0.6;
    if (el.hasAttribute("data-scroll-linked")) {
      const stage = el.firstElementChild as HTMLElement;
      const track = rail.querySelector<HTMLElement>("[data-route-track]");
      if (!track) return;
      const start = el.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(stage).top) || 0);
      const travel = Math.max(0, track.offsetWidth - rail.clientWidth);
      window.scrollTo({ top: roadmapScrollTarget(scrollY, start, travel, step), behavior });
    }
    else rail.scrollBy({ left: step, behavior });
  };

  return (
    <div ref={root} className="bp-roadmap mt-20" id="roadmap">
      <div className="bp-roadmap-stage">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h3>
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">{hint}<ArrowRight className="bp-roadmap-nudge size-4" aria-hidden="true" /></p>
          </div>
          <div className="flex shrink-0 gap-2">
            {[{ label: previous, direction: -1, Icon: ChevronLeft }, { label: next, direction: 1, Icon: ChevronRight }].map(({ label, direction, Icon }) => (
              <button key={direction} type="button" aria-label={label} onClick={() => advance(direction)} className="grid size-10 place-items-center rounded-full border border-border bg-card text-accent-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
        <div ref={viewport} tabIndex={0} role="region" aria-label={title} className="bp-route-viewport">{children}</div>
        <div className="bp-roadmap-progress mt-4 h-0.5 overflow-hidden rounded-full bg-border" aria-hidden="true"><div className="h-full origin-left bg-primary" /></div>
      </div>
    </div>
  );
}
