import { getPosts, postSlug } from "@/lib/blog";
import { resolveAuthors } from "@/lib/authors";
import { LOCALES, SITE_URL, isLocale, localePath } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/dictionary";

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export async function GET(_request: Request, ctx: RouteContext<"/[lang]/blog/rss.xml">) {
  const { lang } = await ctx.params;
  if (!isLocale(lang)) return new Response("Not found", { status: 404 });
  const t = getDictionary(lang);
  const posts = getPosts(lang);
  const feedUrl = `${SITE_URL}${localePath(lang, "/blog/rss.xml")}`;

  const items = posts
    .map((post) => {
      const link = `${SITE_URL}${localePath(lang, `/blog/${postSlug(post)}`)}`;
      return `    <item>
      <title>${escape(post.data.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${post.data.date.toUTCString()}</pubDate>
      <description>${escape(post.data.description ?? "")}</description>
      <dc:creator>${escape(resolveAuthors(post.data.authors).map((author) => author.name).join(", ") || "Better Payment")}</dc:creator>
${post.data.tags.map((tag) => `      <category>${escape(tag)}</category>`).join("\n")}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Better Payment ${escape(t.blog.metaTitle)}</title>
    <link>${SITE_URL}${localePath(lang, "/blog")}</link>
    <description>${escape(t.blog.metaDescription)}</description>
    <language>${lang}</language>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}
