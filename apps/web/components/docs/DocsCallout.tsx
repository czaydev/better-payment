import { CircleCheck, Info, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type CalloutType = "info" | "warn" | "warning" | "error" | "success" | "idea";

const styles = {
  info: { icon: Info, box: "bg-tint border-callout-info-border", dot: "bg-primary", title: "text-callout-info-title" },
  warn: { icon: TriangleAlert, box: "bg-warning-soft border-callout-warn-border", dot: "bg-warning", title: "text-callout-warn-title" },
  error: { icon: OctagonAlert, box: "bg-danger-soft border-callout-error-border", dot: "bg-danger", title: "text-callout-error-title" },
  success: { icon: CircleCheck, box: "bg-success-soft border-callout-success-border", dot: "bg-success", title: "text-callout-success-title" },
  idea: { icon: Lightbulb, box: "bg-tint border-callout-info-border", dot: "bg-primary", title: "text-callout-info-title" },
} as const;

/**
 * Docs callout in the brand style (vault: Branding/06). Accepts the same
 * `type` values as Fumadocs' Callout, so existing MDX keeps working.
 */
export default function DocsCallout({
  type = "info",
  title,
  children,
}: {
  type?: CalloutType;
  title?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const style = styles[type === "warning" ? "warn" : type] ?? styles.info;
  const Icon = style.icon;
  return (
    <div role="note" className={cn("not-prose my-5 flex gap-3.5 rounded-xl border px-4 py-3.5", style.box)}>
      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-white", style.dot)}>
        <Icon className="size-3.5" strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1 text-[14.5px] leading-[1.65] text-foreground [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded-md [&_code]:bg-callout-code [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em] [&_p]:m-0 [&_p+p]:mt-2">
        {title && <p className={cn("mb-1 font-semibold", style.title)}>{title}</p>}
        {children}
      </div>
    </div>
  );
}
