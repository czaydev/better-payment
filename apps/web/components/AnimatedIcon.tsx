"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Looping frosted-glass icon (vault: Asset_Pipeline/Web/Animasyon). The video
 * is encoded on pure white and blended with multiply, so it only belongs on
 * light surfaces. With reduced motion it stays on its poster frame.
 */
export default function AnimatedIcon({ name, className }: { name: string; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (media.matches) el.pause();
      else el.play().catch(() => {});
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return (
    <video
      ref={video}
      className={cn("size-24 mix-blend-multiply", className)}
      poster={`/brand/icons/icon-${name}.webp`}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
    >
      <source src={`/brand/icons/icon-${name}.webm`} type="video/webm" />
      <source src={`/brand/icons/icon-${name}.mp4`} type="video/mp4" />
    </video>
  );
}
