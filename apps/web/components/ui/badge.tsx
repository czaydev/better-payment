import type { ComponentProps, ReactNode } from "react";
import { Badge as ZayBadge, type BadgeVariant as ZayBadgeVariant, badgeClass } from "@czayelements/zay-ui";
import { cn } from "@/lib/utils";

export type BadgeVariant = ZayBadgeVariant | "default" | "ghost" | "link";

export interface BadgeProps extends Omit<ComponentProps<"span">, "children"> {
  variant?: BadgeVariant;
  dot?: boolean;
  label?: ReactNode;
  children?: ReactNode;
  render?: unknown;
}

export function Badge({
  className,
  variant = "default",
  dot,
  label,
  children,
  ...props
}: BadgeProps) {
  const resolvedVariant: ZayBadgeVariant =
    variant === "default"
      ? "brand"
      : variant === "ghost" || variant === "link"
        ? "outline"
        : variant;

  return (
    <ZayBadge
      variant={resolvedVariant}
      dot={dot}
      label={label}
      className={cn(badgeClass(resolvedVariant), className)}
      {...props}
    >
      {children}
    </ZayBadge>
  );
}

export const badgeVariants = ({ variant = "default" }: { variant?: BadgeVariant } = {}) => {
  const resolvedVariant: ZayBadgeVariant =
    variant === "default"
      ? "brand"
      : variant === "ghost" || variant === "link"
        ? "outline"
        : variant;
  return badgeClass(resolvedVariant);
};
