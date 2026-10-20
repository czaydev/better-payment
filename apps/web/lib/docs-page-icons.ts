import { createElement, type ReactElement } from "react";
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

/** A square tile in the brand's color, for providers and banks whose logos are wordmarks */
type Monogram = { label: string; bg: string; fg?: string };

/**
 * Sidebar icon for each docs page, keyed by its path under content/docs (route groups left out).
 * Pages that only exist on the beta branch are listed too, so they get their icon once main
 * is merged into beta.
 */
const PAGE_ICONS: Record<string, LucideIcon | Monogram> = {
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
  "providers/iyzico": { label: "iy", bg: "#1e64ff" },
  "providers/paytr": { label: "PT", bg: "#0a3e8c" },
  "providers/parampos": { label: "P", bg: "#49267f" },
  "providers/sipay": { label: "S", bg: "#211261" },
  // Banks
  "banks/akbank": { label: "A", bg: "#dc0005" },
  "banks/kuveytturk": { label: "KT", bg: "#16a085" },
  "banks/est": Landmark,
  "banks/halkbank": Landmark,
  "banks/isbank": Landmark,
  "banks/sekerbank": Landmark,
  "banks/teb": Landmark,
  "banks/ziraat": Landmark,
  "banks/denizbank": { label: "D", bg: "#004899" },
  "banks/albaraka": { label: "AT", bg: "#00843d" },
  "banks/vakifbank": { label: "V", bg: "#fbc34e", fg: "#1a1a1a" },
  "banks/yapikredi": { label: "YK", bg: "#124b8c" },
  "banks/qnb": { label: "Q", bg: "#003d74" },
  "banks/garanti": { label: "G", bg: "#004481" },
  // Integrations
  "integrations/nextjs": { label: "N", bg: "#000000" },
  "integrations/frameworks": Boxes,
  "integrations/edge": Globe,
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

function render(icon: LucideIcon | Monogram): ReactElement {
  if ("label" in icon) {
    return createElement(
      "span",
      {
        key: "icon",
        "aria-hidden": true,
        className:
          "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[8.5px] ring-1 ring-black/10 ring-inset dark:ring-white/15 leading-none font-bold tracking-tight",
        style: { backgroundColor: icon.bg, color: icon.fg ?? "#ffffff" },
      },
      icon.label,
    );
  }
  return createElement(icon, { key: "icon", className: "size-4 shrink-0", "aria-hidden": true });
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
