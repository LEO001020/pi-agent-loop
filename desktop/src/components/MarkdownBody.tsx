/**
 * Assistant message body — GFM markdown with safe defaults.
 * Images open the global lightbox; videos play inline; right-click menus.
 * Path links/code become media cards when imagePathMap is set.
 */

import { useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Locale } from "@/i18n";
import { ImageUi, imageUiLabels } from "@/components/ImageUi";
import { VideoUi, videoUiLabels } from "@/components/VideoUi";
import {
  isImagePath,
  isVideoPath,
  pathBasename,
  resolveInlineMediaToken,
  resolveMediaHref,
} from "@/lib/attachments";

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

export function MarkdownBody({
  children,
  streaming,
  locale = "en",
  imagePathMap,
}: {
  children: string;
  streaming?: boolean;
  locale?: Locale;
  imagePathMap?: Record<string, string>;
}) {
  const imageLabels = useMemo(() => imageUiLabels(locale), [locale]);
  const videoLabels = useMemo(() => videoUiLabels(locale), [locale]);
  const gallery = useMemo(() => {
    if (!imagePathMap) return undefined;
    return Array.from(new Set(Object.values(imagePathMap))).filter(isImagePath);
  }, [imagePathMap]);

  const renderMedia = (abs: string, alt?: string) => {
    if (isVideoPath(abs)) {
      return (
        <VideoUi
          src={abs}
          path={abs}
          title={alt || pathBasename(abs)}
          labels={videoLabels}
        />
      );
    }
    return (
      <ImageUi
        className="md-body__img md-body__img--card"
        src={abs}
        alt={alt || pathBasename(abs)}
        path={abs}
        gallery={gallery}
        labels={imageLabels}
      />
    );
  };

  return (
    <div
      className={
        "md-body" + (streaming ? " md-body--streaming" : "")
      }
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => {
            const text = textFromChildren(c).trim();
            const abs = resolveMediaHref(href, text, imagePathMap);
            if (abs) return renderMedia(abs, text || pathBasename(abs));
            return (
              <a href={href} target="_blank" rel="noreferrer noopener">
                {c}
              </a>
            );
          },
          pre: ({ children: c }) => <pre className="md-body__pre">{c}</pre>,
          code: ({ className, children: c }) => {
            const inline = !className;
            if (inline) {
              const raw = textFromChildren(c).replace(/\n$/, "").trim();
              const abs = resolveInlineMediaToken(raw, imagePathMap);
              if (abs) return renderMedia(abs, pathBasename(abs));
              return <code className="md-body__code-inline">{c}</code>;
            }
            return <code className={className}>{c}</code>;
          },
          img: ({ src, alt }) => {
            if (!src) return null;
            const mapped =
              resolveInlineMediaToken(src, imagePathMap) ?? src;
            if (isVideoPath(mapped)) {
              return renderMedia(
                mapped,
                typeof alt === "string" ? alt : pathBasename(mapped),
              );
            }
            const local =
              mapped.startsWith("/") || /^[A-Za-z]:[\\/]/.test(mapped)
                ? mapped
                : undefined;
            return (
              <ImageUi
                className="md-body__img md-body__img--card"
                src={mapped}
                alt={alt ?? ""}
                path={local}
                gallery={gallery}
                labels={imageLabels}
              />
            );
          },
          table: ({ children: c }) => (
            <div className="md-body__table-wrap">
              <table>{c}</table>
            </div>
          ),
        }}
      >
        {children || (streaming ? " " : "")}
      </ReactMarkdown>
    </div>
  );
}
