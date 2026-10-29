import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Building2, Plug, Wallet } from "lucide-react";
import { PageShell, PageHero, Section, SectionHead, LinkCard, ArrowChip, StatTiles } from "@/components/page/primitives";
import { LogoTile } from "@/components/page/ProviderBanner";
import { buttonVariants } from "@/lib/button-variants";
import { PROVIDERS_DATA, PROVIDER_SLUGS } from "@/lib/providers-data";
import { PROVIDER_META } from "@/lib/provider-meta";
import { loc } from "@/lib/features-data";
import { alternates, isLocale, localePath, LOCALES } from "@/lib/i18n/config";

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/providers">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const isTr = lang === "tr";
  return {
    title: isTr ? "Desteklenen Sağlayıcılar ve Bankalar — Better Payment" : "Supported Providers and Banks — Better Payment",
    description: isTr
      ? "iyzico, PayTR, Sipay, Parampos ve 7 banka sanal POS sistemi tek API arkasında."
      : "iyzico, PayTR, Sipay, Parampos and seven bank virtual POS systems behind one unified API.",
    alternates: alternates("/providers", lang),
  };
}

export default async function ProvidersPage({ params }: PageProps<"/[lang]/providers">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const isTr = lang === "tr";
  const gateways = PROVIDER_SLUGS.filter((s) => PROVIDERS_DATA[s].category === "gateway");
  const banks = PROVIDER_SLUGS.filter((s) => PROVIDERS_DATA[s].category === "bank");

  const grid = (slugs: readonly (typeof PROVIDER_SLUGS)[number][], cols: string) => (
    <div className={`grid gap-4 sm:grid-cols-2 ${cols}`}>
      {slugs.map((s) => {
        const p = PROVIDERS_DATA[s];
        const m = PROVIDER_META[s];
        return (
          <LinkCard key={s} href={localePath(lang, `/providers/${s}`)} className="gap-8 p-6">
            <div className="flex items-start justify-between">
              <LogoTile src={m.logo} w={m.w} h={m.h} name={p.name} size="md" />
              <ArrowChip />
            </div>
            <div>
              <p className="text-title-sm text-foreground">{p.name}</p>
              <p className="mt-1 text-body-sm text-muted-foreground">{loc(m.tagline, lang)}</p>
              <p className="mt-4 inline-block rounded-badge border border-border px-2.5 py-1 font-mono text-meta text-muted-foreground">{m.protocol}</p>
            </div>
          </LinkCard>
        );
      })}
    </div>
  );

  return (
    <PageShell lang={lang}>
      <PageHero
        eyebrow={isTr ? "Sağlayıcılar" : "Providers"}
        icon={Building2}
        title={isTr ? "Bir API, on bir bağlantı." : "One API, eleven connections."}
        lead={isTr
          ? "Ödeme kuruluşlarından banka sanal POS'larına: her birinin protokolü, imzası ve hata formatı farklı. Better Payment hepsini aynı tipli arayüze çevirir."
          : "From payment gateways to bank virtual POS: every one has its own protocol, signature and error format. Better Payment maps them all onto one typed interface."}
        actions={
          <>
            <Link href={localePath(lang, "/features/custom-providers")} className={buttonVariants({ size: "lg" })}>
              <Plug />
              {isTr ? "Kendi sağlayıcınızı ekleyin" : "Add your own provider"}
            </Link>
            <Link href={localePath(lang, "/features/testing")} className={buttonVariants({ variant: "outline", size: "lg" })}>
              {isTr ? "Test kartları" : "Test cards"}
            </Link>
          </>
        }
      >
        <StatTiles items={[
          { label: isTr ? "Ödeme kuruluşu" : "Gateways", value: "4" },
          { label: isTr ? "Banka sanal POS" : "Bank virtual POS", value: "7" },
          { label: "3D Secure", value: isTr ? "Hepsinde" : "Everywhere" },
          { label: isTr ? "Tek arayüz" : "One interface", value: "1" },
        ]} />
      </PageHero>

      <Section className="pt-6">
        <SectionHead eyebrow={isTr ? "Ödeme kuruluşları" : "Payment gateways"} icon={Wallet} title={isTr ? "Aracı kuruluşlar" : "Gateways"} />
        {grid(gateways, "lg:grid-cols-4")}
      </Section>

      <Section className="pt-0">
        <SectionHead eyebrow={isTr ? "Bankalar" : "Banks"} icon={Building2} title={isTr ? "Banka sanal POS'ları" : "Bank virtual POS"} />
        {grid(banks, "lg:grid-cols-4")}
      </Section>
    </PageShell>
  );
}
