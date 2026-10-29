import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation"
import { VERSION } from "better-payment"
import { BookOpen, Clock, Package, PenTool, Plus, Route, ShoppingBag } from "lucide-react"
import { GitHubIcon } from "@/components/icons"
import Bento from "@/components/page/Bento";
import { PageShell, PageHero, Section, SectionHead } from "@/components/page/primitives"
import { buttonVariants } from "@/lib/button-variants"
import { GITHUB_URL } from "@/lib/nav-menu"
import { alternates, isLocale, localePath, LOCALES } from "@/lib/i18n/config"

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/resources">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};

  const isTr = lang === "tr";
  const title = isTr
    ? "Kaynaklar ve Ekosistem — Better Payment"
    : "Resources & Ecosystem — Better Payment";
  const description = isTr
    ? "Sürüm notları, geçiş rehberleri, teknik blog, GitHub topluluğu ve sıkça sorulan sorular."
    : "Release notes, migration guides, technical blog, GitHub community, and FAQ.";

  return {
    title,
    description,
    alternates: alternates("/resources", lang),
  };
}

export default async function ResourcesPage({ params }: PageProps<"/[lang]/resources">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const isTr = lang === "tr";

  const resources = [
    {
      icon: PenTool,
      title: isTr ? "Mühendislik Blogu" : "Engineering Blog",
      desc: isTr
        ? "3D Secure akışları, sanal POS entegrasyonları ve ödeme mimarileri hakkında derinlemesine makaleler."
        : "In-depth technical articles on 3D Secure workflows, virtual POS architecture, and performance.",
      href: "/blog",
      badge: "Blog",
    },
    {
      icon: Clock,
      title: isTr ? "Değişiklik Günlüğü" : "Changelog & Releases",
      desc: isTr
        ? "Yayınlanan her Better Payment sürümünün notları, yeni eklenen bankalar ve hata düzeltmeleri."
        : "Detailed release logs, newly added banks, breaking changes, and bug fixes for every version.",
      href: "/docs/reference/changelog",
      badge: "Releases",
    },
    {
      icon: Route,
      title: isTr ? "Sürüm Geçiş Rehberleri" : "Migration Guides",
      desc: isTr
        ? "Resmi sağlayıcı kütüphanelerinden veya önceki sürümlerden sıfır kesintiyle Better Payment'a geçiş adımları."
        : "Step-by-step walkthroughs to migrate from official provider packages or older SDK versions.",
      href: "/docs/guides/migration-0-5",
      badge: "Guides",
    },
    {
      icon: ShoppingBag,
      title: isTr ? "Örnek Uygulamalar & Mağaza" : "Example Storefronts",
      desc: isTr
        ? "Next.js App Router ile hazırlanmış tam fonksiyonel e-ticaret sepet ve ödeme akışı demosı."
        : "Fully functional open-source Next.js e-commerce demo with cart, checkout, and webhook handlers.",
      href: "/examples",
      badge: "Examples",
    },
    {
      icon: GitHubIcon,
      title: isTr ? "GitHub Açık Kaynak Topluluğu" : "GitHub Open Source Community",
      desc: isTr
        ? "Kaynak kodlarını inceleyin, hata bildirin, tartışmalara katılın veya projeye katkıda bulunun."
        : "Inspect source code, report issues, join discussions, or contribute features directly on GitHub.",
      href: GITHUB_URL,
      badge: "Open Source",
      external: true,
    },
    {
      icon: Package,
      title: isTr ? "npm Paketi & Dağıtımlar" : "npm Package & Registry",
      desc: isTr
        ? "Resmi npm kayıt defterindeki haftalık indirmeler, sürüm etiketleri ve paket sağlığı."
        : "Official npm registry releases, release tags, bundle size inspections, and package health.",
      href: "https://www.npmjs.com/package/better-payment",
      badge: "npm",
      external: true,
    },
  ];

  const faqs = [
    {
      q: isTr
        ? "Better Payment kullanırken PCI-DSS sertifikasyonuna ihtiyacım var mı?"
        : "Do I need PCI-DSS certification to use Better Payment?",
      a: isTr
        ? "Hayır. Better Payment, 3D Secure ve tokenization akışlarıyla çalışacak şekilde tasarlanmıştır. Müşterilerinizin hassas kart verileri asla sunucunuzda saklanmaz veya loglanmaz."
        : "No. Better Payment is engineered around 3D Secure and tokenization workflows. Sensitive primary account numbers (PAN) are never stored or logged on your application servers.",
    },
    {
      q: isTr
        ? "Aynı anda birden fazla banka ve ödeme kuruluşunu kullanabilir miyim?"
        : "Can I connect multiple gateways and banks at the same time?",
      a: isTr
        ? "Evet! Better Payment çoklu sağlayıcı (multi-provider) mimarisine sahiptir. Tek bir instance içerisinde hem iyzico hem PayTR hem de Akbank sanal POS'unu aynı anda aktif edebilirsiniz."
        : "Yes! Better Payment features a multi-provider orchestrator. You can configure iyzico, PayTR, and bank virtual POS gateways simultaneously in a single client instance.",
    },
    {
      q: isTr
        ? "Taksit ve komisyon oranları nasıl sorgulanır?"
        : "How are installment rates and commissions queried?",
      a: isTr
        ? "Better Payment'ın payment.getInstallments(...) fonksiyonu ile müşterinizin kart BIN numarasına veya sağlayıcıya göre geçerli taksit tablosunu tek bir standart formatta alabilirsiniz."
        : "Using payment.getInstallments(...), you can retrieve active installment matrices by card BIN or gateway in one unified normalized shape.",
    },
    {
      q: isTr
        ? "Cloudflare Workers ve Vercel Edge'de çalışır mı?"
        : "Does it work in Cloudflare Workers and Vercel Edge?",
      a: isTr
        ? "Evet. Better Payment sıfır çalışma zamanı bağımlılığına (zero dependencies) sahiptir ve standart Web Fetch API ile Web Crypto API üzerine inşa edilmiştir. Edge runtimes, Bun ve Deno ile %100 uyumludur."
        : "Yes. With zero runtime dependencies, Better Payment relies purely on standard Web Fetch and Web Crypto APIs, making it 100% compatible with Edge runtimes, Bun, and Deno.",
    },
  ];

  const feed = [
    { label: `v${VERSION}`, note: isTr ? "Değişiklik günlüğü" : "Changelog", href: "/docs/reference/changelog", tag: "latest" },
    { label: isTr ? "Mühendislik blogu" : "Engineering blog", note: "3D Secure · sanal POS", href: "/blog", tag: "blog" },
    { label: isTr ? "0.5 geçiş rehberi" : "0.5 migration guide", note: isTr ? "adım adım" : "step by step", href: "/docs/guides/migration-0-5", tag: "guide" },
  ];

  return (
    <PageShell lang={lang}>
      <PageHero
        eyebrow={isTr ? "Kaynaklar" : "Resources"}
        icon={BookOpen}
        title={isTr ? "Yayınlardan topluluğa, hepsi tek yerde." : "From releases to community, all in one place."}
        lead={isTr
          ? "Sürüm notları, blog yazıları, geçiş rehberleri ve açık kaynak topluluğu: Better Payment'ı takip etmenin ve katkı vermenin yolları."
          : "Release notes, blog posts, migration guides and the open-source community: every way to follow Better Payment and contribute."}
        actions={
          <>
            <Link href={localePath(lang, "/blog")} className={buttonVariants({ size: "lg" })}>
              <PenTool />
              {isTr ? "Blogu okuyun" : "Read the blog"}
            </Link>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "lg" })}>
              <GitHubIcon />
              GitHub
            </a>
          </>
        }
        visual={
          <div className="rounded-card border border-border bg-card p-3">
            <p className="px-4 pt-2 pb-3 text-caption font-medium text-muted-foreground">{isTr ? "Son gelişmeler" : "Latest"}</p>
            <ul className="space-y-2 rounded-[26px] border border-border bg-surface p-3">
              {feed.map((f) => (
                <li key={f.label}>
                  <Link href={localePath(lang, f.href)} className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-line-strong">
                    <span>
                      <span className="block text-body font-semibold text-foreground">{f.label}</span>
                      <span className="text-caption text-muted-foreground">{f.note}</span>
                    </span>
                    <span className="rounded-badge bg-tint px-2.5 py-1 text-caption text-accent-text">{f.tag}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        }
      />

      <Section className="pt-6">
        <SectionHead eyebrow={isTr ? "Keşfedin" : "Explore"} title={isTr ? "Her şey burada." : "Everything in one place."} />
        <Bento items={resources} hrefFor={(h) => localePath(lang, h)} cta={isTr ? "Aç" : "Open"} />
      </Section>

      <Section className="pt-0">
        <SectionHead eyebrow="SSS" title={isTr ? "Sık sorulan sorular" : "Frequently asked questions"} />
        <div className="grid gap-3 lg:grid-cols-2">
          {faqs.map((f) => (
            <details key={f.q} className="group rounded-card border border-border bg-card px-7 py-5 open:border-line-strong">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-body font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-transform group-open:rotate-45">
                  <Plus className="size-4" />
                </span>
              </summary>
              <p className="mt-3 text-body leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>
    </PageShell>
  );
}
