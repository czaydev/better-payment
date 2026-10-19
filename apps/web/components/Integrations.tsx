"use client";

import Image from "next/image";
import { useState } from "react";
import { Check } from "lucide-react";
import CompareSlider from "@/components/CompareSlider";
import SectionHeading from "@/components/SectionHeading";
import { integrations, providerTiles, type ProviderGroup } from "@/lib/integrations";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { withBasePath } from "@/lib/base-path";

const GROUPS: ProviderGroup[] = ["gateway", "virtualPos", "bankPos"];

/**
 * "Every gateway has a different API" and the provider showcase in one
 * section: pick a provider, then drag the divider to compare its raw API
 * with the same job in Better Payment.
 */
export default function Integrations({
  compare,
  t,
  bankTagline,
  code,
}: {
  compare: Dictionary["compare"];
  t: Dictionary["providers"];
  bankTagline: string;
  code: Dictionary["code"];
}) {
  const [active, setActive] = useState(0);
  const tile = providerTiles[active];
  const p = integrations.find((item) => item.id === tile.integration)!;
  const info = t[p.id];
  const tagline = p.kind === "gateway" ? t.gateway : p.kind === "virtualPos" ? t.virtualPos : bankTagline;
  // EST banks share one snippet; show the selected bank's provider key
  const after = tile.bank
    ? { ...p.after, code: p.after.code.replaceAll("isbank", tile.bank) }
    : p.after;
  const estBanks = providerTiles.filter((item) => item.integration === "est");

  return (
    <section id="providers" className="scroll-mt-20 px-5 py-24 sm:px-8 md:py-28">
      <div className="mx-auto max-w-7xl">
        <SectionHeading line1={compare.titleLine1} line2={compare.titleLine2} lead={compare.lead} />

        <div className="bp-reveal mb-5 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
            <p className="text-body font-bold tracking-tight text-foreground">{t.summary}</p>
            <p className="text-caption text-muted-foreground">{t.pick}</p>
          </div>
          <div role="tablist" aria-label={t.capabilities} className="flex flex-col gap-y-4 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {GROUPS.map((group) => (
              <div key={group} role="presentation" className="min-w-0">
                <p className="mb-2 px-1 text-label font-semibold tracking-eyebrow text-muted-foreground uppercase">
                  {t.groups[group]}
                </p>
                <div role="presentation" className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                  {providerTiles.map((item, i) =>
                    item.group !== group ? null : (
                      <button
                        key={item.key}
                        role="tab"
                        type="button"
                        aria-selected={active === i}
                        aria-label={item.name}
                        title={item.name}
                        onClick={() => setActive(i)}
                        className={cn(
                          "grid h-14 w-full place-items-center sm:w-[118px] rounded-xl border px-3 transition-[border-color,box-shadow,background-color] duration-(--bp-d-sm) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-logo",
                          active === i
                            ? "border-primary bg-background shadow-[0_0_0_4px_var(--bp-tint)]"
                            : "border-border bg-background hover:border-line-strong",
                        )}
                      >
                        {item.logo ? (
                          <Image
                            src={withBasePath(item.logo)}
                            alt=""
                            width={96}
                            height={32}
                            className={cn("w-auto max-w-full object-contain", item.tall ? "max-h-11" : "max-h-7")}
                          />
                        ) : (
                          <span className="text-body-sm font-bold tracking-tight text-foreground dark:text-brand-950">{item.name}</span>
                        )}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bp-reveal grid grid-cols-1 gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-7">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-xl border border-border bg-background dark:bg-logo">
                {tile.logo ? (
                  <Image src={withBasePath(tile.logo)} alt="" width={40} height={24} className="h-6 w-10 object-contain" />
                ) : (
                  <span className="text-xs font-bold text-foreground dark:text-brand-950">{tile.name.slice(0, 2)}</span>
                )}
              </span>
              <div>
                <h3 className="text-lg leading-tight font-bold text-foreground">{tile.name}</h3>
                <p className="text-sm text-muted-foreground">{tagline}</p>
              </div>
            </div>
            <p className="text-body leading-relaxed text-muted-foreground">{info.description}</p>
            {p.id === "est" && (
              <p className="mt-3 text-caption text-muted-foreground">
                {t.estBanks}: <span className="font-medium text-foreground">{estBanks.map((b) => b.name).join(", ")}</span>
              </p>
            )}

            <p className="mt-6 mb-3 text-caption font-medium text-muted-foreground">{t.capabilities}</p>
            <ul className="grid gap-2.5">
              {info.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2.5 text-sm text-foreground">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-tint text-accent-text">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <CompareSlider
            key={tile.key}
            before={p.before}
            after={after}
            labels={{ without: `${compare.without} · ${p.id === "est" ? "EST" : tile.name} API`, with: compare.with, drag: t.drag }}
            copy={code}
          />
        </div>
      </div>
    </section>
  );
}
