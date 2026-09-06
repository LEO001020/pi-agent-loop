/**
 * Path / code block — Cursor-style soft chrome (label + wrap + copy).
 */

import { useState, type ReactNode } from "react";
import { IconCheck, IconCopy } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    const p = node as { props?: { children?: ReactNode } };
    return extractText(p.props?.children);
  }
  return "";
}

export function CodeBlock({
  language,
  children,
  wrapLabel = "Wrap",
  unwrapLabel = "No wrap",
  copyLabel = "Copy",
}: {
  language?: string;
  children: ReactNode;
  wrapLabel?: string;
  unwrapLabel?: string;
  copyLabel?: string;
}) {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const lang = (language || "text").replace(/^language-/, "") || "text";
  const text = extractText(children).replace(/\n$/, "");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="chat-code">
      <div className="chat-code__bar">
        <span className="chat-code__lang">{lang}</span>
        <div className="chat-code__bar-actions">
          <Tip label={wrap ? unwrapLabel : wrapLabel}>
            <button
              type="button"
              className={cn("chat-code__btn", wrap && "is-on")}
              aria-label={wrap ? unwrapLabel : wrapLabel}
              aria-pressed={wrap}
              onClick={() => setWrap((v) => !v)}
            >
              <span className="chat-code__wrap-icon" aria-hidden>
                ↵
              </span>
            </button>
          </Tip>
          <Tip label={copied ? "OK" : copyLabel}>
            <button
              type="button"
              className={cn("chat-code__btn", copied && "is-copied")}
              aria-label={copyLabel}
              onClick={() => void onCopy()}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          </Tip>
        </div>
      </div>
      <pre className={cn("chat-code__pre", wrap && "is-wrap")}>
        <code>{children}</code>
      </pre>
    </div>
  );
}
