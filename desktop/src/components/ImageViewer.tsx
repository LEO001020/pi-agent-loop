/**
 * Global image lightbox (yet-another-react-lightbox) + open/copy helpers.
 * Zoom, prev/next, counter; right-click on the active slide copies the image.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import Counter from "yet-another-react-lightbox/plugins/counter";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";
import { resolveImageSrc, resolveImageSrcs } from "@/lib/imageSrc";
import { copyImageFromSrc } from "@/lib/copyImage";
import { createT, type Locale } from "@/i18n";

export interface ImageSlideInput {
  /** Local absolute path or already-viewable URL. */
  src: string;
  alt?: string;
  title?: string;
}

export interface ImageViewerApi {
  /** Open lightbox with slides (paths or URLs). Resolves local paths async. */
  open: (slides: ImageSlideInput[] | string[], index?: number) => void;
  close: () => void;
  /** Copy image at path/URL to clipboard. Returns true on success. */
  copyImage: (pathOrUrl: string) => Promise<boolean>;
}

const ImageViewerContext = createContext<ImageViewerApi | null>(null);

export function useImageViewer(): ImageViewerApi {
  const ctx = useContext(ImageViewerContext);
  if (!ctx) {
    throw new Error("useImageViewer must be used within ImageViewerProvider");
  }
  return ctx;
}

/** Safe hook when provider may be absent (returns no-ops). */
export function useImageViewerOptional(): ImageViewerApi {
  const ctx = useContext(ImageViewerContext);
  return (
    ctx ?? {
      open: () => {},
      close: () => {},
      copyImage: async () => false,
    }
  );
}

interface ResolvedSlide {
  src: string;
  alt?: string;
  title?: string;
  /** Original path/url for copy. */
  origin: string;
}

interface ImageViewerProviderProps {
  children: ReactNode;
  locale: Locale;
}

export function ImageViewerProvider({
  children,
  locale,
}: ImageViewerProviderProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [slides, setSlides] = useState<ResolvedSlide[]>([]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const openViewer = useCallback(
    (input: ImageSlideInput[] | string[], startIndex = 0) => {
      const normalized: ImageSlideInput[] = input.map((item) =>
        typeof item === "string" ? { src: item } : item,
      );
      if (!normalized.length) return;

      void (async () => {
        const paths = normalized.map((s) => s.src);
        const resolved = await resolveImageSrcs(paths);
        if (!resolved.length) return;

        const meta = new Map(normalized.map((s) => [s.src, s] as const));
        const next: ResolvedSlide[] = resolved.map(({ path, src }) => {
          const m = meta.get(path);
          return {
            src,
            origin: path,
            alt: m?.alt ?? m?.title,
            title: m?.title,
          };
        });

        const want =
          normalized[Math.min(startIndex, normalized.length - 1)]?.src;
        let idx = next.findIndex((s) => s.origin === want);
        if (idx < 0) idx = 0;

        setSlides(next);
        setIndex(idx);
        setIsOpen(true);
      })();
    },
    [],
  );

  const copyImage = useCallback(async (pathOrUrl: string) => {
    const src = await resolveImageSrc(pathOrUrl);
    if (!src) return false;
    const r = await copyImageFromSrc(src);
    return r.ok;
  }, []);

  const api = useMemo<ImageViewerApi>(
    () => ({
      open: openViewer,
      close,
      copyImage,
    }),
    [openViewer, close, copyImage],
  );

  // Right-click inside lightbox → copy current image (keeps Zoom plugin intact).
  useEffect(() => {
    if (!isOpen) return;
    const onCtx = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.(".yarl__root")) return;
      const img = target.closest("img") as HTMLImageElement | null;
      if (!img) return;
      const src = img.currentSrc || img.src;
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      void copyImageFromSrc(src);
    };
    document.addEventListener("contextmenu", onCtx, true);
    return () => document.removeEventListener("contextmenu", onCtx, true);
  }, [isOpen]);

  return (
    <ImageViewerContext.Provider value={api}>
      {children}
      <Lightbox
        open={isOpen}
        close={close}
        index={index}
        slides={slides.map((s) => ({
          src: s.src,
          alt: s.alt ?? s.title,
          title: s.title,
        }))}
        on={{
          view: ({ index: i }) => setIndex(i),
        }}
        plugins={[Zoom, Counter]}
        zoom={{
          maxZoomPixelRatio: 4,
          scrollToZoom: true,
        }}
        carousel={{
          finite: slides.length <= 1,
          preload: 2,
        }}
        controller={{
          closeOnBackdropClick: true,
        }}
        styles={{
          container: { backgroundColor: "rgba(0, 0, 0, 0.92)" },
        }}
        labels={{
          Next: tr("image.next"),
          Previous: tr("image.prev"),
          Close: tr("image.close"),
          "Zoom in": tr("image.zoomIn"),
          "Zoom out": tr("image.zoomOut"),
        }}
      />
    </ImageViewerContext.Provider>
  );
}
