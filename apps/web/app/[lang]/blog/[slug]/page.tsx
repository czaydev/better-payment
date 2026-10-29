import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import defaultMdxComponents from "fumadocs-ui/mdx";
import PostCard from "@/components/PostCard";
import RevealOnScroll from "@/components/RevealOnScroll";
import { buttonVariants } from "@/lib/button-variants";
import { GitHubIcon } from "@/components/icons";
import { formatDate, getPost, getPosts, postSlug, readingMinutes } from "@/lib/blog";
import { LOCALES, SITE_URL, alternates, isLocale, localePath, openGraphLocale, socialImageFile } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getMDXComponents } from "@/lib/mdx-components";
import AuthorAvatars from "@/components/AuthorAvatars";
import { authorsJsonLd, resolveAuthors } from "@/lib/authors";

const REPOSITORY = "https://github.com/czaydev/better-payment";

export function generateStaticParams() {
  return LOCALES.flatMap((lang) => getPosts(lang).map((post) => ({ lang, slug: postSlug(post) })));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/blog/[slug]">): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();
  const post = getPost(slug, lang);
  if (!post) notFound();
  const t = getDictionary(lang);
  const socialImage = {
    url: new URL(`/brand/social/${socialImageFile(lang)}`, SITE_URL),
    width: 1200,
    height: 630,
    alt: t.meta.socialImageAlt,
  };

  return {
    title: post.data.title,
    description: post.data.description,
    alternates: alternates(`/blog/${slug}`, lang),
    authors: resolveAuthors(post.data.authors).map(({ name, url }) => ({ name, url })),
    keywords: post.data.tags,
    openGraph: {
      type: "article",
      locale: openGraphLocale(lang),
      siteName: "Better Payment",
      title: post.data.title,
      description: post.data.description,
      publishedTime: post.data.date.toISOString(),
      modifiedTime: (post.data.updated ?? post.data.date).toISOString(),
      authors: resolveAuthors(post.data.authors).map((author) => author.url),
      tags: post.data.tags,
      images: [socialImage],
    },
    twitter: { card: "summary_large_image", title: post.data.title, description: post.data.description, images: [socialImage] },
  };
}

export default async function BlogPostPage({ params }: PageProps<"/[lang]/blog/[slug]">) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();
  const post = getPost(slug, lang);
  if (!post) notFound();
  const t = getDictionary(lang).blog;
  const MDX = post.data.body;
  const postAuthors = resolveAuthors(post.data.authors);
  const related = getPosts(lang)
    .filter((other) => postSlug(other) !== slug)
    .slice(0, 2);

  const url = `${SITE_URL}${localePath(lang, `/blog/${slug}`)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.data.title,
    description: post.data.description,
    datePublished: post.data.date.toISOString(),
    dateModified: (post.data.updated ?? post.data.date).toISOString(),
    inLanguage: lang,
    author: authorsJsonLd(postAuthors),
    publisher: { "@type": "Organization", name: "Better Payment", url: SITE_URL },
    mainEntityOfPage: url,
    keywords: post.data.tags.join(", "),
  };

  return (
    <article className="px-4 pt-14 pb-24 sm:px-6 md:px-4 md:pt-20 md:pb-28">
      <script
        type="application/ld+json"
        // JSON-LD is static data built from the post's frontmatter
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <div className="mx-auto max-w-[97rem]">
        <Link
          href={localePath(lang, "/blog")}
          className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t.allPosts}
        </Link>

        <ul className="mb-4 flex flex-wrap gap-1.5">
          {post.data.tags.map((tag) => (
            <li key={tag} className="rounded-full bg-tint px-2.5 py-0.5 font-mono text-label font-medium text-accent-text">
              {tag}
            </li>
          ))}
        </ul>
        <h1 className="max-w-4xl text-title-lg text-foreground sm:text-display-md">
          {post.data.title}
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-muted-foreground">{post.data.description}</p>

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border pb-8 text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <AuthorAvatars authors={postAuthors} size={40} />
            <p className="leading-snug">
              <span className="block text-xs">{t.by}</span>
              {postAuthors.map((author, i) => (
                <span key={author.login}>
                  {i > 0 && ", "}
                  <a
                    href={author.url}
                    target="_blank"
                    rel="noopener noreferrer author"
                    className="font-semibold text-foreground underline-offset-4 hover:underline"
                  >
                    {author.name}
                  </a>
                </span>
              ))}
            </p>
          </div>
          <span aria-hidden className="hidden h-8 w-px bg-border sm:block" />
          <p className="flex flex-wrap items-center gap-x-2">
            <time dateTime={post.data.date.toISOString()}>{formatDate(post.data.date, lang)}</time>
            <span aria-hidden>·</span>
            <span>
              {readingMinutes(post)} {t.minutes}
            </span>
            {post.data.updated && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {t.updated} <time dateTime={post.data.updated.toISOString()}>{formatDate(post.data.updated, lang)}</time>
                </span>
              </>
            )}
          </p>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-16">
          <div className="min-w-0">
            <div className="prose max-w-3xl">
              <MDX components={getMDXComponents(defaultMdxComponents, lang)} />
            </div>

            <aside className="mt-16 max-w-3xl rounded-2xl border border-border bg-tint/60 p-8">
              <h2 className="text-xl font-bold tracking-title text-foreground">{t.cta.title}</h2>
              <p className="mt-2 text-muted-foreground">{t.cta.lead}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href={localePath(lang, "/docs")} className={buttonVariants({ size: "sm" })}>
                  {t.cta.docs}
                </Link>
                <a href={REPOSITORY} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <GitHubIcon data-icon="brand" />
                  {t.cta.github}
                </a>
              </div>
            </aside>
          </div>

          {post.data.toc.length > 0 && (
            <nav aria-label={t.toc} className="hidden lg:block">
              <div className="sticky top-24">
                <p className="mb-3 text-xs font-semibold tracking-eyebrow text-muted-foreground uppercase">{t.toc}</p>
                <ul className="grid gap-0.5 border-l border-border">
                  {post.data.toc.map((item) => (
                    <li key={item.url}>
                      <a
                        href={item.url}
                        className="-ml-px block border-l border-transparent py-1.5 text-body-sm leading-snug text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                        style={{ paddingLeft: `${0.875 + (item.depth - 2) * 0.75}rem` }}
                      >
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <div className="mx-auto mt-24 max-w-[97rem]">
          <h2 className="mb-6 text-2xl font-bold tracking-title text-foreground">{t.moreTitle}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {related.map((other) => (
              <PostCard key={other.url} post={other} lang={lang} t={t} />
            ))}
          </div>
        </div>
      )}
      <RevealOnScroll />
    </article>
  );
}
