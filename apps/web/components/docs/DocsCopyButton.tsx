"use client";

import CopyButton from "@/components/CopyButton";

/** Copy button for Fumadocs code blocks; reads the code from its own block */
export default function DocsCopyButton({ labels, className }: { labels: { copy: string; copied: string }; className?: string }) {
  return (
    <CopyButton
      labels={labels}
      className={className}
      text={(button) => button.closest("figure")?.querySelector("pre")?.textContent ?? ""}
    />
  );
}
