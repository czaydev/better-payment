import type { ReactNode } from "react";
import { Alert, type AlertTone } from "@czayelements/zay-ui";
import { cn } from "@/lib/utils";

type CalloutType = "info" | "warn" | "warning" | "error" | "success" | "idea";

const toneMap: Record<CalloutType, AlertTone> = {
  info: "info",
  idea: "info",
  warn: "warning",
  warning: "warning",
  error: "danger",
  success: "success",
};

/**
 * Docs callout powered by @czayelements/zay-ui Alert.
 * Accepts the same `type` values as Fumadocs' Callout so existing MDX works out of the box.
 */
export default function DocsCallout({
  type = "info",
  title,
  children,
}: {
  type?: CalloutType;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const tone = toneMap[type] ?? "info";

  return (
    <Alert
      tone={tone}
      title={title}
      className={cn(
        "not-prose my-5",
        "[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4",
        "[&_code]:rounded-md [&_code]:bg-callout-code [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.88em]",
        "[&_p]:m-0 [&_p+p]:mt-2"
      )}
    >
      {children}
    </Alert>
  );
}
