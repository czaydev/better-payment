import { createElement } from "react";
import { docs, meta } from "@/.source/server";
import { loader, type LoaderPlugin } from "fumadocs-core/source";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { i18n, localeText, type Locale } from "@/lib/i18n/config";
import { releaseStatus } from "@/lib/release";
import { withBasePath } from "@/lib/base-path";
import { pageIcon } from "@/lib/docs-page-icons";

/**
 * Sidebar group icons from the brand's frosted-glass set
 * (meta.json `icon` → public/brand/docs-icons/<icon>.webp).
 */
function brandIconsPlugin(): LoaderPlugin {
  const resolve = <T extends { icon?: unknown }>(node: T): T => {
    if (typeof node.icon === "string") {
      node.icon = createElement("img", {
        // Fumadocs renders the icon inside a list of children
        key: "icon",
        src: withBasePath(`/brand/docs-icons/${node.icon}.webp`),
        alt: "",
        width: 20,
        height: 20,
        className: "size-5 shrink-0",
      });
    }
    return node;
  };
  return {
    name: "better-payment:icons",
    transformPageTree: {
      // Pages get a line icon (or a brand tile) from lib/docs-page-icons.ts
      file: (node) => {
        if (node.icon === undefined) node.icon = pageIcon(node.url, node.external);
        return resolve(node);
      },
      folder: resolve,
      separator: resolve,
    },
  };
}

/** Sidebar badges per language; languages without their own copy fall back to English */
const SIDEBAR_BADGES: Record<string, { en: string } & Partial<Record<Locale, string>>> = {
  beta: { en: "Beta", tr: "Beta" },
  unreleased: { en: "Soon", tr: "Yakında" },
};

/**
 * A "Beta" (or "Soon") badge next to pages whose frontmatter `since` version is not a stable
 * release yet. It goes away on its own once that version is released.
 */
function releaseBadgesPlugin(): LoaderPlugin {
  return {
    name: "better-payment:release-badges",
    transformPageTree: {
      file(node, filePath) {
        if (!filePath) return node;
        const file = this.storage.read(filePath);
        const since = file?.format === "page" ? (file.data as { since?: unknown }).since : undefined;
        if (typeof since !== "string") return node;
        const status = releaseStatus(since);
        if (status === "stable") return node;
        const lang = (this.locale ?? i18n.defaultLanguage) as Locale;
        node.name = createElement(
          "span",
          { className: "inline-flex items-center gap-1.5" },
          node.name,
          createElement(
            "span",
            {
              key: "badge",
              "data-release-status": status,
              className:
                status === "beta"
                  ? "rounded-full border border-primary/30 bg-tint px-1.5 text-[10.5px] leading-4 font-semibold text-accent-text"
                  : "rounded-full border border-warning/30 bg-warning-soft px-1.5 text-[10.5px] leading-4 font-semibold text-warning",
            },
            localeText(SIDEBAR_BADGES[status], lang),
          ),
        );
        return node;
      },
    },
  };
}

export const source = loader({
  baseUrl: "/docs",
  i18n,
  source: toFumadocsSource(docs, meta),
  plugins: [brandIconsPlugin(), releaseBadgesPlugin()],
});
