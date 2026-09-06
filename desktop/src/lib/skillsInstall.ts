/**
 * Validating a skill install source before it reaches `pi install`.
 *
 * The host runs the value as a subprocess argument, so this mirrors its
 * rejections (leading dash, control characters, length) and adds the shapes
 * we are willing to one-click from the GUI. Anything else is refused rather
 * than passed through on faith.
 */

export type SkillSource =
  | { kind: "npm"; source: string }
  | { kind: "git"; source: string }
  | { kind: "path"; source: string };

const NPM_NAME =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[\w.-]+)?$/i;

/** Control characters or whitespace could smuggle a second argument. */
function hasUnsafeChars(s: string): boolean {
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code < 0x21 || code === 0x7f) return true;
  }
  return false;
}

export function parseSkillSource(raw: string): SkillSource | null {
  const s = (raw || "").trim();
  if (!s || s.length > 512) return null;
  if (s.startsWith("-")) return null;
  if (hasUnsafeChars(s)) return null;

  if (s.startsWith("npm:")) {
    return NPM_NAME.test(s.slice(4)) ? { kind: "npm", source: s } : null;
  }
  if (
    s.startsWith("git+") ||
    s.startsWith("https://") ||
    s.startsWith("github:")
  ) {
    return { kind: "git", source: s };
  }
  if (s.startsWith("/") || s.startsWith("./") || s.startsWith("~/")) {
    return { kind: "path", source: s };
  }
  // A bare npm name is the most common paste; accept it as npm.
  if (NPM_NAME.test(s)) return { kind: "npm", source: `npm:${s}` };
  return null;
}
