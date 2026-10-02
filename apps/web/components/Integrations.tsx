"use client";

import Image from "next/image";
import { useState } from "react";
import { Check } from "lucide-react";
import CompareSlider from "@/components/CompareSlider";
import SectionHeading from "@/components/SectionHeading";
import { integrations } from "@/lib/integrations";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionary";

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
  const p = integrations[active];
  const info = t[p.id];
  const tagline = p.kind === "gateway" ? t.gateway : p.kind === "virtualPos" ? t.virtualPos : bankTagline;

  return (
    <section id="providers" className="scroll-mt-20 px-5 py-24 sm:px-8 md:py-28">
      <div className="mx-auto max-w-6xl">
        <SectionHeading line1={compare.titleLine1} line2={compare.titleLine2} lead={compare.lead} />

        <div role="tablist" aria-label={t.capabilities} className="bp-reveal mb-5 flex flex-wrap gap-1.5">
          {integrations.map((item, i) => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={active === i}
              onClick={() => setActive(i)}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border py-1.5 pr-4 pl-1.5 text-sm font-medium transition-[border-color,box-shadow,color] duration-(--bp-d-sm) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                active === i
                  ? "border-primary bg-card text-foreground shadow-[0_0_0_4px_var(--bp-tint)]"
                  : "border-border bg-card text-muted-foreground hover:border-line-strong hover:text-foreground",
              )}
            >
              <span className="grid size-8 place-items-center rounded-lg border border-border bg-background">
                <Image src={item.logo} alt="" width={28} height={16} className="h-4 w-7 object-contain" />
              </span>
              {item.name}
            </button>
          ))}
        </div>

        <div className="bp-reveal grid grid-cols-1 gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-7">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-xl border border-border bg-background">
                <Image src={p.logo} alt="" width={40} height={24} className="h-6 w-10 object-contain" />
              </span>
              <div>
                <h3 className="text-lg leading-tight font-bold text-foreground">{p.name}</h3>
                <p className="text-sm text-muted-foreground">{tagline}</p>
              </div>
            </div>
            <p className="text-[14.5px] leading-relaxed text-muted-foreground">{info.description}</p>

            <p className="mt-6 mb-3 text-[13px] font-medium text-muted-foreground">{t.capabilities}</p>
            <ul className="grid gap-2.5">
              {info.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2.5 text-sm text-foreground">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-tint text-primary">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <CompareSlider
            key={p.id}
            before={p.before}
            after={p.after}
            labels={{ without: `${compare.without} · ${p.name} API`, with: compare.with, drag: t.drag }}
            copy={code}
          />
        </div>
      </div>
    </section>
  );
}
