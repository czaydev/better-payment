import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import "../globals.css";
import SiteProvider from "@/components/SiteProvider";
import { LOCALES, SITE_URL, alternates, isLocale } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";
import { i18nUI } from "@/lib/i18n/ui";
import { Analytics } from "@vercel/analytics/next";

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
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t.meta.title, template: `%s · Better Payment` },
    description: t.meta.description,
    keywords: ["payment gateway", "ödeme", "iyzico", "paytr", "parampos", "akbank", "sanal pos", "nodejs", "typescript", "npm"],
    alternates: alternates("/", lang),
    openGraph: { locale: lang === "tr" ? "tr_TR" : "en_US", siteName: "Better Payment" },
  };
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <html
      lang={lang}
      className={`${manrope.variable} ${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <SiteProvider i18n={i18nUI.provider(lang)}>{children}</SiteProvider>
        <Analytics />
      </body>
    </html>
  );
}
