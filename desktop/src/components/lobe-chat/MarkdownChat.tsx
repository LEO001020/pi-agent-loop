/**
 * Chat markdown — path/url → cards (image/video/file); open in resource pane.
 */

import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { ImageUi, imageUiLabels } from "@/components/ImageUi";
import { VideoUi, videoUiLabels } from "@/components/VideoUi";
import { FilePathCard } from "@/components/FilePathCard";
import type { ResourceOpenTarget } from "@/components/ResourceViewer";
import { HighlightedText } from "@/components/HighlightedText";
import {
  isImagePath,
  isVideoPath,
  pathBasename,
  resolveInlineMediaToken,
} from "@/lib/attachments";
import {
  classifyPathRef,
  fileSubtitle,
  isAbsoluteFsPath,
  isHttpUrl,
  looksLikeFilePath,
  normalizePathToken,
  resolveFileToken,
} from "@/lib/pathRefs";
import { useSmoothStream } from "@/hooks/useSmoothStream";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";

/** Highlight string leaves for in-chat find (markdown-safe). */
function highlightChildren(
  children: ReactNode,
  query: string,
  activeOccurrence: number | null | undefined,
  counter: { n: number },
): ReactNode {
  const q = query.trim();
  if (!q) return children;
  if (typeof children === "string" || typeof children === "number") {
    const text = String(children);
    const base = counter.n;
    // Count matches in this leaf so subsequent leaves get correct indices.
    const lower = text.toLowerCase();
    const qLower = q.toLowerCase();
    let from = 0;
    let local = 0;
    while (from < lower.length) {
      const at = lower.indexOf(qLower, from);
      if (at < 0) break;
      local += 1;
      from = at + q.length;
    }
    const activeLocal =
      activeOccurrence != null &&
      activeOccurrence >= base &&
      activeOccurrence < base + local
        ? activeOccurrence - base
        : null;
    counter.n += local;
    if (local === 0) return text;
    return (
      <HighlightedText
        text={text}
        query={q}
        activeOccurrence={activeLocal}
      />
    );
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => (
      <span key={i}>
        {highlightChildren(c, query, activeOccurrence, counter)}
      </span>
    ));
  }
  return children;
}

function softCloseMarkdown(src: string, streaming: boolean): string {
  if (!streaming || !src) return src;
  let s = src;
  const fenceCount = (s.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) s += "\n```";
  return s;
}

function textFromChildren(children: ReactNode): string {
  if (children == null || children === false) return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromChildren).join("");
  }
  return "";
}

