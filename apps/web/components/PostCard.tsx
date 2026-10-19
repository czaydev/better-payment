import Link from "next/link";
import { ArrowRight } from "lucide-react";
import AuthorAvatars from "@/components/AuthorAvatars";
import { formatDate, postSlug, readingMinutes, type BlogPost } from "@/lib/blog";
import { resolveAuthors } from "@/lib/authors";
import { localePath, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { cn } from "@/lib/utils";

/** A blog post teaser; `featured` is the larger first card of the index */
export default function PostCard({
  post,
  lang,
  t,
  featured = false,
}: {
  post: BlogPost;
  lang: Locale;
  t: Dictionary["blog"];
  featured?: boolean;
}) {
  const href = localePath(lang, `/blog/${postSlug(post)}`);
  const authors = resolveAuthors(post.data.authors);
  return (
    <article
      className={cn(
        "bp-reveal group relative flex flex-col rounded-2xl border border-border bg-card p-6 transition-[translate,box-shadow,border-color] duration-(--bp-d-md) ease-spring hover:-translate-y-[3px] hover:border-line-strong hover:shadow-[0_10px_30px_-14px_var(--bp-shadow)]",
        featured && "p-8 md:p-10",
      )}
    >
      <ul className="mb-4 flex flex-wrap gap-1.5">
        {post.data.tags.map((tag) => (
          <li key={tag} className="rounded-full bg-tint px-2.5 py-0.5 font-mono text-label font-medium text-accent-text">
            {tag}
          </li>
        ))}
      </ul>
      <h2
        className={cn(
          "text-foreground",
          featured ? "max-w-3xl text-title-md md:text-title-lg" : "text-xl leading-snug font-bold tracking-title",
        )}
      >
        <Link
          href={href}
          className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-primary"
        >
          {post.data.title}
        </Link>
      </h2>
      <p className={cn("mt-3 leading-relaxed text-muted-foreground", featured ? "max-w-2xl text-body-lg" : "text-body")}>
        {post.data.description}
      </p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-6 text-caption text-muted-foreground">
        <span className="flex items-center gap-2.5">
          <AuthorAvatars authors={authors} size={24} />
          <span>
            <time dateTime={post.data.date.toISOString()}>{formatDate(post.data.date, lang)}</time>
            <span aria-hidden> · </span>
            {readingMinutes(post)} {t.minutes}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 font-semibold text-accent-text">
          {t.readMore}
          <ArrowRight className="size-3.5 transition-transform duration-(--bp-d-sm) group-hover:translate-x-0.5" />
        </span>
      </div>
    </article>
  );
}
