import { cn } from "@/lib/utils";

/**
 * Section title without an eyebrow label (vault: Branding/06). The second
 * line carries the muted half of the message.
 */
export default function SectionHeading({
  line1,
  line2,
  lead,
  className,
}: {
  line1: string;
  line2?: string;
  lead?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("bp-reveal mb-12 max-w-2xl", className)}>
      <h2 className="text-title-lg text-foreground sm:text-title-xl">
        {line1}
        {line2 && (
          <>
            <br />
            <span className="text-muted-foreground">{line2}</span>
          </>
        )}
      </h2>
      {lead && <p className="mt-4 max-w-xl text-body-lg leading-relaxed text-muted-foreground">{lead}</p>}
    </div>
  );
}
