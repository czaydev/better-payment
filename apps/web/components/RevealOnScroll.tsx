"use client";

import { useEffect } from "react";

/**
 * Plays the entrance (fade and rise, same pace as the hero) once for every
 * `.bp-reveal` element as it scrolls into view. Elements stay visible when
 * JavaScript, IntersectionObserver or motion is unavailable.
 */
export default function RevealOnScroll() {
  useEffect(() => {
    if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.documentElement;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-shown", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );

    root.setAttribute("data-reveal", "");
    document.querySelectorAll(".bp-reveal:not([data-shown])").forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      root.removeAttribute("data-reveal");
    };
  }, []);

  return null;
}
