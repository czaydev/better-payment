import { createElement, type ReactElement } from "react";
import { withBasePath } from "@/lib/base-path";
import {
  Bell,
  Blocks,
  Bomb,
  BookOpen,
  Boxes,
  Braces,
  CircleArrowUp,
  CreditCard,
  Download,
  FileText,
  FlaskConical,
  GitPullRequest,
  Globe,
  History,
  Landmark,
  Languages,
  LockKeyhole,
  type LucideIcon,
  PencilRuler,
  Puzzle,
  Rocket,
  Route,
  Settings2,
  ShoppingCart,
  Sparkles,
  SquareFunction,
  TriangleAlert,
  WalletCards,
  Webhook,
} from "lucide-react";

/** A brand logo tile from public/brand/docs-logos (sources: SOURCES.md there) */
type Logo = { logo: string };

/**
 * Sidebar icon for each docs page, keyed by its path under content/docs (route groups left out).
 * Pages that only exist on the beta branch are listed too, so they get their icon once main
 * is merged into beta.
 */
const PAGE_ICONS: Record<string, LucideIcon | Logo> = {
  // Get started
  "": BookOpen,
  installation: Download,
  "quick-start": Rocket,
  "whats-new": Sparkles,
  // Concepts
  "concepts/configuration": Settings2,
  "concepts/handler": Route,
  "concepts/plugins": Puzzle,
  "concepts/events": Webhook,
  "concepts/testing": FlaskConical,
  // Payments
  "payments/pre-authorization": LockKeyhole,
  "payments/stored-cards": CreditCard,
  "payments/basket": ShoppingCart,
  // Providers
  "providers/iyzico": { logo: "providers-iyzico.png" },
  "providers/paytr": { logo: "providers-paytr.png" },
  "providers/parampos": { logo: "providers-parampos.png" },
  "providers/sipay": { logo: "providers-sipay.png" },
  // Banks
  "banks/akbank": { logo: "banks-akbank.png" },
  "banks/kuveytturk": { logo: "banks-kuveytturk.png" },
  "banks/est": Landmark,
  "banks/halkbank": { logo: "banks-halkbank.png" },
  "banks/isbank": { logo: "banks-isbank.png" },
  "banks/sekerbank": { logo: "banks-sekerbank.png" },
  "banks/teb": { logo: "banks-teb.png" },
  "banks/ziraat": { logo: "banks-ziraat.png" },
  "banks/denizbank": { logo: "banks-denizbank.png" },
  "banks/albaraka": { logo: "banks-albaraka.png" },
  "banks/vakifbank": { logo: "banks-vakifbank.png" },
  "banks/yapikredi": { logo: "banks-yapikredi.png" },
  "banks/qnb": { logo: "banks-qnb.png" },
  "banks/garanti": { logo: "banks-garanti.png" },
  // Integrations
  "integrations/frameworks": Boxes,
  "integrations/nextjs": { logo: "nextjs.svg" },
  "integrations/react-router": { logo: "react-router.svg" },
  "integrations/express": { logo: "express.svg" },
  "integrations/fastify": { logo: "fastify.svg" },
  "integrations/hono": { logo: "hono.svg" },
  "integrations/elysia": { logo: "elysia.svg" },
  "integrations/node": { logo: "node.svg" },
  "integrations/edge": Globe,
  "integrations/cloudflare-workers": { logo: "cloudflare-workers.svg" },
  "integrations/deno": { logo: "deno.svg" },
  "integrations/bun": { logo: "bun.svg" },
  // Plugins
  "plugins/i18n": Languages,
  "plugins/localized-errors": Languages,
  "plugins/chaos": Bomb,
  "plugins/notifications": Bell,
  "plugins/openapi": Braces,
  // Guides
  "guides/writing-plugins": PencilRuler,
  "guides/custom-providers": Blocks,
  "guides/test-cards": WalletCards,
  "guides/migration-0-5": CircleArrowUp,
  // Reference
  "reference/api": SquareFunction,
  "reference/types": Braces,
  "reference/error-codes": TriangleAlert,
  "reference/changelog": History,
};

function render(icon: LucideIcon | Logo): ReactElement {
  if ("logo" in icon) return logoIcon(icon.logo);
  return createElement(icon, { key: "icon", className: "size-4 shrink-0", "aria-hidden": true });
}

/** A logo from public/brand/docs-logos, sized like the line icons */
function logoIcon(file: string): ReactElement {
  return createElement("img", {
    key: "icon",
    src: withBasePath(`/brand/docs-logos/${file}`),
    alt: "",
    width: 16,
    height: 16,
    className: "size-4 shrink-0 rounded-[4px] ring-1 ring-black/10 dark:ring-white/15",
  });
}

/**
 * The sidebar icon for a page, from its URL (`/docs/...`, or `/tr/docs/...`). External links get
 * a GitHub icon, and a page missing from the list gets a plain document icon.
 */
export function pageIcon(url: string, external?: boolean): ReactElement {
  if (external) return render(GitPullRequest);
  const path = url.replace(/^(?:\/[a-z]{2})?\/docs\/?/, "").replace(/\/$/, "");
  return render(PAGE_ICONS[path] ?? FileText);
}
