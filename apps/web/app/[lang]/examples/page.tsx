import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowRight,
  CheckCircle2,
  Code2,
  ExternalLink,
  Layers,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Terminal,
} from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  buttonClass,
} from "@czayelements/zay-ui";
import { isLocale, localePath, alternates, LOCALES } from "@/lib/i18n/config";

type ExampleHighlight = {
  icon: typeof ShieldCheck;
  title: string;
  desc: string;
};

type UpcomingExample = {
  title: string;
  desc: string;
  tag: string;
};

type Content = {
  metaTitle: string;
  metaDesc: string;
  badge: string;
  title: string;
  lead: string;
  featured: string;
  shopTitle: string;
  shopDesc: string;
  viewGuide: string;
  viewGithub: string;
  techStack: string[];
  quickStartTitle: string;
  highlights: ExampleHighlight[];
  upcomingTitle: string;
  upcoming: UpcomingExample[];
};

const CONTENT: Record<string, Content> = {
  en: {
    metaTitle: "Examples — Better Payment",
    metaDesc:
      "Production-ready, runnable storefronts and application examples built with Better Payment.",
    badge: "Official Examples",
    title: "Better Payment Examples",
    lead: "Runnable, end-to-end storefronts and applications demonstrating Turkish payment providers, 3D Secure, verified callbacks and server-side safety in real-world frameworks.",
    featured: "Featured Example",
    shopTitle: "Next.js + Prisma Storefront",
    shopDesc:
      "A complete e-commerce shop with cookie cart, server-calculated totals, 3D Secure with verified callback redirection, payment event listeners, and an admin refund portal.",
    viewGuide: "Explore next-shop guide",
    viewGithub: "View on GitHub",
    techStack: ["Next.js App Router", "Prisma ORM", "SQLite", "3D Secure", "MockProvider", "Playwright"],
    quickStartTitle: "Run locally in 2 commands",
    highlights: [
      {
        icon: ShieldCheck,
        title: "Server-side Price Authority",
        desc: "The browser never sends payment amounts. The order total is freshly recalculated from the database on the server.",
      },
      {
        icon: Layers,
        title: "Unified 3D Secure Flow",
        desc: "The HTTP handler automatically verifies bank signatures, handles duplicate callbacks idempotently and redirects to the order status.",
      },
      {
        icon: Sparkles,
        title: "Zero-credential Testing",
        desc: "Runs instantly with MockProvider. Test successful payments, 3D failures, bank declines and timeouts using magic card numbers.",
      },
    ],
    upcomingTitle: "More examples in the repository",
    upcoming: [
      {
        title: "Express API & Webhook Service",
        desc: "Mount the Better Payment HTTP handler in an Express 4/5 backend with idempotency and webhook forwarding.",
        tag: "Backend",
      },
      {
        title: "React Router v7 / Remix",
        desc: "Serve payment actions and 3D Secure return endpoints directly from React Router resource routes.",
        tag: "Fullstack",
      },
      {
        title: "Cloudflare Workers Edge Checkout",
        desc: "Zero-cold-start payment gateway on the edge with toFetchHandler and KV / D1 storage.",
        tag: "Edge",
      },
    ],
  },
  tr: {
    metaTitle: "Örnekler — Better Payment",
    metaDesc:
      "Better Payment ile hazırlanmış çalıştırılabilir tam donanımlı mağaza ve uygulama örnekleri.",
    badge: "Resmi Örnekler",
    title: "Better Payment Örnekleri",
    lead: "Türk ödeme sağlayıcıları, 3D Secure akışı, doğrulanmış callback'ler ve sunucu tarafı tutar güvenliğini gerçek dünya framework'lerinde gösteren çalıştırılabilir uçtan uca uygulamalar.",
    featured: "Öne Çıkan Örnek",
    shopTitle: "Next.js + Prisma Örnek Mağazası",
    shopDesc:
      "Çerez sepeti, sunucu tarafında hesaplanan tutarlar, doğrulanmış callback yönlendirmesiyle 3D Secure, ödeme olay dinleyicileri ve yönetici iade panelini içeren tam teşekküllü e-ticaret mağazası.",
    viewGuide: "next-shop rehberini incele",
    viewGithub: "GitHub'da incele",
    techStack: ["Next.js App Router", "Prisma ORM", "SQLite", "3D Secure", "MockProvider", "Playwright"],
    quickStartTitle: "2 komutla yerelde çalıştırın",
    highlights: [
      {
        icon: ShieldCheck,
        title: "Sunucu Tarafı Fiyat Güvencesi",
        desc: "Tarayıcı istemcisi asla ödeme tutarı göndermez. Sipariş tutarı veritabanındaki ürün fiyatlarından sunucuda baştan toplanır.",
      },
      {
        icon: Layers,
        title: "Birleşik 3D Secure Akışı",
        desc: "HTTP handler banka imzalarını otomatik doğrular, mükerrer callback'leri engeller ve tarayıcıyı sipariş sonucuna yönlendirir.",
      },
      {
        icon: Sparkles,
        title: "Kimlik Bilgisiz Test Modu",
        desc: "MockProvider ile API anahtarı gerekmeden anında çalışır. Sihirli test kartlarıyla başarılı ödeme, 3D hatası ve banka reddi simüle edilir.",
      },
    ],
    upcomingTitle: "Depodaki diğer örnekler",
    upcoming: [
      {
        title: "Express API & Webhook Servisi",
        desc: "Better Payment HTTP handler'ını Express 4/5 arka yüzüne bağlayarak webhook yönlendirmesi ve idempotency sağlayın.",
        tag: "Backend",
      },
      {
        title: "React Router v7 / Remix",
        desc: "Ödeme eylemleri ve 3D Secure dönüş rotalarını doğrudan React Router resource route'ları üzerinden sunun.",
        tag: "Fullstack",
      },
      {
        title: "Cloudflare Workers Edge Ödeme",
        desc: "toFetchHandler ve KV / D1 depolama ile sıfır soğuk başlangıçlı edge ödeme ağ geçidi.",
        tag: "Edge",
      },
    ],
  },
};

