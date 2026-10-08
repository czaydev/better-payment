"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/** Light/dark switch for the site navbar, in the same shape as the docs sidebar toggle */
export default function ThemeToggle({ label, className }: { label: string; className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  // The stored theme is only known in the browser, so the server render shows neither as active
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const value = mounted ? resolvedTheme : null;

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => setTheme(value === "dark" ? "light" : "dark")}
      className={cn(
        "inline-flex h-8 items-center rounded-full border border-border p-0.5 transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className,
      )}
    >
      {([
        ["light", Sun],
        ["dark", Moon],
      ] as const).map(([key, Icon]) => (
        <span
          key={key}
          className={cn(
            "grid size-6.5 place-items-center rounded-full text-muted-foreground transition-colors",
            value === key && "bg-accent text-accent-foreground",
          )}
        >
          <Icon className="size-3.5" fill="currentColor" />
        </span>
      ))}
    </button>
  );
}
