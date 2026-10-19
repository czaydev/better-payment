"use client";

import { useState } from "react";
import CopyButton from "@/components/CopyButton";
import { cn } from "@/lib/utils";

const MANAGERS = [
  { id: "npm", command: "npm install better-payment" },
  { id: "pnpm", command: "pnpm add better-payment" },
  { id: "bun", command: "bun add better-payment" },
] as const;

export default function InstallCommand({ labels }: { labels: { copy: string; copied: string } }) {
  const [active, setActive] = useState(0);
  const { command } = MANAGERS[active];

  return (
    <div className="flex w-full flex-wrap items-center gap-1 rounded-[10px] sm:inline-flex sm:w-auto border border-border bg-card/80 py-1.5 pr-1.5 pl-1.5 backdrop-blur-sm">
      <div role="tablist" aria-label="Package manager" className="flex gap-0.5 max-sm:w-full">
        {MANAGERS.map((m, i) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "h-7 rounded-md px-2 font-mono text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary",
              i === active ? "bg-tint text-accent-text" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m.id}
          </button>
        ))}
      </div>
      <span className="mx-1.5 h-4 w-px bg-border max-sm:hidden" aria-hidden />
      <code className="min-w-0 truncate font-mono text-sm max-sm:flex-1 max-sm:pl-2">
        <span className="mr-2 text-muted-foreground select-none">$</span>
        {command}
      </code>
      <CopyButton text={command} labels={labels} className="sm:ml-2" />
    </div>
  );
}
