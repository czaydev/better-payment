/** Mega menu structure: destinations, groups and icons. Copy lives in the dictionary (`nav.menu`). */
export const GITHUB_URL = "https://github.com/czaydev/better-payment";

export type MenuIcon =
  | "layers" | "shield" | "wallet" | "puzzle" | "rocket" | "download" | "globe" | "book" | "card" | "clock"
  | "sparkles" | "route" | "alert" | "plug" | "github" | "basket" | "lock" | "bell" | "flask" | "code" | "package"
  | "settings" | "building" | "bug" | "box" | "pen";

export type MenuKey = "product" | "providers" | "developers" | "resources";
export const MENU_KEYS: MenuKey[] = ["product", "providers", "developers", "resources"];

type Item = { id: string; href: string; icon: MenuIcon; external?: boolean };
type Group = { id: string; items: readonly Item[] };

export const menus: Record<MenuKey, { icon: MenuIcon; href: string; groups: readonly Group[] }> = {
  product: {
    icon: "layers",
    href: "/product",
    groups: [
      {
        id: "payment",
        items: [
          { id: "unified", href: "/features/unified", icon: "layers" },
          { id: "basket", href: "/features/basket", icon: "basket" },
          { id: "preAuth", href: "/features/pre-auth", icon: "lock" },
          { id: "storedCards", href: "/features/stored-cards", icon: "card" },
        ],
      },
      {
        id: "security",
        items: [
          { id: "handler", href: "/features/handler", icon: "shield" },
          { id: "events", href: "/features/events", icon: "bell" },
          { id: "errorCodes", href: "/features/error-codes", icon: "alert" },
        ],
      },
      {
        id: "extend",
        items: [
          { id: "plugins", href: "/features/plugins", icon: "puzzle" },
          { id: "customProviders", href: "/features/custom-providers", icon: "plug" },
          { id: "testing", href: "/features/testing", icon: "flask" },
        ],
      },
    ],
  },
  providers: {
    icon: "building",
    href: "/providers",
    groups: [
      {
        id: "gateways",
        items: [
          { id: "iyzico", href: "/providers/iyzico", icon: "wallet" },
          { id: "paytr", href: "/providers/paytr", icon: "wallet" },
          { id: "sipay", href: "/providers/sipay", icon: "wallet" },
          { id: "parampos", href: "/providers/parampos", icon: "wallet" },
        ],
      },
      {
        id: "banks",
        items: [
          { id: "akbank", href: "/providers/akbank", icon: "building" },
          { id: "halkbank", href: "/providers/halkbank", icon: "building" },
          { id: "isbank", href: "/providers/isbank", icon: "building" },
          { id: "kuveytturk", href: "/providers/kuveytturk", icon: "building" },
          { id: "sekerbank", href: "/providers/sekerbank", icon: "building" },
          { id: "teb", href: "/providers/teb", icon: "building" },
          { id: "ziraat", href: "/providers/ziraat", icon: "building" },
        ],
      },
      {
        id: "more",
        items: [
          { id: "customProviders", href: "/features/custom-providers", icon: "plug" },
          { id: "testCards", href: "/features/testing", icon: "card" },
        ],
      },
    ],
  },
  developers: {
    icon: "code",
    href: "/developers",
    groups: [
      {
        id: "start",
        items: [
          { id: "docs", href: "/docs", icon: "book" },
          { id: "quickStart", href: "/docs/quick-start", icon: "rocket" },
          { id: "installation", href: "/docs/installation", icon: "download" },
          { id: "configuration", href: "/docs/concepts/configuration", icon: "settings" },
        ],
      },
      {
        id: "integrations",
        items: [
          { id: "nextjs", href: "/docs/integrations/nextjs", icon: "route" },
          { id: "edge", href: "/docs/integrations/edge", icon: "globe" },
          { id: "frameworks", href: "/docs/integrations/frameworks", icon: "box" },
        ],
      },
      {
        id: "reference",
        items: [
          { id: "api", href: "/docs/reference/api", icon: "book" },
          { id: "types", href: "/docs/reference/types", icon: "code" },
          { id: "errorCodes", href: "/docs/reference/error-codes", icon: "alert" },
          { id: "testCards", href: "/docs/guides/test-cards", icon: "card" },
        ],
      },
    ],
  },
  resources: {
    icon: "book",
    href: "/resources",
    groups: [
      {
        id: "releases",
        items: [
          { id: "blog", href: "/blog", icon: "pen" },
          { id: "changelog", href: "/docs/reference/changelog", icon: "clock" },
          { id: "whatsNew", href: "/docs/whats-new", icon: "sparkles" },
          { id: "migration", href: "/docs/guides/migration-0-5", icon: "route" },
        ],
      },
      {
        id: "community",
        items: [
          { id: "github", href: GITHUB_URL, icon: "github", external: true },
          { id: "npm", href: "https://www.npmjs.com/package/better-payment", icon: "package", external: true },
          { id: "issues", href: `${GITHUB_URL}/issues`, icon: "bug", external: true },
        ],
      },
    ],
  },
};
