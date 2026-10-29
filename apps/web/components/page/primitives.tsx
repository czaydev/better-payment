import type { ReactNode } from "react";
import Link from "next/link";
import { VERSION } from "better-payment";
import { ArrowUpRight, ChevronRight, Terminal, type LucideIcon } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import RevealOnScroll from "@/components/RevealOnScroll";
import { highlight } from "@/components/Code";
import { getDictionary } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/** Navbar, main landmark and footer shared by every marketing page */
export function PageShell({ lang, children }: { lang: Locale; children: ReactNode }) {
  const t = getDictionary(lang);
  return (
    <>
      <Navbar version={VERSION} lang={lang} t={t.nav} />
      <main id="main-content" tabIndex={-1} className="scroll-mt-20 focus:outline-none">
        {children}
      </main>
      <Footer lang={lang} t={t.footer} />
      <RevealOnScroll />
    </>
  );
}

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto max-w-[97rem] px-4 sm:px-6 md:px-4", className)} {...props} />;
}

/** Quiet band between sections: 80px of air, as in the design system */
export function Section({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn("py-16 sm:py-20", className)} {...props}>
      <Container>{children}</Container>
    </section>
  );
}

/** The one place the brand colour appears next to a title: a small tinted badge */
export function Eyebrow({ icon: Icon, children, className }: { icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-badge bg-tint px-2.5 py-1 text-caption font-medium text-accent-text",
        className,
      )}
    >
      {Icon && <Icon className="size-3.5" />}
      {children}
    </span>
  );
}

export function SectionHead({
  eyebrow,
  icon,
  title,
  lead,
  className,
}: {
  eyebrow?: string;
  icon?: LucideIcon;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-10 max-w-2xl", className)}>
      {eyebrow && <Eyebrow icon={icon} className="mb-4">{eyebrow}</Eyebrow>}
      <h2 className="text-title-lg text-foreground sm:text-title-xl">{title}</h2>
      {lead && <p className="mt-4 text-body-lg leading-relaxed text-muted-foreground">{lead}</p>}
    </div>
  );
}

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-border bg-card p-7", className)} {...props} />;
}

/** A card that only changes border colour on hover */
export function LinkCard({
  href,
  className,
  children,
  external,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(
        "group relative flex flex-col rounded-card border border-border bg-card p-7 transition-colors duration-200 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Round arrow chip that sits top-right on stat and link cards */
export function ArrowChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground",
        className,
      )}
    >
      <ArrowUpRight className="size-4" />
    </span>
  );
}

export function Crumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1.5 text-caption text-muted-foreground">
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="size-3" />}
          {item.href ? (
            <Link href={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Stat card: label top-left, arrow chip top-right, large semibold number at the bottom */
export function StatTiles({ items, className }: { items: Array<{ label: string; value: string; note?: string }>; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex min-h-40 flex-col justify-between rounded-card border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-3">
            <span className="text-body-sm text-muted-foreground">{item.label}</span>
            <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
              <ArrowUpRight className="size-4" />
            </span>
          </div>
          <div>
            <p className="text-display-sm text-foreground">{item.value}</p>
            {item.note && <p className="mt-1 text-caption text-muted-foreground">{item.note}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Numbered black (here: brand) circles separated by hairlines */
export function StepsCard({ steps, className }: { steps: Array<{ title: string; desc?: string }>; className?: string }) {
  return (
    <ol className={cn("divide-y divide-border rounded-card border border-border bg-card", className)}>
      {steps.map((step, i) => (
        <li key={step.title} className="flex gap-4 p-5 sm:p-6">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-body-sm font-medium text-primary-foreground">
            {i + 1}
          </span>
          <div className="min-w-0">
            <p className="text-body font-semibold text-foreground">{step.title}</p>
            {step.desc && <p className="mt-1 text-body-sm leading-relaxed text-muted-foreground">{step.desc}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The one dark "proof" block a page gets */
export function DarkBlock({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("panel-dark rounded-card p-8 sm:p-12", className)} {...props}>
      {children}
    </div>
  );
}

/** Theme-aware proof surface for dense comparison and integration sections. */
export function ProofBlock({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-card border border-border bg-surface p-8 shadow-[0_24px_70px_-52px_var(--bp-shadow)] sm:p-12", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CodeCard({ filename, code, className }: { filename: string; code: string; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-card border border-border bg-card shadow-sm", className)}>
      <div className="flex items-center justify-between border-b border-border bg-background/60 px-6 py-4">
        <span className="flex items-center gap-2 font-mono text-meta text-muted-foreground">
          <Terminal className="size-3.5 text-accent-text" />
          {filename}
        </span>
        <span className="rounded-badge border border-border px-2 py-0.5 font-mono text-micro text-muted-foreground">TypeScript</span>
      </div>
      <pre className="overflow-x-auto p-6 font-mono text-meta leading-code text-foreground/90">
        <code>{highlight(code)}</code>
      </pre>
    </div>
  );
}

/** Left: copy and actions. Right: a signature visual unique to the page. Below: stat tiles. */
export function PageHero({
  crumbs,
  eyebrow,
  icon,
  title,
  lead,
  actions,
  visual,
  children,
}: {
  crumbs?: Array<{ label: string; href?: string }>;
  eyebrow?: string;
  icon?: LucideIcon;
  title: ReactNode;
  lead: ReactNode;
  actions?: ReactNode;
  visual?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="pt-28 pb-10 sm:pt-36 sm:pb-12">
      <Container>
        <div className={cn("grid items-center gap-10", visual && "lg:grid-cols-[1.05fr_0.95fr] lg:gap-14")}>
          <div className="bp-enter min-w-0">
            {crumbs && <Crumbs items={crumbs} />}
            {eyebrow && <Eyebrow icon={icon} className="mb-5">{eyebrow}</Eyebrow>}
            <h1 className="max-w-3xl text-display-md text-foreground sm:text-display-lg">{title}</h1>
            <p className="mt-6 max-w-xl text-body-lg leading-relaxed text-muted-foreground">{lead}</p>
            {actions && <div className="mt-8 flex flex-wrap items-center gap-3">{actions}</div>}
          </div>
          {visual && (
            <div className="bp-enter min-w-0" style={{ "--at": "180ms" } as React.CSSProperties}>
              {visual}
            </div>
          )}
        </div>
        {children && <div className="mt-12">{children}</div>}
      </Container>
    </section>
  );
}
