/**
 * Color skins on top of dark/light (inspired by Codex Dream Skin presets).
 * Skins only remap design tokens via `data-skin` — they do not inject foreign CSS
 * or touch native chrome beyond optional preferred appearance.
 *
 * Optional custom wallpaper: user image / video / animated gif → persisted as a
 * Blob in IndexedDB (large payloads, durable across restarts) with a tiny meta
 * mirror in localStorage for synchronous boot (so the shell can flip to
 * transparent + scrim before React mounts). Rendered by a React media layer
 * (`<video>` / `<img>`) with `object-fit: cover`, so the browser crops to the
 * window at render time — the source asset is never mutated.
 */

import type { Theme } from "./theme";

export type ThemeSkinId =
  | "default"
  | "rose"
  | "gothic"
  | "mist"
  | "ocean"
  | "ember";

export type ThemeSkinAppearance = "auto" | Theme;

export interface ThemeSkinMeta {
  id: ThemeSkinId;
  /** Swatch shown in Settings (accent sample). */
  swatch: string;
  /** Secondary swatch for dual-tone preview. */
  swatchAlt: string;
  /**
   * When not `auto`, selecting the skin also switches dark/light
   * (Dream Skin pins appearance for art that only works in one shell).
   */
  appearance: ThemeSkinAppearance;
}

export const SKIN_STORAGE_KEY = "pi-app.skin";
export const WALLPAPER_STORAGE_KEY = "pi-app.wallpaper";
/** Scrim strength over wallpaper only (0 = clear wallpaper, 100 = full dim). */
export const WALLPAPER_SCRIM_STORAGE_KEY = "pi-app.wallpaper-scrim";
/** Keeps the built-in landscape visible while preserving chrome contrast. */
export const DEFAULT_WALLPAPER_SCRIM = 68;
export const DEFAULT_SKIN: ThemeSkinId = "default";

/** Accept common image types + short-loop video for wallpaper upload. */
export const WALLPAPER_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/jpg,video/mp4,video/webm";

/** Longest edge after compress for still images (keeps IDB payload modest). */
export const WALLPAPER_MAX_EDGE = 1920;

/** Max still-image blob bytes after JPEG compress (~1.6 MiB payload). */
export const WALLPAPER_MAX_IMAGE_BYTES = 1_600_000;

/** Reject image / gif source files larger than this before decode. */
export const WALLPAPER_MAX_SOURCE_BYTES = 12 * 1024 * 1024;

/** Reject video source files larger than this (videos are stored as-is). */
export const WALLPAPER_MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** Video mimetypes we accept for wallpaper (browser can autoplay when muted). */
export const WALLPAPER_ALLOWED_VIDEO_MIMES: ReadonlySet<string> = new Set([
  "video/mp4",
  "video/webm",
]);

/**
 * Built-in packs — ids stable for persistence.
 * All skins use appearance: "auto" so light/dark is user-controlled only
 * (selecting a skin never flips shell mode).
 */
export const THEME_SKINS: readonly ThemeSkinMeta[] = [
  {
    id: "default",
    swatch: "#8aa4ff",
    swatchAlt: "#3d5fd9",
    appearance: "auto",
  },
  {
    id: "rose",
    /* Salon blush — carmine on dusty mauve */
    swatch: "#d4536a",
    swatchAlt: "#9b6b7c",
    appearance: "auto",
  },
  {
    id: "gothic",
    /* Cathedral brass on oxblood — works in light parchment too */
    swatch: "#c4a35a",
    swatchAlt: "#6b2e2a",
    appearance: "auto",
  },
  {
    id: "mist",
    /* Nordic fog — cool sage + slate */
    swatch: "#6f8f8a",
    swatchAlt: "#5a6b78",
    appearance: "auto",
  },
  {
    id: "ocean",
    /* Deep harbor — teal-cyan, distinct from default periwinkle */
    swatch: "#2eb8c7",
    swatchAlt: "#1a5f8a",
    appearance: "auto",
  },
  {
    id: "ember",
    /* Forge coal — copper flame */
    swatch: "#e8893a",
    swatchAlt: "#5c2a18",
    appearance: "auto",
  },
] as const;

const SKIN_IDS = new Set<string>(THEME_SKINS.map((s) => s.id));

export function isThemeSkinId(value: unknown): value is ThemeSkinId {
  return typeof value === "string" && SKIN_IDS.has(value);
}

