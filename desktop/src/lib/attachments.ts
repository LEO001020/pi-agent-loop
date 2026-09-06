/**
 * Composer attachments from drag-drop (or future pickers).
 * Sent to the agent as Pi CLI `@path` references.
 *
 * Also: session-relative media path helpers for in-chat image/video cards
 * (`images/1.jpg`, `videos/1.mp4`, markdown links, absolute paths).
 */

export interface Attachment {
  path: string;
  name: string;
  isDir: boolean;
}

/** Merge new items by absolute path (dedupe). */
export function mergeAttachments(
  prev: Attachment[],
  next: Attachment[],
): Attachment[] {
  const map = new Map(prev.map((a) => [a.path, a]));
  for (const a of next) {
    if (!a.path) continue;
    map.set(a.path, a);
  }
  return Array.from(map.values());
}

/**
 * Build the text sent to the agent: user message + `@/abs/path` lines.
 * Empty user text is fine when only files are attached.
 */
export function buildAgentPrompt(
  userText: string,
  attachments: Attachment[],
): string {
  const body = userText.trim();
  if (!attachments.length) return body;
  const refs = attachments.map((a) => `@${a.path}`).join("\n");
  return body ? `${body}\n\n${refs}` : refs;
}

/** Basename without emoji. */
export function pathBasename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

/**
 * Split stored/agent message into display text + attachment list.
 * Lines that are sole `@/abs/path` (or `@path`) become attachments.
 */
export function parseAttachmentsFromContent(content: string): {
  text: string;
  attachments: Attachment[];
} {
  if (!content) return { text: "", attachments: [] };
  const lines = content.split("\n");
  const attachments: Attachment[] = [];
  const textLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // @/path or @C:\path or @path
    const m = trimmed.match(/^@((?:\/|[A-Za-z]:[\\/]).+)$/);
    if (m?.[1]) {
      const path = m[1].trim();
      attachments.push({
        path,
        name: pathBasename(path),
        isDir: false, // refined by pathsClassify when needed
      });
      continue;
    }
    // Legacy display markers from older builds
    const legacy = trimmed.match(/^\[(file|dir)\]\s+(.+)$/i);
    if (legacy?.[2] && !legacy[2].includes("/")) {
      // name-only legacy line — skip as plain text still ok
      textLines.push(line);
      continue;
    }
    textLines.push(line);
  }
  // Drop trailing blank lines left before attachment block
  while (textLines.length && textLines[textLines.length - 1]!.trim() === "") {
    textLines.pop();
  }
  return { text: textLines.join("\n"), attachments };
}

/** File extension lowercase without dot. */
export function pathExt(path: string): string {
  const base = pathBasename(path);
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i + 1).toLowerCase();
}

const IMAGE_EXTS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "heic",
  "avif",
] as const;

const VIDEO_EXTS = [
  "mp4",
  "webm",
  "mov",
  "mkv",
  "m4v",
  "avi",
  "ogv",
  "mpeg",
  "mpg",
] as const;

const IMAGE_EXT_RE = IMAGE_EXTS.join("|");
const VIDEO_EXT_RE = VIDEO_EXTS.join("|");
const MEDIA_EXT_RE = `${IMAGE_EXT_RE}|${VIDEO_EXT_RE}`;

export function isImagePath(path: string): boolean {
  return (IMAGE_EXTS as readonly string[]).includes(pathExt(path));
}

export function isVideoPath(path: string): boolean {
  return (VIDEO_EXTS as readonly string[]).includes(pathExt(path));
}

export function isMediaPath(path: string): boolean {
  return isImagePath(path) || isVideoPath(path);
}

function isAbsoluteFsPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Known relative media roots (agent session + project cwd skill outputs).
 * Prefer longest match when building path-map tails.
 */
export const RELATIVE_MEDIA_ROOTS = [
  "images",
  "image",
  "videos",
  "video",
  "outputs",
  "output",
  "assets",
  "media",
  "generated",
  "exports",
] as const;

/** Session-relative media folder segment from an absolute path (`images/1.jpg`, `outputs/...`). */
export function mediaTailFromPath(abs: string): string | null {
  const norm = abs.replace(/\\/g, "/");
  let best: string | null = null;
  let bestIdx = -1;
  for (const folder of RELATIVE_MEDIA_ROOTS) {
    const marker = `/${folder}/`;
    const idx = norm.toLowerCase().lastIndexOf(marker);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = norm.slice(idx + 1);
    }
  }
  return best;
}

/**
 * Extract absolute local image/video paths mentioned in assistant text
 * (backticks, plain paths). Backtick form allows spaces.
 */
