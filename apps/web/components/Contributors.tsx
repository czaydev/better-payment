import Image from "next/image";
import { ChevronRight, Plus } from "lucide-react";
import SectionHeading from "@/components/SectionHeading";
import { GitHubIcon } from "@/components/icons";
import { contributors } from "@/lib/contributors";
import { buttonVariants } from "@/lib/button-variants";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/config";

const repository = "https://github.com/czaydev/better-payment";

export default function Contributors({ lang, t }: { lang: Locale; t: Dictionary["contributors"] }) {
  const guide = `${repository}/blob/main/CONTRIBUTING${lang === "tr" ? ".tr" : ""}.md`;
  return (
    <section id="contribute" className="scroll-mt-24 border-y border-border bg-card px-5 py-24 sm:px-8 md:py-28">
      <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-20">
        <div>
          <SectionHeading line1={t.titleLine1} line2={t.titleLine2} lead={t.lead} className="mb-8" />
          <div className="bp-reveal flex flex-wrap gap-3">
            <a href={guide} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
              <GitHubIcon data-icon="brand" />{t.guide}<ChevronRight data-icon="chevron" />
            </a>
            <a href={`${repository}/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>{t.issues}<ChevronRight data-icon="chevron" /></a>
          </div>
        </div>
        <div className="bp-reveal">
          <div className="mb-7 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <h3 className="text-sm font-medium text-muted-foreground">{t.people}</h3>
            <span className="h-px flex-1 bg-border" />
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {contributors.map(({ login, avatarId }) => (
              <li key={login}>
                <a href={`https://github.com/${login}`} target="_blank" rel="noopener noreferrer" className="group flex h-full flex-col items-center gap-3 rounded-2xl border border-border bg-background px-2 py-6 transition-[border-color,background-color] duration-(--bp-d-md) hover:border-line-strong hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                  <Image src={`https://avatars.githubusercontent.com/u/${avatarId}?v=4&s=128`} alt="" width={64} height={64} unoptimized className="size-16 rounded-full border-4 border-card object-cover shadow-sm" />
                  <span className="max-w-full truncate text-xs font-medium text-foreground">@{login}</span>
                </a>
              </li>
            ))}
            <li>
              <a href={guide} target="_blank" rel="noopener noreferrer" aria-label={t.join} className="group flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-lilac bg-tint/50 px-2 py-6 text-accent-text transition-colors hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
                <span className="grid size-16 place-items-center rounded-full border border-dashed border-lilac"><Plus className="size-6" strokeWidth={1.5} /></span>
                <span className="text-xs font-semibold">{t.you}</span>
              </a>
            </li>
          </ul>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <p>{t.thanks}</p>
            <a href={`${repository}/graphs/contributors`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-text underline-offset-4 hover:underline">{t.all}<ChevronRight className="size-3.5" /></a>
          </div>
        </div>
      </div>
    </section>
  );
}