export default async function ExamplesPage({ params }: PageProps<"/[lang]/examples">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const c = CONTENT[lang] ?? CONTENT.en;

  return (
    <div className="mx-auto w-full max-w-5xl py-8">
      {/* Header */}
      <div className="mb-10 space-y-3">
        <Badge variant="brand" className="mb-2">
          {c.badge}
        </Badge>
        <h1 className="text-title-lg text-foreground sm:text-title-xl">
          {c.title}
        </h1>
        <p className="max-w-3xl text-base text-muted-foreground sm:text-lg">
          {c.lead}
        </p>
      </div>

      {/* Featured Example Card */}
      <div className="mb-12 overflow-hidden rounded-card border border-border bg-card p-7 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <ShoppingBag className="size-5" />
            </div>
            <div>
              <span className="text-caption font-medium text-accent-text">
                {c.featured}
              </span>
              <h2 className="text-title-md text-foreground">
                {c.shopTitle}
              </h2>
            </div>
          </div>
          <Badge variant="solid" className="font-mono text-xs">
            examples/next-shop
          </Badge>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {c.shopDesc}
        </p>

        {/* Tech stack pills */}
        <div className="mt-5 flex flex-wrap gap-2">
          {c.techStack.map((tech) => (
            <Badge key={tech} variant="secondary" className="text-xs">
              {tech}
            </Badge>
          ))}
        </div>

        {/* Quickstart snippet */}
        <div className="mt-6 panel-dark rounded-2xl border border-border p-4 font-mono text-xs">
          <div className="mb-2 flex items-center justify-between text-muted-foreground">
            <span className="flex items-center gap-2">
              <Terminal className="size-3.5" />
              {c.quickStartTitle}
            </span>
          </div>
          <pre className="overflow-x-auto text-success">
            <code>{`corepack pnpm@10.33.0 install\ncorepack pnpm@10.33.0 --filter next-shop dev`}</code>
          </pre>
        </div>

        {/* CTAs */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href={localePath(lang, "/examples/next-shop")}
            className={buttonClass({ variant: "primary", size: "md" })}
          >
            {c.viewGuide}
            <ArrowRight className="ml-1.5 size-4" />
          </Link>
          <a
            href="https://github.com/czaydev/better-payment/tree/beta/examples/next-shop"
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass({ variant: "outline", size: "md" })}
          >
            <Code2 className="mr-1.5 size-4" />
            {c.viewGithub}
            <ExternalLink className="ml-1 size-3.5 text-muted-foreground" />
          </a>
        </div>
      </div>

      {/* Highlights Grid */}
      <div className="mb-14">
        <h3 className="mb-6 text-title-md text-foreground">
          {lang === "tr" ? "Neden bu mimari?" : "Architectural Highlights"}
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {c.highlights.map((h) => {
            const Icon = h.icon;
            return (
              <Card key={h.title} padding="md" className="rounded-card border-border p-6">
                <CardHeader>
                  <div className="mb-3 flex size-8 items-center justify-center rounded-lg bg-tint text-accent-text">
                    <Icon className="size-4" />
                  </div>
                  <CardTitle className="text-base font-semibold">{h.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs leading-relaxed text-muted-foreground">{h.desc}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Other Examples Section */}
      <div>
        <h3 className="mb-6 text-title-md text-foreground">{c.upcomingTitle}</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {c.upcoming.map((item) => (
            <Card key={item.title} padding="md" className="rounded-card border-border p-6">
              <CardHeader>
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {item.tag}
                  </Badge>
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CheckCircle2 className="size-3 text-emerald-500" />
                    Available
                  </span>
                </div>
                <CardTitle className="text-sm font-semibold">{item.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/examples">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const c = CONTENT[lang] ?? CONTENT.en;

  return {
    title: c.metaTitle,
    description: c.metaDesc,
    alternates: alternates("/examples", lang),
  };
}
