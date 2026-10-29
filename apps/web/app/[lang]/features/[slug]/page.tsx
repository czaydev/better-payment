import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, BookOpen, Check, ShoppingBag, X } from "lucide-react";
import { PageShell, PageHero, Section, SectionHead, Card, CodeCard, ProofBlock, LinkCard, ArrowChip } from "@/components/page/primitives";
import { FeatureVisual } from "@/components/page/feature-visuals";
import { buttonVariants } from "@/lib/button-variants";
import { FEATURES_DATA, FEATURE_SLUGS, loc, type FeatureSlug } from "@/lib/features-data";
import { alternates, isLocale, localePath, LOCALES } from "@/lib/i18n/config";

export function generateStaticParams() {
  return LOCALES.flatMap((lang) => FEATURE_SLUGS.map((slug) => ({ lang, slug })));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/features/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) return {};
  const feature = FEATURES_DATA[slug as FeatureSlug];
  if (!feature) return {};
  return {
    title: `${loc(feature.title, lang)} — Better Payment`,
    description: loc(feature.description, lang),
    alternates: alternates(`/features/${slug}`, lang),
  };
}

export default async function FeatureDetailPage({ params }: PageProps<"/[lang]/features/[slug]">) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();
  const feature = FEATURES_DATA[slug as FeatureSlug];
  if (!feature) notFound();
  const isTr = lang === "tr";
  const others = FEATURE_SLUGS.filter((s) => s !== slug);
  const next = FEATURE_SLUGS[(FEATURE_SLUGS.indexOf(feature.slug) + 1) % FEATURE_SLUGS.length];

  return (
    <PageShell lang={lang}>
      <PageHero
        title={loc(feature.headline, lang)}
        lead={loc(feature.description, lang)}
        actions={
          <>
            <Link href={localePath(lang, feature.docsHref)} className={buttonVariants({ size: "lg" })}>
              <BookOpen />
              {loc(feature.docsLabel, lang)}
            </Link>
            <Link href={localePath(lang, "/examples")} className={buttonVariants({ variant: "outline", size: "lg" })}>
              <ShoppingBag />
              {isTr ? "Örnek projeyi incele" : "Explore the example store"}
            </Link>
          </>
        }
        visual={<FeatureVisual slug={feature.slug} lang={lang} />}
      />

      <Section className="pt-6">
        <SectionHead
          eyebrow={isTr ? "Avantajlar" : "Why it matters"}
          icon={Check}
          title={isTr ? "Bu özellik neden işinize yarar?" : "Why this earns its place in your stack"}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {feature.benefits.map((b, i) => (
            <Card key={i} className="flex gap-5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint text-meta font-medium text-accent-text">{i + 1}</span>
              <div>
                <h3 className="text-title-sm text-foreground">{loc(b.title, lang)}</h3>
                <p className="mt-2 text-body leading-relaxed text-muted-foreground">{loc(b.desc, lang)}</p>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section className="pt-0">
        <ProofBlock>
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <h2 className="text-title-lg text-foreground sm:text-title-xl">
                {isTr ? "Basit, anlaşılır ve doğrudan." : "Simple, readable, direct."}
              </h2>
              <div className="mt-8 space-y-3">
                <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
                      <X className="size-4" aria-hidden />
                    </span>
                    <p className="text-caption font-medium text-foreground">{isTr ? "Better Payment olmadan" : "Without Better Payment"}</p>
                  </div>
                  <p className="mt-1.5 text-body text-muted-foreground">{loc(feature.comparison.without, lang)}</p>
                </div>
                <div className="rounded-2xl border border-primary/25 bg-card p-5 shadow-sm ring-1 ring-primary/5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                      <Check className="size-4" aria-hidden />
                    </span>
                    <p className="text-caption font-medium text-foreground">{isTr ? "Better Payment ile" : "With Better Payment"}</p>
                  </div>
                  <p className="mt-1.5 text-body text-foreground">{loc(feature.comparison.with, lang)}</p>
                </div>
              </div>
            </div>
            <CodeCard filename={feature.codeFilename} code={feature.codeSnippet} />
          </div>
        </ProofBlock>
      </Section>

      <Section className="pt-0">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 className="text-title-md text-foreground">{isTr ? "Diğer özellikler" : "More features"}</h2>
          <Link href={localePath(lang, `/features/${next}`)} className={buttonVariants({ variant: "outline", size: "sm", pill: true })}>
            {isTr ? "Sıradaki" : "Next"} <ArrowRight data-icon="chevron" />
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {others.slice(0, 3).map((s) => {
            const f = FEATURES_DATA[s];
            const FIcon = f.icon;
            return (
              <LinkCard key={s} href={localePath(lang, `/features/${s}`)} className="gap-10">
                <div className="flex items-start justify-between">
                  <span className="grid size-11 place-items-center rounded-2xl bg-tint text-accent-text"><FIcon className="size-5" /></span>
                  <ArrowChip />
                </div>
                <p className="text-title-sm text-foreground">{loc(f.title, lang)}</p>
              </LinkCard>
            );
          })}
        </div>
      </Section>
    </PageShell>
  );
}