export function parseThemeSkin(raw: unknown): ThemeSkinId {
  if (isThemeSkinId(raw)) return raw;
  return DEFAULT_SKIN;
}

export function getThemeSkinMeta(id: ThemeSkinId): ThemeSkinMeta {
  return THEME_SKINS.find((s) => s.id === id) ?? THEME_SKINS[0]!;
}

export interface SkinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadSkin(storage: SkinStorage): ThemeSkinId {
  try {
    return parseThemeSkin(storage.getItem(SKIN_STORAGE_KEY));
  } catch {
    return DEFAULT_SKIN;
  }
}

export function saveSkin(storage: SkinStorage, skin: ThemeSkinId): void {
  storage.setItem(SKIN_STORAGE_KEY, skin);
}

/** Minimal DOM surface so unit tests need no jsdom. */
export interface SkinRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style?: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
}

/** Apply skin id to documentElement (`data-skin`). */
export function applySkinToDocument(
  skin: ThemeSkinId,
  root: SkinRoot = document.documentElement,
): void {
  if (skin === DEFAULT_SKIN) {
    root.removeAttribute("data-skin");
  } else {
    root.setAttribute("data-skin", skin);
  }
}

/**
 * Clamp wallpaper scrim strength to 0–100 (integer).
 * 0 = no dimming (wallpaper fully clear); 100 = full built-in scrim.
 */
export function parseWallpaperScrim(raw: unknown): number {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_WALLPAPER_SCRIM;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function loadWallpaperScrim(
  storage: SkinStorage = localStorage,
): number {
  try {
    return parseWallpaperScrim(storage.getItem(WALLPAPER_SCRIM_STORAGE_KEY));
  } catch {
    return DEFAULT_WALLPAPER_SCRIM;
  }
}

export function saveWallpaperScrim(
  storage: SkinStorage,
  value: number,
): void {
  storage.setItem(WALLPAPER_SCRIM_STORAGE_KEY, String(parseWallpaperScrim(value)));
}

/**
 * Apply scrim strength as CSS vars on the root.
 * Scales the full-window veil, pane/settings fills, and sidebar blur.
 * Text and control fills stay solid (they do not read these variables).
 *
 * Derived mix/%/px vars avoid flaky `calc(% * var)` inside `color-mix`
 * in some WebViews. At 0, also sets `data-wallpaper-clear` so CSS can force
 * fully transparent pane fills (some engines leave a residual from 0% mix).
 */
export function applyWallpaperScrimToDocument(
  value: number,
  root: SkinRoot = document.documentElement,
): void {
  const next = parseWallpaperScrim(value);
  const t = next / 100;
  if (next <= 0) {
    root.setAttribute("data-wallpaper-clear", "1");
  } else {
    root.removeAttribute("data-wallpaper-clear");
  }
  if (!root.style?.setProperty) return;
  root.style.setProperty("--wallpaper-scrim-opacity", t.toFixed(3));
  root.style.setProperty(
    "--wallpaper-mix-sidebar",
    `${Math.round(58 * t)}%`,
  );
  root.style.setProperty("--wallpaper-mix-main", `${Math.round(70 * t)}%`);
  root.style.setProperty("--wallpaper-mix-aside", `${Math.round(70 * t)}%`);
  root.style.setProperty(
    "--wallpaper-mix-settings",
    `${Math.round(78 * t)}%`,
  );
  root.style.setProperty(
    "--wallpaper-sidebar-blur",
    `${(22 * t).toFixed(1)}px`,
  );
}

/**
 * Resolve whether picking this skin should also flip dark/light.
 * `auto` → null (keep current theme).
 */
export function skinPreferredTheme(skin: ThemeSkinId): Theme | null {
  const appearance = getThemeSkinMeta(skin).appearance;
  if (appearance === "auto") return null;
  return appearance;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Wallpaper — Blob persisted in IndexedDB; meta mirrored to localStorage.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WallpaperKind = "image" | "video";

export interface WallpaperMeta {
  kind: WallpaperKind;
  /** Original mime (e.g. image/jpeg, image/gif, video/mp4). */
  mime: string;
  /** Original filename, for display in Settings. */
  name: string;
  /** Epoch ms when stored. */
  createdAt: number;
}

export interface WallpaperRecord extends WallpaperMeta {
  blob: Blob;
}

/**
 * Blob persistence backend. The real implementation uses IndexedDB; tests inject
 * an in-memory variant so no jsdom / fake-indexeddb is needed.
 */
export interface WallpaperBlobStorage {
  get(): Promise<Blob | null>;
  set(blob: Blob): Promise<void>;
  clear(): Promise<void>;
}

const IDB_NAME = "pi-app";
const IDB_VERSION = 1;
const IDB_STORE = "wallpaper";
const IDB_KEY = "current";

function openWallpaperIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function idbTx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, mode);
    const req = run(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req.result as T | null);
    tx.onerror = () => resolve(null);
    tx.onabort = () => resolve(null);
  });
}

