import { VERSION } from "better-payment";
import { notFound } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function BlogLayout({ children, params }: LayoutProps<"/[lang]/blog">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = getDictionary(lang);

  return (
    <>
      <Navbar version={VERSION} lang={lang} t={t.nav} position="sticky" />
      <main id="main-content" tabIndex={-1} className="scroll-mt-20 focus:outline-none">
        {children}
      </main>
      <Footer lang={lang} t={t.footer} />
    </>
  );
}
