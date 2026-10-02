import { VERSION } from "better-payment";
import { notFound } from "next/navigation";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import TrustBar from "@/components/TrustBar";
import Compare from "@/components/Compare";
import Features from "@/components/Features";
import Providers from "@/components/Providers";
import Banks from "@/components/Banks";
import QuickStart from "@/components/QuickStart";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";
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
        <TrustBar t={t.trustBar} />
        <Compare t={t.compare} />
        <Features t={t.features} />
        <Providers t={t.providers} />
        <Banks lang={lang} t={t.banks} />
        <QuickStart lang={lang} t={t.quickStart} />
        <CTA lang={lang} t={t.cta} />
      </main>
      <Footer lang={lang} t={t.footer} />
    </>
  );
}
