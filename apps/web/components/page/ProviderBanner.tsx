import Image from "next/image";
import { Check, Plus } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { cn } from "@/lib/utils";

/** Logo on a light tile in both themes: provider marks are drawn for white backgrounds */
export function LogoTile({ src, w, h, name, size = "lg", className }: { src: string; w: number; h: number; name: string; size?: "md" | "lg"; className?: string }) {
  return (
    <span className={cn("grid place-items-center rounded-3xl border border-border bg-logo", size === "lg" ? "h-28 w-44 px-6 sm:h-32 sm:w-56" : "h-16 w-28 px-4", className)}>
      <Image
        src={withBasePath(src)}
        alt={name}
        width={w}
        height={h}
        className={cn("w-auto object-contain", size === "lg" ? "max-h-12 sm:max-h-14" : "max-h-8")}
      />
    </span>
  );
}

/**
 * Co-brand banner as global SaaS integration pages draw it: our mark, a ×, the partner's mark,
 * dotted wires between them and a few verified-capability chips along the bottom.
 */
export default function ProviderBanner({
  name,
  logo,
  chips,
}: {
  name: string;
  logo: { src: string; w: number; h: number };
  chips: string[];
}) {
  return (
    <div className="relative overflow-hidden rounded-card border border-border bg-card p-3">
      <div className="relative rounded-[26px] border border-border bg-surface px-4 py-12 sm:px-8 sm:py-16">
        {/* faint dot grid, no gradient */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-60 [background-image:radial-gradient(var(--bp-line-strong)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(ellipse_at_center,#000_30%,transparent_75%)]"
        />
        <div className="relative flex items-center justify-center gap-3 sm:gap-6">
          <span className="grid h-28 w-44 place-items-center rounded-3xl border border-border bg-card px-6 sm:h-32 sm:w-56">
            <Image src={withBasePath("/brand/better-payment-horizontal-color.svg")} alt="Better Payment" width={1226} height={155} className="h-6 w-auto dark:hidden sm:h-7" />
            <Image src={withBasePath("/brand/better-payment-horizontal-dark.svg")} alt="Better Payment" width={1226} height={155} className="hidden h-6 w-auto dark:block sm:h-7" />
          </span>
          <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground sm:size-12">
            <Plus className="size-4 rotate-45 sm:size-5" strokeWidth={1.75} />
          </span>
          <LogoTile src={logo.src} w={logo.w} h={logo.h} name={name} />
        </div>
        <div className="relative mt-10 flex flex-wrap justify-center gap-2">
          {chips.map((chip) => (
            <span key={chip} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-caption text-foreground">
              <Check className="size-3.5 text-success" />
              {chip}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
