import { cva } from "class-variance-authority";

/**
 * Brand buttons (zay-ui shape, Better Payment colour). The filled button is the one elevated element: a
 * lit top edge, a 1.5px ring and a small soft drop shadow. Everything else is flat with a hairline.
 * Icons opt into motion with data-icon="chevron" or data-icon="brand" (see .btn-fx in globals.css).
 */
export const buttonVariants = cva(
  "btn-fx inline-flex shrink-0 items-center justify-center gap-2 rounded-[14px] border border-transparent font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,color] duration-200 outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[var(--bp-button-edge),var(--bp-button-ring),0_2px_4px_-1px_var(--bp-shadow)] hover:bg-(--bp-primary-hover)",
        outline: "border-border bg-card text-foreground hover:border-line-strong",
        secondary: "bg-secondary text-secondary-foreground hover:bg-tint/70",
        ghost: "text-foreground hover:bg-accent",
        destructive: "bg-danger-soft text-danger hover:bg-danger-soft/70",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 text-[15px]",
        xs: "h-7 gap-1 rounded-lg px-2.5 text-xs",
        sm: "h-9 gap-1.5 rounded-xl px-3.5 text-[13.5px]",
        lg: "h-12 px-6 text-base",
        icon: "size-9 rounded-xl",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-11",
      },
      pill: {
        true: "rounded-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      pill: false,
    },
  }
);