/** Default Blob storage backed by IndexedDB (browser runtime only). */
export const idbWallpaperBlobStorage: WallpaperBlobStorage = {
  async get() {
    const db = await openWallpaperIdb();
    if (!db) return null;
    return (await idbTx<Blob>(db, "readonly", (s) => s.get(IDB_KEY))) ?? null;
  },
  async set(blob: Blob) {
    const db = await openWallpaperIdb();
    if (!db) return;
    await idbTx(db, "readwrite", (s) => s.put(blob, IDB_KEY));
  },
  async clear() {
    const db = await openWallpaperIdb();
    if (!db) return;
    // Clear the whole store so no orphan wallpaper blobs keep disk quota.
    await idbTx(db, "readwrite", (s) => s.clear());
  },
};

/** In-memory Blob storage for unit tests (no IndexedDB required). */
export function memoryWallpaperBlobStorage(): WallpaperBlobStorage & {
  _blob: Blob | null;
} {
  let blob: Blob | null = null;
  return {
    _blob: null as Blob | null,
    async get() {
      return blob;
    },
    async set(b: Blob) {
      blob = b;
      this._blob = b;
    },
    async clear() {
      blob = null;
      this._blob = null;
    },
  };
}

interface WallpaperOptions {
  blobs?: WallpaperBlobStorage;
  meta?: SkinStorage;
}

function optsMeta(opts?: WallpaperOptions): SkinStorage {
  return opts?.meta ?? localStorage;
}

function optsBlobs(opts?: WallpaperOptions): WallpaperBlobStorage {
  return opts?.blobs ?? idbWallpaperBlobStorage;
}

/** Read wallpaper meta synchronously from localStorage (for boot, no flash). */
export function loadWallpaperMeta(
  storage: SkinStorage = localStorage,
): WallpaperMeta | null {
  try {
    const raw = storage.getItem(WALLPAPER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return normalizeWallpaperMeta(parsed);
  } catch {
    return null;
  }
}

function normalizeWallpaperMeta(value: unknown): WallpaperMeta | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const kind = v.kind;
  const mime = v.mime;
  const name = v.name;
  const createdAt = v.createdAt;
  if (kind !== "image" && kind !== "video") return null;
  if (typeof mime !== "string" || typeof name !== "string") return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  return { kind, mime, name, createdAt };
}

