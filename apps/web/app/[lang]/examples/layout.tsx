import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { isLocale, localePath } from "@/lib/i18n/config";
import { notFound } from "next/navigation";
import { IS_BETA_DOCS } from "@/lib/base-path";
import { BetaBanner } from "@/components/docs/BetaBanner";
import { DocsSidebarBanner } from "@/components/docs/DocsSidebarBanner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { getDictionary } from "@/lib/i18n/dictionary";
import { VERSION } from "better-payment";
import { getExamplesPageTree } from "@/lib/examples-source";

const SHOW_VERSION_PICKER = IS_BETA_DOCS || process.env.NEXT_PUBLIC_BETA_DOCS === "1";

export default async function ExamplesLayout({
  children,
  params,
}: LayoutProps<"/[lang]/examples">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = getDictionary(lang);

  return (
    <>
      {IS_BETA_DOCS && <BetaBanner lang={lang} />}
      <Navbar version={VERSION} lang={lang} t={t.nav} position="sticky" />
      <div style={{ "--fd-banner-height": "4rem" } as React.CSSProperties}>
        <DocsLayout
          tree={getExamplesPageTree(lang)}
          i18n
          themeSwitch={{ enabled: false }}
          nav={{
            title: <span className="sr-only">Better Payment Examples</span>,
            url: localePath(lang, "/examples"),
          }}
          sidebar={{
            banner: (
              <DocsSidebarBanner
                section="examples"
                lang={lang}
                showVersionPicker={SHOW_VERSION_PICKER}
                beta={IS_BETA_DOCS}
              />
            ),
          }}
        >
          {children}
        </DocsLayout>
      </div>
      <Footer lang={lang} t={t.footer} />
    </>
  );
}
