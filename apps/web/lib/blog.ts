import { blog } from "@/.source/server";
import { loader } from "fumadocs-core/source";
import { toFumadocsSource } from "fumadocs-mdx/runtime/server";
import { i18n, type Locale } from "@/lib/i18n/config";

export const blogSource = loader({
  baseUrl: "/blog",
  i18n,
  source: toFumadocsSource(blog, []),
});

export type BlogPost = NonNullable<ReturnType<typeof blogSource.getPage>>;

/** Posts of a language, newest first */
export function getPosts(lang: Locale): BlogPost[] {
  return blogSource.getPages(lang).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function getPost(slug: string, lang: Locale): BlogPost | undefined {
  return blogSource.getPage([slug], lang);
}

export function postSlug(post: BlogPost): string {
  return post.slugs[0];
}

/** Rough reading time from the post's indexed text, 200 words a minute */
export function readingMinutes(post: BlogPost): number {
  const text = (post.data.structuredData?.contents ?? []).map((part) => part.content).join(" ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function formatDate(date: Date, lang: Locale): string {
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
