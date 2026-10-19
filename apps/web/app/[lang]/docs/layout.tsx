import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { isLocale, localePath } from "@/lib/i18n/config";
import { notFound } from "next/navigation";
import { IS_BETA_DOCS } from "@/lib/base-path";
import { BetaBanner } from "@/components/docs/BetaBanner";
import { VersionPicker } from "@/components/docs/VersionPicker";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { getDictionary } from "@/lib/i18n/dictionary";
import { VERSION } from "better-payment";

// The picker shows on the beta deployment, and on the stable one while it serves a beta (BETA_ORIGIN)
const SHOW_VERSION_PICKER = IS_BETA_DOCS || process.env.NEXT_PUBLIC_BETA_DOCS === "1";

export default async function Layout({ children, params }: LayoutProps<"/[lang]/docs">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = getDictionary(lang);

  return (
    <>
      {IS_BETA_DOCS && <BetaBanner lang={lang} />}
      <Navbar version={VERSION} lang={lang} t={t.nav} position="sticky" />
      {/* The site navbar sits above the docs, so Fumadocs' sidebar and TOC start below it */}
      <div style={{ "--fd-banner-height": "4rem" } as React.CSSProperties}>
      <DocsLayout
        tree={source.getPageTree(lang)}
        i18n
        themeSwitch={{ enabled: false }}
        nav={{
          // The site navbar above already carries the logo
          title: <span className="sr-only">Better Payment</span>,
          url: localePath(lang, "/"),
        }}
        sidebar={SHOW_VERSION_PICKER ? { banner: <VersionPicker lang={lang} beta={IS_BETA_DOCS} /> } : undefined}
      >
        {children}
      </DocsLayout>
      </div>
      <Footer lang={lang} t={t.footer} />
    </>
  );
}
