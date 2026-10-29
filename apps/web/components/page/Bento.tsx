import type { ComponentType } from "react";
import { ArrowRight } from "lucide-react";
import { LinkCard, ArrowChip } from "./primitives";
import { cn } from "@/lib/utils";

export interface BentoItem {
  icon: ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  href: string;
  badge?: string;
  external?: boolean;
  highlight?: boolean;
}

/** Link cards on a 3-column grid; a highlighted card turns into the page's single dark block and spans two columns */
export default function Bento({ items, hrefFor, cta }: { items: BentoItem[]; hrefFor: (href: string) => string; cta: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <LinkCard
            key={item.title}
            href={item.external ? item.href : hrefFor(item.href)}
            external={item.external}
            className={cn(
              "min-h-64 justify-between gap-10",
              item.highlight && "panel-dark border-transparent hover:border-border lg:col-span-2",
            )}
          >
            <div className="flex items-start justify-between">
              <span className={cn("grid size-12 place-items-center rounded-2xl bg-tint text-accent-text", item.highlight && "bg-card")}>
                <Icon className="size-5" />
              </span>
              <span className="flex items-center gap-2">
                {item.badge && <span className="rounded-badge border border-border px-2.5 py-1 text-caption text-muted-foreground">{item.badge}</span>}
                <ArrowChip />
              </span>
            </div>
            <div>
              <h3 className={cn("text-title-sm text-foreground", item.highlight && "text-title-md")}>{item.title}</h3>
              <p className="mt-2 max-w-md text-body leading-relaxed text-muted-foreground">{item.desc}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-body-sm font-medium text-foreground">
                {cta}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </span>
            </div>
          </LinkCard>
        );
      })}
    </div>
  );
}
