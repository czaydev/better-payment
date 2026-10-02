import { VERSION } from "better-payment";
import { notFound } from "next/navigation";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Integrations from "@/components/Integrations";
import Features from "@/components/Features";
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
        <Integrations compare={t.compare} t={t.providers} bankTagline={t.banks.akbankTagline} code={t.code} />
        <Features t={t.features} />
        <Banks lang={lang} t={t.banks} />
        <QuickStart lang={lang} t={t.quickStart} code={t.code} />
        <CTA lang={lang} t={t.cta} />
      </main>
      <Footer lang={lang} t={t.footer} />
      <ScrollToSection />
    </>
  );
}
