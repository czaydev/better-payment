import { createElement } from "react";
import type * as PageTree from "fumadocs-core/page-tree";
import { ShoppingBag, Sparkles, Code2, ExternalLink } from "lucide-react";
import { localePath, type Locale } from "@/lib/i18n/config";

export function getExamplesPageTree(lang: Locale): PageTree.Root {
  const isTr = lang === "tr";

  return {
    name: isTr ? "Örnekler" : "Examples",
    children: [
      {
        type: "page",
        name: isTr ? "Genel Bakış" : "Overview",
        url: localePath(lang, "/examples"),
        icon: createElement(Sparkles, { className: "size-4 text-primary shrink-0" }),
      },
      {
        type: "separator",
        name: isTr ? "Uygulamalar" : "Applications",
      },
      {
        type: "page",
        name: isTr ? "Örnek Mağaza (Next.js + Prisma)" : "Example Shop (Next.js + Prisma)",
        description: isTr
          ? "Sepet, sunucu tarafında siparişler, 3D Secure ve iadeler içeren çalıştırılabilir mağaza."
          : "A complete storefront with a cart, server-side orders, 3D Secure and refunds.",
        url: localePath(lang, "/examples/next-shop"),
        icon: createElement(ShoppingBag, { className: "size-4 text-primary shrink-0" }),
      },
      {
        type: "separator",
        name: isTr ? "Bağlantılar" : "Links",
      },
      {
        type: "page",
        name: isTr ? "GitHub Deposu" : "GitHub Repository",
        url: "https://github.com/czaydev/better-payment/tree/beta/examples/next-shop",
        external: true,
        icon: createElement(ExternalLink, { className: "size-4 text-muted-foreground shrink-0" }),
      },
      {
        type: "page",
        name: isTr ? "Dokümantasyona Dön" : "Back to Documentation",
        url: localePath(lang, "/docs"),
        icon: createElement(Code2, { className: "size-4 text-muted-foreground shrink-0" }),
      },
    ],
  };
}
