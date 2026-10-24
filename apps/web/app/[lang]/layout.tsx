import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import "../globals.css";
import SiteProvider from "@/components/SiteProvider";
import { LOCALES, SITE_URL, alternates, isLocale, isRtl, openGraphLocale, socialImageFile } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";
import { i18nUI } from "@/lib/i18n/ui";
import { Analytics } from "@vercel/analytics/next";
import { IS_BETA_DOCS, withBasePath } from "@/lib/base-path";

// Brand typography: Manrope for display and headings, Inter for text, JetBrains Mono for code
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin", "latin-ext"],
});

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const t = getDictionary(lang);
  const socialImage = {
    url: new URL(withBasePath(`/brand/social/${socialImageFile(lang)}`), SITE_URL),
    width: 1200,
    height: 630,
    alt: t.meta.socialImageAlt,
  };

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t.meta.title, template: `%s · Better Payment` },
    description: t.meta.description,
    keywords: ["payment gateway", "ödeme", "iyzico", "paytr", "parampos", "akbank", "sanal pos", "nodejs", "typescript", "npm"],
    alternates: alternates("/", lang),
    openGraph: {
      type: "website",
      locale: openGraphLocale(lang),
      siteName: "Better Payment",
      title: t.meta.title,
      description: t.meta.description,
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title: t.meta.title,
      description: t.meta.description,
      images: [socialImage],
    },
    // The beta docs repeat the stable pages; only the stable ones are indexed
    ...(IS_BETA_DOCS && { robots: { index: false, follow: true } }),
  };
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = getDictionary(lang);

  return (
    <html
      lang={lang}
      // Text direction comes from the registry (locales.json `dir`); mirroring the layouts for RTL is a follow-up
      dir={isRtl(lang) ? "rtl" : "ltr"}
      className={`${manrope.variable} ${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <a
          href="#main-content"
          className="fixed top-4 left-4 z-100 -translate-y-[calc(100%+2rem)] rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-lg transition-transform focus:translate-y-0 focus:outline-2 focus:outline-offset-2 focus:outline-primary"
        >
          {t.accessibility.skipToContent}
        </a>
        <SiteProvider i18n={i18nUI.provider(lang)}>{children}</SiteProvider>
        <Analytics />
      </body>
    </html>
  );
}