export function extractMediaPathsFromContent(content: string): Attachment[] {
  if (!content) return [];
  const seen = new Set<string>();
  const out: Attachment[] = [];
  const push = (raw: string) => {
    const path = raw.trim();
    if (!path || seen.has(path) || !isMediaPath(path)) return;
    if (!isAbsoluteFsPath(path)) return;
    seen.add(path);
    out.push({ path, name: pathBasename(path), isDir: false });
  };

  const tickRe = new RegExp(
    `\`((?:\\/|[A-Za-z]:[\\\\/])[^\`]+?\\.(?:${MEDIA_EXT_RE}))\``,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = tickRe.exec(content)) !== null) push(m[1] || "");

  const bareRe = new RegExp(
    `(?:^|[\\s"'()])((?:\\/|[A-Za-z]:[\\\\/])[^\\s\`"'<>|*?]+\\.(?:${MEDIA_EXT_RE}))\\b`,
    "gi",
  );
  while ((m = bareRe.exec(content)) !== null) push(m[1] || "");

  return out;
}

/** @deprecated use extractMediaPathsFromContent */
export function extractImagePathsFromContent(content: string): Attachment[] {
  return extractMediaPathsFromContent(content).filter((a) =>
    isImagePath(a.path),
  );
}

/**
 * Project / session relative media paths:
 * - Pi CLI: `images/1.jpg`, `videos/1.mp4` (agent session dir)
 * - Skill outputs: `outputs/xhx-media-gen/foo.png` (project cwd)
 * Also any multi-segment relative path with a media extension (no `..`).
 */
export function extractSessionRelativeMediaRefs(content: string): string[] {
  if (!content) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    let p = raw.trim().replace(/^\.\//, "").replace(/\\/g, "/");
    if (!p || seen.has(p)) return;
    if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) return;
    if (p.includes("..")) return;
    if (!isMediaPath(p)) return;
    // Require at least one directory segment (avoid bare `logo.png`)
    if (!p.includes("/")) return;
    // Reject obvious URL-ish or protocol-ish
    if (p.includes("://")) return;
    seen.add(p);
    out.push(p);
  };

  const folder = `(?:${RELATIVE_MEDIA_ROOTS.join("|")})`;
  // Any multi-segment relative media path (skill outputs under project cwd, etc.)
  const relMedia = `(?:${folder}\\/|[\\w.-]+\\/)[^\\s\`"'<>|*?\\n]+?\\.(?:${MEDIA_EXT_RE})`;

  const tickRe = new RegExp(`\`(${relMedia})\``, "gi");
  let m: RegExpExecArray | null;
  while ((m = tickRe.exec(content)) !== null) push(m[1] || "");

  const linkRe = new RegExp(
    `\\[[^\\]]*\\]\\((${relMedia})\\)`,
    "gi",
  );
  while ((m = linkRe.exec(content)) !== null) push(m[1] || "");

  const bareRe = new RegExp(
    `(?:^|[\\s("'（【])(${relMedia})\\b`,
    "gi",
  );
  while ((m = bareRe.exec(content)) !== null) push(m[1] || "");

  return out;
}

/** @deprecated use extractSessionRelativeMediaRefs */
export function extractSessionRelativeImageRefs(content: string): string[] {
  return extractSessionRelativeMediaRefs(content).filter((p) => isImagePath(p));
}

/**
 * Resolve a markdown link href/text to a local media absolute path when possible.
 */
export function resolveMediaHref(
  href: string | undefined | null,
  linkText: string | undefined | null,
  pathMap?: Record<string, string> | null,
): string | null {
  const candidates = [href, linkText]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  for (const cand of candidates) {
    const cleaned = cand.replace(/^<|>$/g, "");
    const abs = resolveInlineMediaToken(cleaned, pathMap);
    if (abs && isMediaPath(abs)) return abs;
  }
  return null;
}

/** @deprecated use resolveMediaHref */
export function resolveImageHref(
  href: string | undefined | null,
  linkText: string | undefined | null,
  pathMap?: Record<string, string> | null,
): string | null {
  const abs = resolveMediaHref(href, linkText, pathMap);
  return abs && isImagePath(abs) ? abs : abs && isVideoPath(abs) ? abs : abs;
}

/** Join agent session root with a short relative path. */
export function joinSessionMediaPath(
  mediaRoot: string,
  relative: string,
): string {
  const root = mediaRoot.replace(/[/\\]+$/, "");
  const rel = relative.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(root) || root.includes("\\")) {
    return `${root}\\${rel.replace(/\//g, "\\")}`;
  }
  return `${root}/${rel}`;
}

/**
 * Absolute paths from text + optional session-relative refs joined to mediaRoot.
 */
export function mergeMessageAttachments(
  stored: Attachment[] | undefined,
  content: string,
  options?: {
    mediaRoot?: string | null;
    resolvedRelative?: Attachment[];
  },
): Attachment[] | undefined {
  const fromAbs = extractMediaPathsFromContent(content);
  let fromRel: Attachment[] = options?.resolvedRelative ?? [];
  if (!fromRel.length && options?.mediaRoot) {
    fromRel = extractSessionRelativeMediaRefs(content).map((rel) => ({
      path: joinSessionMediaPath(options.mediaRoot!, rel),
      name: pathBasename(rel),
      isDir: false,
    }));
  }
  const merged = mergeAttachments(
    mergeAttachments(stored ?? [], fromAbs),
    fromRel,
  );
  return merged.length ? merged : undefined;
}