function writeWallpaperMeta(
  storage: SkinStorage,
  meta: WallpaperMeta | null,
): void {
  if (!meta) {
    try {
      storage.setItem(WALLPAPER_STORAGE_KEY, "");
    } catch {
      /* ignore */
    }
    const rem = storage as SkinStorage & { removeItem?(k: string): void };
    try {
      rem.removeItem?.(WALLPAPER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  storage.setItem(WALLPAPER_STORAGE_KEY, JSON.stringify(meta));
}

/** Read full record (meta from localStorage + blob from IDB). */
export async function loadWallpaperRecord(
  opts?: WallpaperOptions,
): Promise<WallpaperRecord | null> {
  const metaStore = optsMeta(opts);
  const blobStore = optsBlobs(opts);
  const meta = loadWallpaperMeta(metaStore);
  const blob = await blobStore.get();

  // Split-brain / orphan cleanup so removed wallpapers do not keep quota:
  // meta without blob → drop meta; blob without meta → drop blob.
  if (meta && !blob) {
    writeWallpaperMeta(metaStore, null);
    return null;
  }
  if (!meta && blob) {
    await blobStore.clear();
    return null;
  }
  if (!meta || !blob) return null;
  return { ...meta, blob };
}

/** Persist record: blob → IDB, meta → localStorage. */
export async function saveWallpaper(
  record: WallpaperRecord,
  opts?: WallpaperOptions,
): Promise<void> {
  const { blob, ...meta } = record;
  writeWallpaperMeta(optsMeta(opts), meta);
  await optsBlobs(opts).set(blob);
}

/**
 * Clear both blob (IDB) and meta (localStorage).
 * After this, no wallpaper payload should remain on disk / in quota.
 */
export async function clearWallpaper(opts?: WallpaperOptions): Promise<void> {
  writeWallpaperMeta(optsMeta(opts), null);
  await optsBlobs(opts).clear();
}

/**
 * Toggle the `data-wallpaper` flag on `<html>`. Called from `main.tsx` for the
 * synchronous boot flag, and from `App.tsx` when the user changes wallpaper.
 * The actual media layer is rendered by React — this only drives CSS
 * (shell transparency + scrim + pane translucency).
 */
export function applyWallpaperFlag(
  present: boolean,
  root: SkinRoot = document.documentElement,
): void {
  if (present) {
    root.setAttribute("data-wallpaper", "1");
  } else {
    root.removeAttribute("data-wallpaper");
  }
}

export type WallpaperPrepareErrorCode =
  | "not_image"
  | "too_large"
  | "decode_failed"
  | "compress_failed"
  | "still_too_large"
  | "unsupported_video"
  | "video_too_large";

export class WallpaperPrepareError extends Error {
  readonly code: WallpaperPrepareErrorCode;
  constructor(code: WallpaperPrepareErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WallpaperPrepareError";
    this.code = code;
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new WallpaperPrepareError("decode_failed"));
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new WallpaperPrepareError("decode_failed"));
        return;
      }
      resolve(r);
    };
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new WallpaperPrepareError("decode_failed"));
    img.src = src;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new WallpaperPrepareError("compress_failed")),
      type,
      quality,
    );
  });
}

/**
 * Read a user-picked image / gif / video and return a durable WallpaperRecord.
 * - video/mp4|webm: stored as-is (browser can't re-encode); size-capped.
 * - image/gif: stored as-is to preserve animation.
 * - other still images: downscaled + JPEG-compressed to cap IDB payload.
 * Throws {@link WallpaperPrepareError} on validation / encode failure.
 */
export async function prepareWallpaperFromFile(file: File): Promise<WallpaperRecord> {
  const type = (file.type || "").toLowerCase();
  const name = file.name || "wallpaper";
  const createdAt = Date.now();

  // Video — store original (no in-browser transcode).
  if (type.startsWith("video/")) {
    if (!WALLPAPER_ALLOWED_VIDEO_MIMES.has(type)) {
      throw new WallpaperPrepareError("unsupported_video");
    }
    if (file.size > WALLPAPER_MAX_VIDEO_BYTES) {
      throw new WallpaperPrepareError("video_too_large");
    }
    return { kind: "video", mime: type, name, createdAt, blob: file };
  }

  // Animated gif — preserve original blob so frames keep playing.
  if (type === "image/gif") {
    if (file.size > WALLPAPER_MAX_SOURCE_BYTES) {
      throw new WallpaperPrepareError("too_large");
    }
    return { kind: "image", mime: type, name, createdAt, blob: file };
  }

  // Still image — downscale + JPEG compress.
  const nameOk = /\.(jpe?g|png|webp)$/i.test(name);
  if (type && !type.startsWith("image/")) {
    throw new WallpaperPrepareError("not_image");
  }
  if (!type.startsWith("image/") && !nameOk) {
    throw new WallpaperPrepareError("not_image");
  }
  if (file.size > WALLPAPER_MAX_SOURCE_BYTES) {
    throw new WallpaperPrepareError("too_large");
  }

  const rawUrl = await readFileAsDataUrl(file);
  const img = await loadHtmlImage(rawUrl);
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) throw new WallpaperPrepareError("decode_failed");

  const scale = Math.min(1, WALLPAPER_MAX_EDGE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new WallpaperPrepareError("compress_failed");
  ctx.drawImage(img, 0, 0, w, h);

  // Prefer JPEG for photos; keep reducing quality until under the byte cap.
  let quality = 0.85;
  let blob = await canvasToBlob(canvas, "image/jpeg", quality);
  while (blob.size > WALLPAPER_MAX_IMAGE_BYTES && quality > 0.45) {
    quality -= 0.1;
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
  }
  if (blob.size > WALLPAPER_MAX_IMAGE_BYTES) {
    throw new WallpaperPrepareError("still_too_large");
  }
  return { kind: "image", mime: "image/jpeg", name, createdAt, blob };
}
