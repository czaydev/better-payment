import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PostCard from "@/components/PostCard";
import SectionHeading from "@/components/SectionHeading";
import RevealOnScroll from "@/components/RevealOnScroll";
import { getPosts } from "@/lib/blog";
import { SITE_URL, alternates, isLocale, localePath } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";

export async function generateMetadata({ params }: PageProps<"/[lang]/blog">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = getDictionary(lang).blog;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates: {
      ...alternates("/blog", lang),
      types: { "application/rss+xml": `${SITE_URL}${localePath(lang, "/blog/rss.xml")}` },
    },
  };
}

export default async function BlogIndex({ params }: PageProps<"/[lang]/blog">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = getDictionary(lang).blog;
  const [featured, ...rest] = getPosts(lang);

  return (
    <section className="px-4 pt-14 pb-24 sm:px-6 md:px-4 md:pt-20 md:pb-28">
      <div className="mx-auto max-w-[97rem]">
        <SectionHeading line1={t.titleLine1} line2={t.titleLine2} lead={t.lead} />

        {!featured ? (
          <p className="text-muted-foreground">{t.empty}</p>
        ) : (
          <div className={`grid gap-4 md:grid-cols-2 ${rest.length >= 3 ? "lg:grid-cols-3" : ""}`}>
            <div className="md:col-span-2 lg:col-span-full">
              <PostCard post={featured} lang={lang} t={t} featured />
            </div>
            {rest.map((post) => (
              <PostCard key={post.url} post={post} lang={lang} t={t} />
            ))}
          </div>
        )}

        <p className="mt-10 text-sm">
          <a
            href={localePath(lang, "/blog/rss.xml")}
            className="font-medium text-accent-text underline-offset-4 hover:underline"
          >
            {t.rss}
          </a>
        </p>
      </div>
      <RevealOnScroll />
    </section>
  );
}
