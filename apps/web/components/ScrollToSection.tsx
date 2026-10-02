"use client";

import { useEffect } from "react";
import { SCROLL_TARGET_KEY } from "@/components/Navbar";

/** Scrolls to the section the navbar asked for when it linked here from another page */
export default function ScrollToSection() {
  useEffect(() => {
    const section = sessionStorage.getItem(SCROLL_TARGET_KEY);
    if (!section) return;
    sessionStorage.removeItem(SCROLL_TARGET_KEY);
    requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ behavior: "smooth" }));
  }, []);
  return null;
}
