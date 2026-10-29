import Image from "next/image";
import { providerTiles } from "@/lib/integrations";
import { withBasePath } from "@/lib/base-path";
import type { Dictionary } from "@/lib/i18n/dictionary";

// Logos shown in the strip: gateways first, then the banks that have artwork
const LOGO_KEYS = ["iyzico", "paytr", "sipay", "parampos", "akbank", "kuveytturk", "isbank", "ziraat"];
const logos = LOGO_KEYS.flatMap((key) => providerTiles.filter((tile) => tile.key === key && tile.logo));

export default function HeroProof({ t }: { t: Dictionary["hero"]["proof"] }) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
        <p className="w-full font-mono text-label sm:w-auto font-medium text-muted-foreground">{t.label}</p>
        <ul className="flex flex-1 flex-wrap items-center gap-2.5">
          {logos.map((tile) => (
            <li
              key={tile.key}
              title={tile.name}
              className="grid h-10 w-20 place-items-center rounded-lg border border-border bg-background px-2 dark:bg-logo"
            >
              <Image
                src={withBasePath(tile.logo!)}
                width={64}
                height={24}
                alt={tile.name}
                className="max-h-5 w-auto max-w-full object-contain"
              />
            </li>
          ))}
          <li className="px-1 text-caption font-medium text-muted-foreground">{t.more}</li>
        </ul>
      </div>
      <dl className="grid grid-cols-2 border-t border-border md:grid-cols-4">
        {t.stats.map((stat, i) => (
          <div
            key={stat.label}
            className={`px-5 py-4 sm:px-6 ${i % 2 === 1 ? "border-l" : ""} ${i > 1 ? "max-md:border-t" : ""} ${i > 0 ? "md:border-l" : ""} border-border`}
          >
            <dt className="sr-only">{stat.label}</dt>
            <dd className="text-stat text-foreground">{stat.value}</dd>
            <p className="mt-1.5 text-caption text-muted-foreground" aria-hidden>
              {stat.label}
            </p>
          </div>
        ))}
      </dl>
    </div>
  );
}
