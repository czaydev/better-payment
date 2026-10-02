"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export default function CopyButton({
  text,
  labels,
  className,
}: {
  /** The text to copy, or a function that reads it when the button is clicked */
  text: string | ((button: HTMLButtonElement) => string);
  labels: { copy: string; copied: string };
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(event: React.MouseEvent<HTMLButtonElement>) {
    try {
      await navigator.clipboard.writeText(typeof text === "string" ? text : text(event.currentTarget));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable (insecure context); the code stays selectable
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={cn(
        "ml-auto inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary",
        copied ? "text-success" : "text-muted-foreground hover:bg-tint hover:text-primary",
        className,
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? labels.copied : labels.copy}
    </button>
  );
}
