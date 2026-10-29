"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { highlight } from "@/components/Code";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { id: "iyzico", ms: 412 },
  { id: "paytr", ms: 538 },
  { id: "sipay", ms: 377 },
  { id: "akbank", ms: 291 },
  { id: "ziraat", ms: 344 },
] as const;

/** Flip one string and watch the same call, and the same result shape, run on another provider */
export default function ProviderSwitcher({ resultLabel }: { resultLabel: string }) {
  const [active, setActive] = useState<(typeof PROVIDERS)[number]["id"]>("iyzico");
  const current = PROVIDERS.find((p) => p.id === active)!;
  const snippet = `const payment = createBetterPayment({
  defaultProvider: "${active}",
});

await payment.createPayment(order);`;

  return (
    <div className="rounded-card border border-border bg-card p-3">
      <div role="tablist" aria-label="provider" className="flex flex-wrap gap-1 rounded-[26px] bg-muted p-1">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            role="tab"
            type="button"
            aria-selected={active === p.id}
            onClick={() => setActive(p.id)}
            className={cn(
              "flex-1 rounded-full px-3 py-2 font-mono text-meta transition-colors focus-visible:outline-2 focus-visible:outline-primary",
              active === p.id ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p.id}
          </button>
        ))}
      </div>

      <pre className="panel-dark mt-3 overflow-x-auto rounded-[26px] p-5 font-mono text-meta leading-code text-foreground">
        <code>{highlight(snippet)}</code>
      </pre>

      <div className="mt-3 flex items-center justify-between rounded-[26px] border border-border bg-surface px-5 py-4">
        <div>
          <p className="text-caption text-muted-foreground">{resultLabel}</p>
          <p className="mt-0.5 font-mono text-meta text-foreground">
            {"{ status: "}
            <span className="text-success">&quot;success&quot;</span>
            {", provider: "}
            <span className="text-accent-text">&quot;{active}&quot;</span>
            {" }"}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-caption font-medium text-success">
          <Check className="size-3.5" />
          {current.ms} ms
        </span>
      </div>
    </div>
  );
}
