"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronsLeftRight } from "lucide-react";
import { highlight } from "@/components/Code";
import CopyButton from "@/components/CopyButton";

type Snippet = { file: string; code: string };

/**
 * One code box with a draggable divider: the left side shows the provider's
 * raw API, the right side the same job with Better Payment.
 */
export default function CompareSlider({
  before,
  after,
  labels,
  copy,
}: {
  before: Snippet;
  after: Snippet;
  labels: { without: string; with: string; drag: string };
  copy: { copy: string; copied: string };
}) {
  const [pos, setPos] = useState(50);
  const area = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const moveTo = useCallback((clientX: number) => {
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(96, Math.max(4, pct)));
  }, []);

  const pre = "col-start-1 row-start-1 m-0 min-w-0 overflow-hidden p-4 font-mono text-[12px] leading-[1.7] whitespace-pre-wrap break-words sm:p-5 sm:text-[13px] sm:leading-[1.75] sm:whitespace-pre";

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border bg-background py-1.5 pr-1.5 pl-4 text-xs">
        <span className="font-medium text-muted-foreground">{labels.without}</span>
        <span className="text-border" aria-hidden="true">
          /
        </span>
        <span className="font-medium text-accent-text">{labels.with}</span>
        <CopyButton text={after.code} labels={copy} />
      </div>

      <div
        ref={area}
        className="relative grid grid-cols-[minmax(0,1fr)] cursor-ew-resize touch-pan-y select-none"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          moveTo(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <pre className={`${pre} bg-code-muted-bg text-foreground/75`} aria-label={`${labels.without}: ${before.file}`}>
          <code>{highlight(before.code)}</code>
        </pre>
        {/* The "after" side starts at the divider, so both sides read from the start of each line */}
        <pre
          className={`${pre} z-[1] bg-card text-foreground`}
          style={{ marginLeft: `${pos}%` }}
          aria-label={`${labels.with}: ${after.file}`}
        >
          <code>{highlight(after.code)}</code>
        </pre>

        <div className="pointer-events-none absolute inset-y-0 z-[2] w-0.5 -translate-x-1/2 bg-primary" style={{ left: `${pos}%` }} />
        <button
          type="button"
          role="slider"
          aria-label={labels.drag}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setPos((p) => Math.max(4, p - 5));
            if (e.key === "ArrowRight") setPos((p) => Math.min(96, p + 5));
          }}
          className="absolute top-1/2 z-[3] grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_-6px_var(--bp-glow)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary"
          style={{ left: `${pos}%` }}
        >
          <ChevronsLeftRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
