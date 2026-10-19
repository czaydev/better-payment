import Image from "next/image";
import { avatarUrl, type Author } from "@/lib/authors";
import { cn } from "@/lib/utils";

/** Overlapping GitHub avatars of a post's authors */
export default function AuthorAvatars({ authors, size = 28, className }: { authors: Author[]; size?: number; className?: string }) {
  if (!authors.length) return null;
  return (
    <span className={cn("flex items-center -space-x-2", className)}>
      {authors.map((author) => (
        <Image
          key={author.login}
          src={avatarUrl(author.avatarId, size * 2)}
          alt=""
          width={size}
          height={size}
          unoptimized
          title={author.name}
          className="shrink-0 rounded-full border-2 border-card bg-card object-cover"
          style={{ width: size, height: size }}
        />
      ))}
    </span>
  );
}
