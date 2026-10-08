"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import type { ComponentProps } from "react";

/**
 * Fumadocs' root provider with next-themes on (system preference by default).
 * next-themes renders an inline <script> that sets the theme class before the
 * first paint. It runs from the server HTML; when the [lang] layout re-renders
 * on the client (switching tr/en), React would report the same <script> as one
 * that never executes, so on the client it is rendered as an inert text/plain block.
 */
export default function SiteProvider(props: Omit<ComponentProps<typeof RootProvider>, "theme">) {
  return (
    <RootProvider
      {...props}
      theme={{ scriptProps: { type: typeof window === "undefined" ? "text/javascript" : "text/plain" } }}
    />
  );
}
