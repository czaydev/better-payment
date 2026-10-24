import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { blogSource, postSlug } from "@/lib/blog";
import { DEFAULT_LOCALE, LOCALES, SITE_URL, localePath, type Locale } from "@/lib/i18n/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const url = (lang: Locale, path: string) => `${SITE_URL}${localePath(lang, path)}`;
  const languages = (path: string) => ({
    ...Object.fromEntries(LOCALES.map((code) => [code, url(code, path)])),
    "x-default": url(DEFAULT_LOCALE, path),
  });
  const entry = (path: string, lastModified?: Date) =>
    LOCALES.map((lang) => ({
      url: url(lang, path),
      ...(lastModified && { lastModified }),
      alternates: { languages: languages(path) },
    }));

  const posts = blogSource.getPages(DEFAULT_LOCALE);
  const latest = posts.reduce<Date | undefined>(
    (date, post) => (!date || post.data.date > date ? post.data.date : date),
    undefined
  );

  return [
    ...["/", ...source.getPages(DEFAULT_LOCALE).map((page) => page.url)].flatMap((path) => entry(path)),
    ...entry("/blog", latest),
    ...posts.flatMap((post) => entry(`/blog/${postSlug(post)}`, post.data.updated ?? post.data.date)),
  ];
}
