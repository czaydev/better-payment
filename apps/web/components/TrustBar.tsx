import type { Dictionary } from "@/lib/i18n/dictionary";

const frameworks = ["Next.js", "Express", "Fastify", "Hono", "Cloudflare Workers", "Bun", "Deno"];

export default function TrustBar({ t }: { t: Dictionary["trustBar"] }) {
  return (
    <div className="border-y border-border py-5 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
          <p className="text-sm font-medium text-muted-foreground shrink-0">
            {t.title}
          </p>
          <ul className="flex items-center gap-6 sm:gap-8 flex-wrap justify-center">
            {frameworks.map((name) => (
              <li key={name} className="text-sm font-medium text-muted-foreground">
                {name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
