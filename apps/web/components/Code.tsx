import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import CopyButton from "@/components/CopyButton";

const KEYWORDS = new Set([
  "import", "from", "export", "default", "const", "let", "new", "await", "async",
  "return", "if", "true", "false",
]);

// Brand syntax colours (vault: Branding/06): keywords indigo, strings green,
// function calls violet, comments muted italic
const TOKEN = /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|([A-Za-z_$][\w$]*)(?=(\s*\())?/gm;

export function highlight(code: string) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    const index = m.index ?? 0;
    if (index > last) out.push(code.slice(last, index));
    const [text, comment, string, word, call] = m;
    if (comment) {
      out.push(<span key={index} className="text-muted-foreground italic">{text}</span>);
    } else if (string) {
      out.push(<span key={index} className="text-success">{text}</span>);
    } else if (word && KEYWORDS.has(word)) {
      out.push(<span key={index} className="text-accent-text">{text}</span>);
    } else if (word && call !== undefined) {
      out.push(<span key={index} className="text-code-fn">{text}</span>);
    } else {
      out.push(text);
    }
    last = index + text.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export default function Code({
  code,
  file,
  shell = false,
  copy,
  className,
}: {
  code: string;
  file?: string;
  shell?: boolean;
  /** Labels for the copy button; without them no button is shown */
  copy?: { copy: string; copied: string };
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden min-w-0", className)}>
      {file && (
        <div className="flex items-center gap-2 border-b border-border bg-background py-1.5 pr-1.5 pl-4">
          <span className="font-mono text-xs text-muted-foreground">{file}</span>
          {copy && <CopyButton text={code} labels={copy} />}
        </div>
      )}
      <pre className="p-5 font-mono text-[13px] leading-[1.75] overflow-x-auto text-foreground">
        {shell ? (
          <code>
            <span className="text-muted-foreground select-none">$ </span>
            {code}
          </code>
        ) : (
          <code>{highlight(code)}</code>
        )}
      </pre>
    </div>
  );
}
