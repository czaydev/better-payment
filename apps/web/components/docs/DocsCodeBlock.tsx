"use client";

import type { ComponentProps } from "react";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import DocsCopyButton from "@/components/docs/DocsCopyButton";

/** Fumadocs code block with the brand copy button ("Copy" / "Copied") */
export default function DocsCodeBlock({
  copy,
  children,
  ...props
}: ComponentProps<"pre"> & { copy: { copy: string; copied: string } }) {
  return (
    <CodeBlock {...props} allowCopy={false} Actions={({ className }) => <DocsCopyButton labels={copy} className={className} />}>
      <Pre>{children}</Pre>
    </CodeBlock>
  );
}
