import { cva } from "class-variance-authority";

/**
 * Brand buttons (vault: Branding/06). Primary buttons carry the idle sheen,
 * every other variant sweeps the sheen on hover. Icons opt into motion with
 * data-icon="chevron" or data-icon="brand" (see .btn-fx in globals.css).
 */
export const buttonVariants = cva(
  "btn-fx inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,color] duration-200 outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-primary active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "btn-fx-idle bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_6px_16px_-6px_rgb(67_56_242/0.67)] hover:bg-(--bp-primary-hover) hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_10px_24px_-8px_rgb(67_56_242/0.8)]",
        outline: "border-border bg-card text-foreground hover:border-line-strong",
        secondary: "bg-secondary text-secondary-foreground hover:bg-tint/70",
        ghost: "text-foreground hover:bg-accent",
        destructive: "bg-danger-soft text-danger hover:bg-danger-soft/70",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[46px] px-5 text-[15px]",
        xs: "h-7 gap-1 rounded-lg px-2.5 text-xs",
        sm: "h-9 gap-1.5 rounded-[10px] px-3.5 text-[13.5px]",
        lg: "h-[54px] rounded-[14px] px-6.5 text-base",
        icon: "size-9 rounded-[10px]",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
