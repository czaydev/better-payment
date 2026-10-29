import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation"
import { VERSION } from "better-payment"
import { BookOpen, Check, Code2, FlaskConical, Globe, Rocket, ShoppingBag, Terminal } from "lucide-react"
import Bento from "@/components/page/Bento";
import { PageShell, PageHero, Section, SectionHead, DarkBlock, CodeCard, StatTiles } from "@/components/page/primitives"
import { buttonVariants } from "@/lib/button-variants"
import { withBasePath } from "@/lib/base-path"
import { alternates, isLocale, localePath, LOCALES } from "@/lib/i18n/config"
import Image from "next/image";

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/developers">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};

  const isTr = lang === "tr";
  const title = isTr
    ? "Geliştirici Portalı — Better Payment"
    : "Developer Portal — Better Payment";
  const description = isTr
    ? "Tipli TypeScript API'leri, kapsamlı dokümantasyon, hızlı başlangıç rehberleri ve sandbox test ortamı."
    : "Typed TypeScript APIs, comprehensive documentation, quickstart guides and sandbox testing tools.";

  return {
    title,
    description,
    alternates: alternates("/developers", lang),
  };
}

export default async function DevelopersPage({ params }: PageProps<"/[lang]/developers">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const isTr = lang === "tr";

  const devHubCards = [
    {
      icon: BookOpen,
      title: isTr ? "Resmi Dokümantasyon" : "Official Documentation",
      desc: isTr
        ? "Tüm rehberler, kavramlar, güvenlik mimarisi ve adım adım kurulum yönergeleri."
        : "Complete guides, core concepts, security architecture, and step-by-step setup walkthroughs.",
      href: "/docs",
      badge: isTr ? "Önerilen" : "Primary",
      highlight: true,
    },
    {
      icon: Rocket,
      title: isTr ? "5 Dakikada Hızlı Başlangıç" : "5-Minute Quick Start",
      desc: isTr
        ? "Kurulumdan ilk başarılı test çekimine kadar en hızlı entegrasyon yolu."
        : "The fastest path from package install to your first verified test charge.",
      href: "/docs/quick-start",
      badge: "Get Started",
    },
    {
      icon: ShoppingBag,
      title: isTr ? "Çalıştırılabilir Örnekler & Mağaza" : "Runnable Examples & Store",
      desc: isTr
        ? "Next.js App Router ile hazırlanmış tam teşekküllü e-ticaret mağaza örneği ve kaynak kodları."
        : "Fully-functional Next.js App Router storefront app with checkout and webhook callbacks.",
      href: "/examples",
      badge: "Demos",
    },
    {
      icon: Code2,
      title: isTr ? "API & Tip Referansı" : "API & Type Reference",
      desc: isTr
        ? "Her fonksiyonun parametreleri, dönüş tipleri ve TypeScript interface'leri."
        : "Complete function signatures, return shapes, and exported TypeScript interfaces.",
      href: "/docs/reference/api",
      badge: "Reference",
    },
    {
      icon: FlaskConical,
      title: isTr ? "Sandbox Test Kartları" : "Sandbox Test Cards",
      desc: isTr
        ? "iyzico, PayTR ve banka sanal POS'ları için onaylanan ve hata simüle eden test kartları."
        : "Official success, decline, and error simulation card numbers across all providers.",
      href: "/docs/guides/test-cards",
      badge: "Testing",
    },
    {
      icon: Globe,
      title: isTr ? "Edge & Serverless Runtimes" : "Edge & Serverless Runtimes",
      desc: isTr
        ? "Vercel Edge, Cloudflare Workers, Bun ve Deno ile sıfır bağımlılıkla çalışma rehberi."
        : "Running Better Payment seamlessly on Cloudflare Workers, Vercel Edge, Bun, and Deno.",
      href: "/docs/integrations/edge",
      badge: "Runtimes",
    },
  ];

  const runtimes = [
    { name: "Node.js", logo: "node.svg" },
    { name: "Next.js", logo: "nextjs.svg" },
    { name: "Cloudflare Workers", logo: "cloudflare-workers.svg" },
    { name: "Bun", logo: "bun.svg" },
    { name: "Deno", logo: "deno.svg" },
    { name: "Express", logo: "express.svg" },
    { name: "Fastify", logo: "fastify.svg" },
    { name: "Hono", logo: "hono.svg" },
  ];

  return (
    <PageShell lang={lang}>
      <PageHero
        eyebrow={isTr ? "Geliştirici merkezi" : "Developer hub"}
        icon={Code2}
        title={isTr ? "Kurun, bağlayın, ilk ödemeyi alın." : "Install, connect, take your first payment."}
        lead={isTr
          ? "Tipli TypeScript API'leri, kapsamlı dokümantasyon, çalıştırılabilir örnekler ve sandbox test kartları: ilk başarılı test çekimine kadar gereken her şey."
          : "Typed TypeScript APIs, thorough docs, runnable examples and sandbox cards: everything between npm install and your first verified test charge."}
        actions={
          <>
            <Link href={localePath(lang, "/docs/quick-start")} className={buttonVariants({ size: "lg" })}>
              <Rocket />
              {isTr ? "Hızlı başlangıç" : "Quick start"}
            </Link>
            <Link href={localePath(lang, "/docs")} className={buttonVariants({ variant: "outline", size: "lg" })}>
              <BookOpen />
              {isTr ? "Dokümantasyon" : "Documentation"}
            </Link>
          </>
        }
        visual={
          <div className="panel-dark overflow-hidden rounded-card">
            <div className="flex items-center gap-2 border-b border-border px-6 py-4 font-mono text-meta text-muted-foreground">
              <Terminal className="size-3.5 text-accent-text" /> ~/my-shop
            </div>
            <div className="space-y-4 p-6 font-mono text-meta leading-code">
              <p><span className="text-accent-text">$</span> npm install better-payment</p>
              <p className="text-muted-foreground">+ better-payment@{VERSION} · 0 dependencies</p>
              <p><span className="text-accent-text">$</span> node charge.mjs</p>
              <p className="flex items-center gap-2 text-success"><Check className="size-3.5" /> status: &quot;success&quot; · provider: &quot;iyzico&quot;</p>
              <p className="text-muted-foreground">{isTr ? "ilk ödeme ~5 dakikada" : "first payment in ~5 minutes"}</p>
            </div>
          </div>
        }
      >
        <StatTiles items={[
          { label: isTr ? "Bağımlılık" : "Dependencies", value: "0" },
          { label: isTr ? "Tip güvenliği" : "Type coverage", value: "100%" },
          { label: isTr ? "Çalışma zamanı" : "Runtimes", value: "Node · Edge" },
          { label: isTr ? "Lisans" : "License", value: "MIT" },
        ]} />
      </PageHero>

      <Section className="pt-6">
        <SectionHead eyebrow={isTr ? "Kaynaklar" : "Resources"} title={isTr ? "Nereden başlamak istersiniz?" : "Where would you like to start?"} />
        <Bento items={devHubCards} hrefFor={(h) => localePath(lang, h)} cta={isTr ? "İnceleyin" : "Explore"} />
      </Section>

      <Section className="pt-0">
        <DarkBlock>
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <h2 className="text-title-lg sm:text-title-xl">{isTr ? "JavaScript nerede koşuyorsa, orada çalışır." : "Runs wherever JavaScript runs."}</h2>
              <p className="mt-4 text-body-lg leading-relaxed text-muted-foreground">
                {isTr
                  ? "Node.js'e özgü modüllere bağlı değil; standart Fetch ve Web Crypto ile tüm modern sunucusuz ortamlarda çalışır."
                  : "No Node-only builtins: standard Fetch and Web Crypto keep it portable across every modern serverless runtime."}
              </p>
              <div className="mt-8 grid grid-cols-4 gap-3">
                {runtimes.map((r) => (
                  <span key={r.name} title={r.name} className="grid aspect-square place-items-center rounded-2xl border border-border bg-logo p-3">
                    <Image src={withBasePath(`/brand/docs-logos/${r.logo}`)} alt={r.name} width={40} height={40} className="max-h-8 w-auto object-contain" />
                  </span>
                ))}
              </div>
            </div>
            <CodeCard
              filename="app/api/pay/route.ts"
              className="border border-border bg-background"
              code={`import { createPaymentHandler } from "better-payment/next"
import { paymentInstance } from "@/lib/payment"

export const { GET, POST } = createPaymentHandler({
  payment: paymentInstance,
  async onPaymentSuccess(result) {
    await db.orders.update({ id: result.orderId, status: "PAID" });
  },
});`}
            />
          </div>
        </DarkBlock>
      </Section>
    </PageShell>
  );
}