export const MarkdownChat = memo(function MarkdownChat({
  children,
  streaming = false,
  locale = "en",
  className,
  muted,
  imagePathMap,
  projectPath,
  onOpenResource,
  findQuery = "",
  findActiveOccurrence = null,
  findOccurrenceBase = 0,
}: {
  children: string;
  streaming?: boolean;
  locale?: Locale;
  className?: string;
  muted?: boolean;
  imagePathMap?: Record<string, string>;
  projectPath?: string | null;
  onOpenResource?: (target: ResourceOpenTarget) => void;
  /** In-chat find query — highlights string leaves in markdown. */
  findQuery?: string;
  findActiveOccurrence?: number | null;
  /** Starting occurrence index for multi-segment assistant bodies. */
  findOccurrenceBase?: number;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const imageLabels = useMemo(() => imageUiLabels(locale), [locale]);
  const videoLabels = useMemo(() => videoUiLabels(locale), [locale]);
  const fileLabels = useMemo(
    () => ({
      open: tr("attach.open"),
      reveal: tr("attach.reveal"),
      copyPath: tr("attach.copyPath"),
      openInPanel: tr("resources.openInPanel"),
      openExternal: tr("resources.openExternal"),
      details: tr("attach.details"),
      detailsTitle: tr("attach.detailsTitle"),
      detailsName: tr("attach.detailsName"),
      detailsType: tr("attach.detailsType"),
      detailsPath: tr("attach.detailsPath"),
      detailsResolved: tr("attach.detailsResolved"),
      detailsStatus: tr("attach.detailsStatus"),
      detailsMissing: tr("attach.detailsMissing"),
      detailsOk: tr("attach.detailsOk"),
      detailsClose: tr("attach.detailsClose"),
      typeFile: tr("attach.typeFile"),
      typeUrl: tr("attach.typeUrl"),
      typeDir: tr("attach.typeDir"),
    }),
    [tr],
  );
  const gallery = useMemo(() => {
    if (!imagePathMap) return undefined;
    return Array.from(new Set(Object.values(imagePathMap))).filter(isImagePath);
  }, [imagePathMap]);

  // Adaptive buffer: drip when sparse, catch up hard on large dumps.
  const smoothChildren = useSmoothStream(children, streaming);
  const source = softCloseMarkdown(
    smoothChildren || (streaming ? " " : ""),
    streaming,
  );

  const renderPathOrUrl = (token: string, linkText?: string) => {
    const rawIn = token.trim().replace(/^<|>$/g, "");
    if (!rawIn) return null;
    // Prefer ellipsis-stripped form for open/search; keep original for display map
    const raw = normalizePathToken(rawIn) || rawIn;

    if (isHttpUrl(rawIn) || isHttpUrl(raw)) {
      const url = isHttpUrl(rawIn) ? rawIn : raw;
      return (
        <FilePathCard
          path={url}
          kind="url"
          projectPath={projectPath}
          labels={fileLabels}
          onOpenInPanel={(t) => {
            if (t.type === "url" && t.url) {
              onOpenResource?.({ type: "url", url: t.url, title: t.title });
            }
          }}
        />
      );
    }

    const mediaAbs =
      resolveInlineMediaToken(raw, imagePathMap) ||
      resolveInlineMediaToken(rawIn, imagePathMap);
    if (mediaAbs && isImagePath(mediaAbs)) {
      return (
        <ImageUi
          className="md-body__img md-body__img--card"
          src={mediaAbs}
          alt={linkText || pathBasename(mediaAbs)}
          path={mediaAbs}
          gallery={gallery}
          labels={imageLabels}
        />
      );
    }
    if (mediaAbs && isVideoPath(mediaAbs)) {
      return (
        <VideoUi
          src={mediaAbs}
          path={mediaAbs}
          title={linkText || pathBasename(mediaAbs)}
          labels={videoLabels}
        />
      );
    }

    if (!looksLikeFilePath(rawIn) && !looksLikeFilePath(raw) && !mediaAbs) {
      return null;
    }

    // No naive projectRoot+relative join — FilePathCard uses host smart open.
    const resolved =
      mediaAbs ||
      resolveFileToken(raw, { projectPath, pathMap: imagePathMap }) ||
      resolveFileToken(rawIn, { projectPath, pathMap: imagePathMap });
    if (
      !resolved &&
      !looksLikeFilePath(raw) &&
      !looksLikeFilePath(rawIn)
    ) {
      return null;
    }

    // Prefer multi-segment relative after ellipsis strip for smart open
    const pathToken = resolved || raw || rawIn;
    const kind = classifyPathRef(pathToken);
    // Only inline media when we already have an absolute path; relative
    // tokens go through FilePathCard → host smart open (sibling KB / suffix).
    if (
      kind === "image" &&
      resolved &&
      isAbsoluteFsPath(resolved) &&
      isImagePath(resolved)
    ) {
      return (
        <ImageUi
          className="md-body__img md-body__img--card"
          src={resolved}
          alt={linkText || pathBasename(resolved)}
          path={resolved}
          gallery={gallery}
          labels={imageLabels}
        />
      );
    }
    if (
      kind === "video" &&
      resolved &&
      isAbsoluteFsPath(resolved) &&
      isVideoPath(resolved)
    ) {
      return (
        <VideoUi
          src={resolved}
          path={resolved}
          title={linkText || pathBasename(resolved)}
          labels={videoLabels}
        />
      );
    }

    return (
      <FilePathCard
        path={pathToken}
        absolutePath={
          resolved && isAbsoluteFsPath(resolved) ? resolved : undefined
        }
        projectPath={projectPath}
        kind="file"
        subtitle={fileSubtitle(pathToken)}
        labels={fileLabels}
        onOpenInPanel={(t) => {
          if (t.type === "file" && t.path) {
            onOpenResource?.({ type: "file", path: t.path, title: t.title });
          }
        }}
      />
    );
  };

  // Fresh counter each render so occurrence indices stay stable for the mark.
  const findCounter = { n: findOccurrenceBase };
  const qFind = findQuery.trim();
  const paint = (node: ReactNode) =>
    qFind
      ? highlightChildren(node, qFind, findActiveOccurrence, findCounter)
      : node;

  return (
    <div
      className={cn(
        "chat-md",
        muted && "chat-md--muted",
        streaming && "chat-md--streaming",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children: c }) => <p>{paint(c)}</p>,
          li: ({ children: c }) => <li>{paint(c)}</li>,
          strong: ({ children: c }) => <strong>{paint(c)}</strong>,
          em: ({ children: c }) => <em>{paint(c)}</em>,
          h1: ({ children: c }) => <h1>{paint(c)}</h1>,
          h2: ({ children: c }) => <h2>{paint(c)}</h2>,
          h3: ({ children: c }) => <h3>{paint(c)}</h3>,
          h4: ({ children: c }) => <h4>{paint(c)}</h4>,
          blockquote: ({ children: c }) => (
            <blockquote>{paint(c)}</blockquote>
          ),
          td: ({ children: c }) => <td>{paint(c)}</td>,
          th: ({ children: c }) => <th>{paint(c)}</th>,
          a: ({ href, children: c }) => {
            const text = textFromChildren(c).trim();
            const hrefStr = typeof href === "string" ? href : "";
            const card =
              (hrefStr && renderPathOrUrl(hrefStr, text)) ||
              (text && text !== hrefStr ? renderPathOrUrl(text) : null);
            if (card) return card;
            return (
              <a
                className="chat-md__link"
                href={href}
                target="_blank"
                rel="noreferrer noopener"
              >
                {paint(c)}
              </a>
            );
          },
          pre: ({ children: c }) => <>{c}</>,
          code: ({ className: cnCode, children: c }) => {
            const match =
              typeof cnCode === "string"
                ? /language-([\w#+-]+)/.exec(cnCode)
                : null;
            const block = Boolean(match) || String(c).includes("\n");
            if (!block) {
              const raw = textFromChildren(c).replace(/\n$/, "").trim();
              const card = renderPathOrUrl(raw);
              if (card) return card;
              return (
                <code className="chat-md__inline-code">{paint(c)}</code>
              );
            }
            return (
              <CodeBlock
                language={match?.[1] || "text"}
                wrapLabel={tr("chat.codeWrap")}
                unwrapLabel={tr("chat.codeUnwrap")}
                copyLabel={tr("message.copy")}
              >
                {c as ReactNode}
              </CodeBlock>
            );
          },
          table: ({ children: c }) => (
            <div className="chat-md__table-wrap">
              <table>{c}</table>
            </div>
          ),
          hr: () => null,
          img: ({ src, alt }) => {
            if (!src || typeof src !== "string") return null;
            const card = renderPathOrUrl(
              src,
              typeof alt === "string" ? alt : undefined,
            );
            if (card) return card;
            return (
              <ImageUi
                className="md-body__img md-body__img--card"
                src={src}
                alt={typeof alt === "string" ? alt : ""}
                labels={imageLabels}
              />
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});
