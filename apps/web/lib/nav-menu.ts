/** Mega menu structure: destinations, groups and icons. Copy lives in the dictionary (`nav.menu`). */
export const GITHUB_URL = "https://github.com/czaydev/better-payment";

export type MenuIcon =
  | "unified" | "payments" | "installments" | "threeds" | "handler" | "events" | "status" | "plugins" | "sandbox"
  | "providers" | "banks" | "get-started" | "guides" | "integrations" | "reference" | "concepts" | "edge" | "github";

/** Approved glass icon assets shared by desktop and mobile navigation. */
export const MENU_ICON_ASSETS: Record<Exclude<MenuIcon, "github">, string> = {
  unified: "/brand/icons/icon-unified-api.webp",
  payments: "/brand/docs-icons/payments.webp",
  installments: "/brand/icons/icon-installments.webp",
  threeds: "/brand/icons/icon-threeds.webp",
  handler: "/brand/icons/icon-handler.webp",
  events: "/brand/icons/icon-events.webp",
  status: "/brand/icons/icon-status.webp",
  plugins: "/brand/icons/icon-plugin.webp",
  sandbox: "/brand/icons/icon-sandbox.webp",
  providers: "/brand/docs-icons/providers.webp",
  banks: "/brand/docs-icons/banks.webp",
  "get-started": "/brand/docs-icons/get-started.webp",
  guides: "/brand/docs-icons/guides.webp",
  integrations: "/brand/docs-icons/integrations.webp",
  reference: "/brand/docs-icons/reference.webp",
  concepts: "/brand/docs-icons/concepts.webp",
  edge: "/brand/icons/icon-edge.webp",
};

export type MenuKey = "product" | "providers" | "developers" | "resources";
export const MENU_KEYS: MenuKey[] = ["product", "providers", "developers", "resources"];

type Item = { id: string; href: string; icon: MenuIcon; external?: boolean };
type Group = { id: string; items: readonly Item[] };

export const menus: Record<MenuKey, { icon: MenuIcon; href: string; groups: readonly Group[] }> = {
  product: {
    icon: "unified",
    href: "/product",
    groups: [
      {
        id: "payment",
        items: [
          { id: "unified", href: "/features/unified", icon: "unified" },
          { id: "basket", href: "/features/basket", icon: "installments" },
          { id: "preAuth", href: "/features/pre-auth", icon: "threeds" },
          { id: "storedCards", href: "/features/stored-cards", icon: "payments" },
        ],
      },
      {
        id: "security",
        items: [
          { id: "handler", href: "/features/handler", icon: "handler" },
          { id: "events", href: "/features/events", icon: "events" },
          { id: "errorCodes", href: "/features/error-codes", icon: "status" },
        ],
      },
      {
        id: "extend",
        items: [
          { id: "plugins", href: "/features/plugins", icon: "plugins" },
          { id: "customProviders", href: "/features/custom-providers", icon: "plugins" },
          { id: "testing", href: "/features/testing", icon: "sandbox" },
        ],
      },
    ],
  },
  providers: {
    icon: "providers",
    href: "/providers",
    groups: [
      {
        id: "gateways",
        items: [
          { id: "iyzico", href: "/providers/iyzico", icon: "providers" },
          { id: "paytr", href: "/providers/paytr", icon: "providers" },
          { id: "sipay", href: "/providers/sipay", icon: "providers" },
          { id: "parampos", href: "/providers/parampos", icon: "providers" },
        ],
      },
      {
        id: "banks",
        items: [
          { id: "akbank", href: "/providers/akbank", icon: "banks" },
          { id: "halkbank", href: "/providers/halkbank", icon: "banks" },
          { id: "isbank", href: "/providers/isbank", icon: "banks" },
          { id: "kuveytturk", href: "/providers/kuveytturk", icon: "banks" },
          { id: "sekerbank", href: "/providers/sekerbank", icon: "banks" },
          { id: "teb", href: "/providers/teb", icon: "banks" },
          { id: "ziraat", href: "/providers/ziraat", icon: "banks" },
        ],
      },
      {
        id: "more",
        items: [
          { id: "customProviders", href: "/features/custom-providers", icon: "plugins" },
          { id: "testCards", href: "/features/testing", icon: "sandbox" },
        ],
      },
    ],
  },
  developers: {
    icon: "get-started",
    href: "/developers",
    groups: [
      {
        id: "start",
        items: [
          { id: "docs", href: "/docs", icon: "get-started" },
          { id: "quickStart", href: "/docs/quick-start", icon: "get-started" },
          { id: "installation", href: "/docs/installation", icon: "guides" },
          { id: "configuration", href: "/docs/concepts/configuration", icon: "concepts" },
        ],
      },
      {
        id: "integrations",
        items: [
          { id: "nextjs", href: "/docs/integrations/nextjs", icon: "integrations" },
          { id: "edge", href: "/docs/integrations/edge", icon: "edge" },
          { id: "frameworks", href: "/docs/integrations/frameworks", icon: "integrations" },
        ],
      },
      {
        id: "reference",
        items: [
          { id: "api", href: "/docs/reference/api", icon: "reference" },
          { id: "types", href: "/docs/reference/types", icon: "concepts" },
          { id: "errorCodes", href: "/docs/reference/error-codes", icon: "status" },
          { id: "testCards", href: "/docs/guides/test-cards", icon: "sandbox" },
        ],
      },
    ],
  },
  resources: {
    icon: "guides",
    href: "/resources",
    groups: [
      {
        id: "releases",
        items: [
          { id: "blog", href: "/blog", icon: "guides" },
          { id: "changelog", href: "/docs/reference/changelog", icon: "reference" },
          { id: "whatsNew", href: "/docs/whats-new", icon: "events" },
          { id: "migration", href: "/docs/guides/migration-0-5", icon: "integrations" },
        ],
      },
      {
        id: "community",
        items: [
          { id: "github", href: GITHUB_URL, icon: "github", external: true },
          { id: "npm", href: "https://www.npmjs.com/package/better-payment", icon: "plugins", external: true },
          { id: "issues", href: `${GITHUB_URL}/issues`, icon: "status", external: true },
        ],
      },
    ],
  },
};
