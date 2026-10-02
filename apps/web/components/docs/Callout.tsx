import { Info, AlertTriangle, CheckCircle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

type CalloutType = "info" | "warning" | "success" | "tip";

const styles: Record<CalloutType, { icon: React.ElementType; cls: string }> = {
  info: {
    icon: Info,
    cls: "bg-tint border-[#dcd8ff] text-[#2b2496]",
  },
  warning: {
    icon: AlertTriangle,
    cls: "bg-warning-soft border-[#f4dfb8] text-[#7a4605]",
  },
  success: {
    icon: CheckCircle,
    cls: "bg-success-soft border-[#c4e7d8] text-[#065c40]",
  },
  tip: {
    icon: Lightbulb,
    cls: "bg-tint border-[#dcd8ff] text-primary",
  },
};

export default function Callout({
  type = "info",
  children,
}: {
  type?: CalloutType;
  children: React.ReactNode;
}) {
  const { icon: Icon, cls } = styles[type];

  return (
    <div className={cn("flex gap-3 rounded-xl border px-4 py-3.5 my-4 text-sm leading-relaxed", cls)}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="text-current">{children}</div>
    </div>
  );
}
