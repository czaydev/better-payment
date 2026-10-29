import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BookOpen, Building2, Check, Wallet } from "lucide-react";
import { PageShell, PageHero, Section, SectionHead, Card, CodeCard, DarkBlock, StepsCard, LinkCard, ArrowChip, StatTiles } from "@/components/page/primitives";
import ProviderBanner, { LogoTile } from "@/components/page/ProviderBanner";
import { buttonVariants } from "@/lib/button-variants";
import { PROVIDER_META } from "@/lib/provider-meta";
import { PROVIDERS_DATA, PROVIDER_SLUGS, type ProviderSlug } from "@/lib/providers-data";
import { loc } from "@/lib/features-data";
import { alternates, isLocale, localePath, LOCALES } from "@/lib/i18n/config";

export function generateStaticParams() {
  return LOCALES.flatMap((lang) => PROVIDER_SLUGS.map((slug) => ({ lang, slug })));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/providers/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) return {};
  const p = PROVIDERS_DATA[slug as ProviderSlug];
  if (!p) return {};
  return {
    title: `${p.name} ${lang === "tr" ? "Entegrasyonu" : "Integration"} — Better Payment`,
    description: loc(p.description, lang),
    alternates: alternates(`/providers/${slug}`, lang),
  };
}

export default async function ProviderDetailPage({ params }: PageProps<"/[lang]/providers/[slug]">) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();
  const provider = PROVIDERS_DATA[slug as ProviderSlug];
  if (!provider) notFound();
  const meta = PROVIDER_META[provider.slug];
  const isTr = lang === "tr";
  const isGateway = provider.category === "gateway";

  const flow = isTr
    ? [
        { title: "createPayment / initThreeDSPayment", desc: `Tek tip istek, ${provider.name} formatına çevrilir.` },
        { title: `${meta.protocol} · ${meta.auth}`, desc: "İmzalar ve alan eşlemeleri otomatik üretilir." },
        { title: "Callback doğrulaması", desc: "İmza sabit zamanlı karşılaştırılır, sipariş eşleşmesi kontrol edilir." },
        { title: "Normalize sonuç", desc: "Başarı, hata kodu ve işlem kimliği ortak yapıda döner." },
      ]
    : [
        { title: "createPayment / initThreeDSPayment", desc: `One typed request, translated into ${provider.name}'s format.` },
        { title: `${meta.protocol} · ${meta.auth}`, desc: "Signatures and field mappings are generated for you." },
        { title: "Callback verification", desc: "The signature is compared in constant time and the order match is checked." },
        { title: "Normalized result", desc: "Success, error code and transaction id come back in one shape." },
      ];

  return (
    <PageShell lang={lang}>
      <PageHero
        crumbs={[
          { label: isTr ? "Sağlayıcılar" : "Providers", href: localePath(lang, "/providers") },
          { label: provider.name },
        ]}
        eyebrow={loc(provider.badge, lang).toLocaleLowerCase(lang).replace(/^\p{L}/u, (c) => c.toLocaleUpperCase(lang))}
        icon={isGateway ? Wallet : Building2}
        title={loc(provider.headline, lang)}
        lead={loc(provider.description, lang)}
        actions={
          <>
            <Link href={localePath(lang, provider.docsHref)} className={buttonVariants({ size: "lg" })}>
              <BookOpen />
              {isTr ? `${provider.name} dokümanları` : `${provider.name} docs`}
            </Link>
            <Link href={localePath(lang, "/docs/quick-start")} className={buttonVariants({ variant: "outline", size: "lg" })}>
              {isTr ? "Hızlı başlangıç" : "Quick start"}
            </Link>
          </>
        }
        visual={
          <ProviderBanner
            name={provider.name}
            logo={{ src: meta.logo, w: meta.w, h: meta.h }}
            chips={provider.features.slice(0, 3).map((f) => loc(f, lang).split(/ ve |, | & /)[0])}
          />
        }
      >
        <StatTiles
          items={[
            { label: isTr ? "Protokol" : "Protocol", value: meta.protocol.split(" · ")[0] },
            { label: isTr ? "Doğrulama" : "Auth", value: meta.auth.split(" · ")[0] },
            { label: "3D Secure", value: isTr ? "Dahil" : "Included", note: loc(meta.threeDs, lang) },
            { label: isTr ? "Bağımlılık" : "Dependencies", value: "0" },
          ]}
        />
      </PageHero>

      <Section className="pt-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card className="sm:p-10">
            <SectionHead
              eyebrow={isTr ? "Yetenekler" : "Capabilities"}
              icon={Check}
              title={isTr ? `${provider.name} için eksiksiz destek` : `Full ${provider.name} support`}
              className="mb-8"
            />
            <ul className="space-y-4">
              {provider.features.map((f) => (
                <li key={f.en} className="flex items-start gap-3 text-body text-foreground">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-tint text-accent-text"><Check className="size-3" strokeWidth={2.5} /></span>
                  {loc(f, lang)}
                </li>
              ))}
            </ul>
          </Card>
          <div>
            <p className="mb-3 px-2 text-body-sm font-medium text-muted-foreground">{isTr ? "Bir istek nasıl akar" : "How a request flows"}</p>
            <StepsCard steps={flow} />
          </div>
        </div>
      </Section>

      <Section className="pt-0">
        <DarkBlock>
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <div className="mb-6 flex items-center gap-3">
                <LogoTile src={meta.logo} w={meta.w} h={meta.h} name={provider.name} size="md" />
              </div>
              <h2 className="text-title-lg sm:text-title-xl">{isTr ? "Tek satırla bağlayın." : "Connect in one config."}</h2>
              <p className="mt-4 text-body-lg text-muted-foreground">
                {isTr ? "Kimlik bilgilerinizi verin, geri kalanı Better Payment halleder." : "Hand over your credentials; Better Payment handles the rest."}
              </p>
            </div>
            <CodeCard filename={`payment-${provider.slug}.ts`} code={provider.configCode} className="border border-border bg-background" />
          </div>
        </DarkBlock>
      </Section>

      <Section className="pt-0">
        <h2 className="mb-6 text-title-md text-foreground">{isTr ? "Diğer sağlayıcılar" : "Other providers"}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROVIDER_SLUGS.filter((s) => s !== provider.slug).slice(0, 4).map((s) => {
            const o = PROVIDERS_DATA[s];
            const om = PROVIDER_META[s];
            return (
              <LinkCard key={s} href={localePath(lang, `/providers/${s}`)} className="gap-8 p-6">
                <div className="flex items-start justify-between">
                  <LogoTile src={om.logo} w={om.w} h={om.h} name={o.name} size="md" />
                  <ArrowChip />
                </div>
                <div>
                  <p className="text-title-sm text-foreground">{o.name}</p>
                  <p className="mt-1 text-caption text-muted-foreground">{loc(om.tagline, lang)}</p>
                </div>
              </LinkCard>
            );
          })}
        </div>
        <Link href={localePath(lang, "/providers")} className={`${buttonVariants({ variant: "outline", pill: true })} mt-6`}>
          {isTr ? "Tüm sağlayıcılar" : "All providers"} <ArrowRight data-icon="chevron" />
        </Link>
      </Section>
    </PageShell>
  );
}
