/**
 * Resource-pane code preview — highlight.js (same stack as Pi desktop)
 * with light/dark themes bound to `data-theme` on documentElement.
 */

import { useEffect, useMemo, useState } from "react";
import hljs from "highlight.js/lib/core";

import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import rust from "highlight.js/lib/languages/rust";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import swift from "highlight.js/lib/languages/swift";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import xml from "highlight.js/lib/languages/xml";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import makefile from "highlight.js/lib/languages/makefile";
import diff from "highlight.js/lib/languages/diff";
import graphql from "highlight.js/lib/languages/graphql";
import lua from "highlight.js/lib/languages/lua";
import r from "highlight.js/lib/languages/r";
import plaintext from "highlight.js/lib/languages/plaintext";

import { languageFromFileName } from "@/lib/codeLang";
import { cn } from "@/lib/utils";

// Themes: Atom One Dark / One Light (scoped in code-preview.css)
import "@/styles/code-preview.css";

let registered = false;
function ensureLangs() {
  if (registered) return;
  registered = true;
  const langs: [string, typeof javascript][] = [
    ["javascript", javascript],
    ["typescript", typescript],
    ["json", json],
    ["markdown", markdown],
    ["rust", rust],
    ["python", python],
    ["go", go],
    ["java", java],
    ["kotlin", kotlin],
    ["c", c],
    ["cpp", cpp],
    ["csharp", csharp],
    ["ruby", ruby],
    ["php", php],
    ["swift", swift],
    ["sql", sql],
    ["bash", bash],
    ["shell", bash],
    ["yaml", yaml],
    ["ini", ini],
    ["css", css],
    ["scss", scss],
    ["xml", xml],
    ["html", xml],
    ["dockerfile", dockerfile],
    ["makefile", makefile],
    ["diff", diff],
    ["graphql", graphql],
    ["lua", lua],
    ["r", r],
    ["plaintext", plaintext],
  ];
  for (const [name, def] of langs) {
    if (!hljs.getLanguage(name)) hljs.registerLanguage(name, def);
  }
}

export interface CodePreviewProps {
  code: string;
  /** File name for language detection (preferred). */
  fileName?: string;
  /** Explicit highlight.js language id. */
  language?: string;
  className?: string;
  /** Optional footer note (e.g. truncated). */
  footer?: string | null;
}

function readDocTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" ? "light" : "dark";
}

export function CodePreview({
  code,
  fileName,
  language,
  className,
  footer,
}: CodePreviewProps) {
  ensureLangs();

  const [theme, setTheme] = useState<"light" | "dark">(readDocTheme);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(readDocTheme());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  const lang = useMemo(() => {
    if (language && language !== "auto") return language;
    if (fileName) return languageFromFileName(fileName);
    return "plaintext";
  }, [language, fileName]);

  const html = useMemo(() => {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true })
          .value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      // Escape minimal HTML if highlight fails
      return code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }, [code, lang]);

  const lines = useMemo(() => {
    // Keep trailing newline as empty last line for gutter count
    const parts = code.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
    return Math.max(parts.length, 1);
  }, [code]);

  return (
    <div
      className={cn(
        "rp-code",
        theme === "light" ? "rp-code--light" : "rp-code--dark",
        className,
      )}
      data-language={lang}
    >
      <div className="rp-code__scroll">
        <div className="rp-code__gutter" aria-hidden>
          {Array.from({ length: lines }, (_, i) => (
            <span key={i} className="rp-code__ln">
              {i + 1}
            </span>
          ))}
        </div>
        <pre className="rp-code__pre">
          <code
            className={`hljs language-${lang}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
      </div>
      {footer ? <div className="rp-code__footer">{footer}</div> : null}
    </div>
  );
}
