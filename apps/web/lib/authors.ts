import { SITE_URL } from "@/lib/i18n/config";

/**
 * Blog authors, keyed by the GitHub login used in a post's `authors` frontmatter.
 * Names and avatars are the public GitHub profile ones. Add a new author here first.
 */
export const authors = {
  czaydev: { name: "Furkan Özay", avatarId: 48617418 },
  poyrazavsever: { name: "Poyraz", avatarId: 78071274 },
} satisfies Record<string, { name: string; avatarId: number }>;

export type Author = { login: string; name: string; avatarId: number; url: string };

/** Resolves frontmatter logins to authors; an unknown login keeps working without an avatar-id lookup */
export function resolveAuthors(logins: string[]): Author[] {
  return logins.flatMap((login) => {
    const known = authors[login as keyof typeof authors];
    return known ? [{ login, ...known, url: `https://github.com/${login}` }] : [];
  });
}

export const avatarUrl = (avatarId: number, size = 96) =>
  `https://avatars.githubusercontent.com/u/${avatarId}?v=4&s=${size}`;

/** schema.org Person list for JSON-LD */
export function authorsJsonLd(list: Author[]) {
  return list.length
    ? list.map((author) => ({ "@type": "Person", name: author.name, url: author.url, sameAs: [author.url] }))
    : [{ "@type": "Organization", name: "Better Payment", url: SITE_URL }];
}
