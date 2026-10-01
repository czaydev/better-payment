import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { Callout } from "fumadocs-ui/components/callout";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Card, Cards } from "fumadocs-ui/components/card";
import { Since, type SinceProps } from "@/components/docs/Since";
import { localePath, type Locale } from "@/lib/i18n/config";

export function getMDXComponents(components: MDXComponents, lang: Locale = "en"): MDXComponents {
  const Link = components.a as ((props: ComponentProps<"a">) => React.ReactNode) | undefined;
  return {
    ...components,
    // Internal links in the docs are written without a locale; keep readers in their language
    a: ({ href, ...props }: ComponentProps<"a">) => {
      const localized = typeof href === "string" && href.startsWith("/") ? localePath(lang, href) : href;
      return Link ? <Link href={localized} {...props} /> : <a href={localized} {...props} />;
    },
    Callout,
    Tab,
    Tabs,
    Card,
    Cards,
    Since: (props: SinceProps) => <Since {...props} lang={lang} />,
  };
}
