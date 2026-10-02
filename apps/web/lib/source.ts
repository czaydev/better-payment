import { createElement } from "react";
import { docs, meta } from "@/.source/server";
import { loader, type LoaderPlugin } from "fumadocs-core/source";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { i18n } from "@/lib/i18n/config";

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
        src: `/brand/docs-icons/${node.icon}.webp`,
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
    transformPageTree: { file: resolve, folder: resolve, separator: resolve },
  };
}

export const source = loader({
  baseUrl: "/docs",
  i18n,
  source: toFumadocsSource(docs, meta),
  plugins: [brandIconsPlugin()],
});