export type MessageWithAttachments = {
  role: string;
  content: string;
  attachments?: Attachment[];
};

/**
 * Attach resolved absolute paths for short media refs in assistant text.
 */
export function applyResolvedSessionMedia<T extends MessageWithAttachments>(
  messages: T[],
  resolved: Attachment[],
): T[] {
  if (!resolved.length) return messages;
  const byName = new Map(resolved.map((a) => [a.name, a] as const));
  const byTail = new Map(
    resolved.map((a) => {
      const tail = mediaTailFromPath(a.path) ?? a.name;
      return [tail.replace(/\\/g, "/"), a] as const;
    }),
  );

  let changed = false;
  const next = messages.map((m) => {
    if (m.role !== "assistant" || !m.content) return m;
    const rels = extractSessionRelativeMediaRefs(m.content);
    if (!rels.length) return m;
    const extra: Attachment[] = [];
    for (const rel of rels) {
      const key = rel.replace(/\\/g, "/");
      const hit = byTail.get(key) || byName.get(pathBasename(rel));
      if (hit) extra.push(hit);
    }
    if (!extra.length) return m;
    const attachments = mergeAttachments(m.attachments ?? [], extra);
    if (
      attachments.length === (m.attachments?.length ?? 0) &&
      attachments.every((a, i) => a.path === m.attachments?.[i]?.path)
    ) {
      return m;
    }
    changed = true;
    return { ...m, attachments };
  });
  return changed ? next : messages;
}

/** Collect all session-relative media refs from a message list. */
export function collectSessionRelativeMediaRefs(
  messages: MessageWithAttachments[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || !m.content) continue;
    for (const r of extractSessionRelativeMediaRefs(m.content)) {
      if (seen.has(r)) continue;
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

/** @deprecated use collectSessionRelativeMediaRefs */
export function collectSessionRelativeImageRefs(
  messages: MessageWithAttachments[],
): string[] {
  return collectSessionRelativeMediaRefs(messages);
}

/**
 * Map text tokens (relative short path / basename / absolute) → absolute path
 * for in-place markdown rendering.
 */
export function buildInlineMediaPathMap(
  attachments?: Attachment[] | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of attachments ?? []) {
    if (a.isDir || !isMediaPath(a.path)) continue;
    const abs = a.path;
    map[abs] = abs;
    map[pathBasename(abs)] = abs;
    const tail = mediaTailFromPath(abs);
    if (tail) {
      map[tail] = abs;
      map[tail.toLowerCase()] = abs;
    }
  }
  return map;
}

/** @deprecated use buildInlineMediaPathMap */
export function buildInlineImagePathMap(
  attachments?: Attachment[] | null,
): Record<string, string> {
  return buildInlineMediaPathMap(attachments);
}

/** Look up absolute path for a code-span / token from the inline map. */
export function resolveInlineMediaToken(
  token: string,
  pathMap: Record<string, string> | undefined | null,
): string | null {
  const t = token.trim();
  if (!t) return null;
  if (pathMap?.[t]) return pathMap[t]!;
  const norm = t.replace(/\\/g, "/");
  if (pathMap?.[norm]) return pathMap[norm]!;
  if (pathMap?.[norm.toLowerCase()]) return pathMap[norm.toLowerCase()]!;
  // Absolute path works without a map
  if (isAbsoluteFsPath(norm) && isMediaPath(norm)) {
    return pathMap?.[norm] || norm;
  }
  return null;
}

/** @deprecated use resolveInlineMediaToken */
export function resolveInlineImageToken(
  token: string,
  pathMap: Record<string, string> | undefined | null,
): string | null {
  return resolveInlineMediaToken(token, pathMap);
}

/**
 * Attachments still shown below the message: non-media, or media that is
 * not already referenced (and thus inlined) in the message body.
 */
export function filterAttachmentsNotInlined(
  content: string,
  attachments?: Attachment[] | null,
): Attachment[] | undefined {
  if (!attachments?.length) return undefined;
  const rels = new Set(
    extractSessionRelativeMediaRefs(content).map((r) => r.replace(/\\/g, "/")),
  );
  const absInText = new Set(
    extractMediaPathsFromContent(content).map((a) => a.path),
  );
  const out = attachments.filter((a) => {
    if (a.isDir || !isMediaPath(a.path)) return true;
    const name = pathBasename(a.path);
    const norm = a.path.replace(/\\/g, "/");
    const rel = mediaTailFromPath(norm);
    if (rel && rels.has(rel)) return false;
    if (absInText.has(a.path)) return false;
    if (rel && content.includes(rel)) return false;
    if (
      content.includes(`\`${name}\``) ||
      content.includes(`\`${a.path}\``) ||
      (rel && content.includes(`\`${rel}\``))
    ) {
      return false;
    }
    // Markdown link form
    if (rel && content.includes(`](${rel})`)) return false;
    return true;
  });
  return out.length ? out : undefined;
}
