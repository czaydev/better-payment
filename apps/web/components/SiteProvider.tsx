"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { isLocale } from "@/lib/i18n/config";
import { switchLocale } from "@/lib/i18n/switch";
import { withBasePath } from "@/lib/base-path";

/**
 * Fumadocs' root provider with next-themes on (system preference by default).
 * next-themes renders an inline <script> that sets the theme class before the
 * first paint. It runs from the server HTML; when the [lang] layout re-renders
 * on the client (switching tr/en), React would report the same <script> as one
 * that never executes, so on the client it is rendered as an inert text/plain block.
 *
 * The docs language picker uses the same switch as the navbar: fumadocs' default
 * pushes the unprefixed English URL, which the proxy sends back to Turkish while the
 * cookie says "tr".
 */
export default function SiteProvider({ i18n, ...props }: Omit<ComponentProps<typeof RootProvider>, "theme">) {
  const pathname = usePathname();
  return (
    <RootProvider
      {...props}
      i18n={
        i18n && {
          ...i18n,
          onLocaleChange: (locale) => {
            if (isLocale(locale) && locale !== i18n.locale) switchLocale(locale, pathname);
          },
        }
      }
      search={{ ...props.search, options: { api: withBasePath("/api/search"), ...props.search?.options } }}
      theme={{ scriptProps: { type: typeof window === "undefined" ? "text/javascript" : "text/plain" } }}
    />
  );
}
