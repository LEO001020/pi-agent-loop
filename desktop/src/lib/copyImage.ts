/**
 * Copy an image (from URL / data URL / asset protocol) onto the system clipboard.
 * ClipboardItem typically requires image/png — we convert when needed.
 */

import { resolveImageSrc } from "@/lib/imageSrc";

export type CopyImageResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "fetch" | "encode" | "write" };

function canWriteImage(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.clipboard &&
    typeof ClipboardItem !== "undefined"
  );
}

/** Draw arbitrary image blob into a PNG blob (clipboard-friendly). */
async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!png) throw new Error("toBlob failed");
    return png;
  } finally {
    bitmap.close();
  }
}

/**
 * Copy image at `src` (viewable URL) to clipboard as PNG.
 */
export async function copyImageFromSrc(src: string): Promise<CopyImageResult> {
  if (!canWriteImage()) return { ok: false, reason: "unsupported" };

  let blob: Blob;
  try {
    const res = await fetch(src);
    if (!res.ok) return { ok: false, reason: "fetch" };
    blob = await res.blob();
  } catch {
    return { ok: false, reason: "fetch" };
  }

  let png: Blob;
  try {
    png = await blobToPng(blob);
  } catch {
    return { ok: false, reason: "encode" };
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png }),
    ]);
    return { ok: true };
  } catch {
    return { ok: false, reason: "write" };
  }
}

/**
 * Copy image from a local absolute path (or already-viewable URL).
 */
export async function copyImageFromPath(
  pathOrUrl: string,
): Promise<CopyImageResult> {
  const src = await resolveImageSrc(pathOrUrl);
  if (!src) return { ok: false, reason: "fetch" };
  return copyImageFromSrc(src);
}
