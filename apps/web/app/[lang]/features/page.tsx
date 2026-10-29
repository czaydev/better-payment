import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { PageShell, PageHero, Section, LinkCard, ArrowChip } from "@/components/page/primitives";
import { FEATURES_DATA, loc } from "@/lib/features-data";
import { alternates, isLocale, localePath, LOCALES } from "@/lib/i18n/config";

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/features">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const isTr = lang === "tr";
  return {
    title: isTr ? "Tüm Platform Özellikleri — Better Payment" : "All Platform Features — Better Payment",
    description: isTr
      ? "Better Payment'ın 10 temel ödeme mimarisi özelliğini inceleyin."
      : "Explore the 10 core payment architecture features of Better Payment.",
    alternates: alternates("/features", lang),
  };
}

export default async function FeaturesIndexPage({ params }: PageProps<"/[lang]/features">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const isTr = lang === "tr";
  const groups = [
    { title: isTr ? "Ödeme" : "Payments", slugs: ["unified", "basket", "pre-auth", "stored-cards"] as const },
    { title: isTr ? "Güvenlik" : "Security", slugs: ["handler", "events", "error-codes"] as const },
    { title: isTr ? "Genişletme" : "Extend", slugs: ["plugins", "custom-providers", "testing"] as const },
  ];

  return (
    <PageShell lang={lang}>
      <PageHero
        eyebrow={isTr ? "Özellikler" : "Features"}
        icon={Sparkles}
        title={isTr ? "Platformun sunduğu tüm yetenekler." : "Every capability of the platform."}
        lead={isTr
          ? "Her özelliğin mimarisini, avantajlarını ve gerçek kod örneğini keşfedin."
          : "Dive into the architecture, benefits and real code of each feature."}
      />
      <Section className="pt-6">
        <div className="space-y-12">
          {groups.map((g) => (
            <div key={g.title}>
              <h2 className="mb-5 px-1 text-title-md text-foreground">{g.title}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {g.slugs.map((s) => {
                  const f = FEATURES_DATA[s];
                  const Icon = f.icon;
                  return (
                    <LinkCard key={s} href={localePath(lang, `/features/${s}`)} className="min-h-60 justify-between gap-8">
                      <div className="flex items-start justify-between">
                        <span className="grid size-12 place-items-center rounded-2xl bg-tint text-accent-text"><Icon className="size-5" /></span>
                        <ArrowChip />
                      </div>
                      <div>
                        <h3 className="text-title-sm text-foreground">{loc(f.title, lang)}</h3>
                        <p className="mt-2 line-clamp-3 text-body-sm leading-relaxed text-muted-foreground">{loc(f.description, lang)}</p>
                      </div>
                    </LinkCard>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </PageShell>
  );
}
