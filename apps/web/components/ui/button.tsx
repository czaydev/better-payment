"use client";

import type { ComponentProps } from "react";
import {
  Button as ZayButton,
  buttonClass,
  type ButtonStyle,
} from "@czayelements/zay-ui";

export interface ButtonProps
  extends Omit<ComponentProps<"button">, "size">,
    ButtonStyle {
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  icon,
  pill,
  loading,
  children,
  ...props
}: ButtonProps) {
  return (
    <ZayButton
      variant={variant}
      size={size}
      icon={icon}
      pill={pill}
      loading={loading}
      className={className}
      {...props}
    >
      {children}
    </ZayButton>
  );
}

export { buttonVariants } from "@/lib/button-variants";
export { buttonClass };
