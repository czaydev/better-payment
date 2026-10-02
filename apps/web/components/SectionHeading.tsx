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
      <h2 className="text-[2rem] leading-[1.08] font-extrabold tracking-[-0.03em] text-foreground sm:text-[2.5rem]">
        {line1}
        {line2 && (
          <>
            <br />
            <span className="text-muted-foreground">{line2}</span>
          </>
        )}
      </h2>
      {lead && <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-muted-foreground">{lead}</p>}
    </div>
  );
}
