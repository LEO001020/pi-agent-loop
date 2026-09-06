/** Pure scope_key helper mirroring Host §17.3 (for UI + tests). */

export function normalizeScopeTarget(raw: string): string {
  const t = raw.trim();
  if (!t) return "*";
  if (!t.includes("/") && !t.includes("\\")) {
    return t.split(/\s+/)[0] ?? t;
  }
  return t.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function scopeKey(toolName: string, pathOrCommand: string): string {
  return `${toolName}:${normalizeScopeTarget(pathOrCommand)}`;
}

export function isOutsideProject(projectRoot: string, target: string): boolean {
  const proj = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const tgt = target.replace(/\\/g, "/");
  if (!proj) return true;
  return !(tgt === proj || tgt.startsWith(proj + "/"));
}
