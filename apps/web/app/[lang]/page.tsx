import { VERSION } from "better-payment";
import { notFound } from "next/navigation";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Compare from "@/components/Compare";
import Features from "@/components/Features";
import Providers from "@/components/Providers";
import Banks from "@/components/Banks";
import QuickStart from "@/components/QuickStart";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";
import ScrollToSection from "@/components/ScrollToSection";
import { isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = getDictionary(lang);

  return (
    <>
      <Navbar version={VERSION} lang={lang} t={t.nav} />
      <main>
        <Hero lang={lang} t={t.hero} />
        <Compare t={t.compare} code={t.code} />
        <Features t={t.features} />
        <Providers t={t.providers} code={t.code} />
        <Banks lang={lang} t={t.banks} code={t.code} />
        <QuickStart lang={lang} t={t.quickStart} code={t.code} />
        <CTA lang={lang} t={t.cta} />
      </main>
      <Footer lang={lang} t={t.footer} />
      <ScrollToSection />
    </>
  );
}
