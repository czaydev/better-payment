import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation"
import { ArrowRight, Layers, Sparkles } from "lucide-react"
import { PageShell, PageHero, Section, SectionHead, DarkBlock, StepsCard, StatTiles, LinkCard, ArrowChip } from "@/components/page/primitives"
import { buttonVariants } from "@/lib/button-variants"
import { FEATURES_DATA, loc } from "@/lib/features-data"
import { PROVIDERS_DATA, PROVIDER_SLUGS } from "@/lib/providers-data"
import { PROVIDER_META } from "@/lib/provider-meta"
import { withBasePath } from "@/lib/base-path"
import { alternates, isLocale, localePath, LOCALES } from "@/lib/i18n/config"

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/product">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};

  const isTr = lang === "tr";
  const title = isTr
    ? "Ürün ve Mimari — Better Payment"
    : "Product & Architecture — Better Payment";
  const description = isTr
    ? "Türkiye'deki tüm ödeme altyapıları ve banka sanal POS'ları için standartlaştırılmış modern, güvenli ve bağımsız ödeme motoru."
    : "The modern, unified and dependency-free payment engine for Turkish payment gateways and bank virtual POS systems.";

  return {
    title,
    description,
    alternates: alternates("/product", lang),
  };
}

export default async function ProductPage({ params }: PageProps<"/[lang]/product">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const isTr = lang === "tr";

  const steps = [
    {
      num: "01",
      title: isTr ? "Standart Tip Güvenli İstek" : "Type-Safe Standard Request",
      desc: isTr
        ? "Uygulamanız createPayment çağırır. Kart, tutar, para birimi ve sepet bilgileri tek bir ortak TypeScript arayüzü ile sağlanır."
        : "Your application calls createPayment. Card, amount, currency and basket metadata adhere to one uniform TypeScript interface.",
    },
    {
      num: "02",
      title: isTr ? "Akıllı Sağlayıcı Çevirici (Adapter)" : "Smart Provider Adapter",
      desc: isTr
        ? "Better Payment, hedef sağlayıcının (iyzico JSON, Garanti EST XML, PayTR hash) protokolüne otomatik dönüştürür ve hash imzalarını üretir."
        : "Better Payment transforms the request into the gateway's native protocol (JSON, SOAP XML, HMAC hash) with zero manual formatting.",
    },
    {
      num: "03",
      title: isTr ? "Sabit Zamanlı 3D Secure Doğrulaması" : "Timing-Safe 3D Secure Verification",
      desc: isTr
        ? "Callback veya webhook bildirimleri geldiğinde, zamanlama saldırılarına (timing attacks) karşı korumalı sabit süreli imza kontrolü yapılır."
        : "When callbacks or webhooks arrive, signatures are checked using constant-time cryptographic verification to prevent timing attacks.",
    },
    {
      num: "04",
      title: isTr ? "Normalize Edilmiş Sonuç" : "Normalized Unified Result",
      desc: isTr
        ? "Sağlayıcı ister hata dönsün ister onay, hata kodları ve başarı durumu normalize edilerek uygulamanıza teslim edilir."
        : "Whether the provider approves or fails, error codes, installment details and transaction IDs are normalized for your business logic.",
    },
  ];

  const groups = [
    { title: isTr ? "Ödeme" : "Payments", slugs: ["unified", "basket", "pre-auth", "stored-cards"] as const },
    { title: isTr ? "Güvenlik" : "Security", slugs: ["handler", "events", "error-codes"] as const },
    { title: isTr ? "Genişletme" : "Extend", slugs: ["plugins", "custom-providers", "testing"] as const },
  ];
  const wall = PROVIDER_SLUGS.slice(0, 8);

  return (
    <PageShell lang={lang}>
      <PageHero
        eyebrow={isTr ? "Ürün ve mimari" : "Product and architecture"}
        icon={Sparkles}
        title={isTr ? "Türkiye için modern, birleşik ödeme motoru." : "The modern, unified payment engine."}
        lead={isTr
          ? "iyzico, PayTR, Sipay, Parampos ve yedi bankanın sanal POS sistemini tek bir sıfır bağımlılıklı, tip güvenli TypeScript motorunda toplar."
          : "iyzico, PayTR, Sipay, Parampos and seven bank virtual POS systems behind one zero-dependency, type-safe TypeScript engine."}
        actions={
          <>
            <Link href={localePath(lang, "/docs/quick-start")} className={buttonVariants({ size: "lg" })}>
              {isTr ? "Hızlı başlangıç" : "Quick start"} <ArrowRight data-icon="chevron" />
            </Link>
            <Link href={localePath(lang, "/examples")} className={buttonVariants({ variant: "outline", size: "lg" })}>
              {isTr ? "Örnek mağaza" : "Example store"}
            </Link>
          </>
        }
        visual={
          <div className="rounded-card border border-border bg-card p-3">
            <div className="rounded-[26px] border border-border bg-surface p-6">
              <div className="mx-auto w-fit rounded-2xl border border-border bg-card px-5 py-3 font-mono text-meta text-foreground">your app</div>
              <span className="mx-auto block h-6 w-px bg-border-strong" aria-hidden />
              <div className="mx-auto flex w-fit items-center gap-2.5 rounded-2xl bg-primary px-5 py-3 font-mono text-meta text-primary-foreground">
                <Image src={withBasePath("/brand/better-payment-symbol-white.svg")} alt="" width={18} height={18} />
                createBetterPayment()
              </div>
              <span className="mx-auto block h-6 w-px bg-border-strong" aria-hidden />
              <div className="grid grid-cols-4 gap-2.5">
                {wall.map((s) => {
                  const m = PROVIDER_META[s];
                  return (
                    <span key={s} className="grid h-14 place-items-center rounded-2xl border border-border bg-logo px-2">
                      <Image src={withBasePath(m.logo)} alt={PROVIDERS_DATA[s].name} width={m.w} height={m.h} className="max-h-6 w-auto object-contain" />
                    </span>
                  );
                })}
              </div>
              <p className="mt-4 text-center text-caption text-muted-foreground">{isTr ? "ve 3 banka daha" : "and 3 more banks"}</p>
            </div>
          </div>
        }
      >
        <StatTiles items={[
          { label: isTr ? "Sağlayıcı ve banka" : "Providers and banks", value: "11" },
          { label: isTr ? "Çalışma zamanı bağımlılığı" : "Runtime dependencies", value: "0" },
          { label: isTr ? "Tip güvenliği" : "Type-safe", value: "100%" },
          { label: isTr ? "Çalıştığı yer" : "Runs on", value: "Edge" },
        ]} />
      </PageHero>

      <Section className="pt-6">
        <SectionHead
          eyebrow={isTr ? "Yetenekler" : "Capabilities"}
          icon={Layers}
          title={isTr ? "Ödeme altyapısının ihtiyacı olan her şey." : "Everything a payment stack needs."}
        />
        <div className="space-y-10">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="mb-4 px-1 text-body-sm font-medium text-muted-foreground">{g.title}</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {g.slugs.map((s) => {
                  const f = FEATURES_DATA[s];
                  const Icon = f.icon;
                  return (
                    <LinkCard key={s} href={localePath(lang, `/features/${s}`)} className="min-h-56 justify-between gap-8">
                      <div className="flex items-start justify-between">
                        <span className="grid size-11 place-items-center rounded-2xl bg-tint text-accent-text"><Icon className="size-5" /></span>
                        <ArrowChip />
                      </div>
                      <div>
                        <h3 className="text-title-sm text-foreground">{loc(f.title, lang)}</h3>
                        <p className="mt-1.5 line-clamp-2 text-body-sm text-muted-foreground">{loc(f.benefits[0].desc, lang)}</p>
                      </div>
                    </LinkCard>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section className="pt-0">
        <DarkBlock>
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <h2 className="text-title-lg sm:text-title-xl">{isTr ? "Bir ödeme nasıl akar?" : "How a payment flows."}</h2>
              <p className="mt-4 max-w-sm text-body-lg leading-relaxed text-muted-foreground">
                {isTr ? "İstekten sonuca dört adım; sağlayıcı ne olursa olsun aynı." : "Four steps from request to result, whichever provider you pick."}
              </p>
            </div>
            <StepsCard steps={steps.map((s) => ({ title: s.title, desc: s.desc }))} className="border-border bg-card" />
          </div>
        </DarkBlock>
      </Section>
    </PageShell>
  );
}
