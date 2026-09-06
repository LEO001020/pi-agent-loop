import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

export const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");
export const jsonHash = (value: unknown): string => sha256(JSON.stringify(value));
export function within(root: string, path: string): boolean {
  const part = relative(resolve(root), resolve(path));
  return part === "" || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`));
}
export function assertWithin(root: string, path: string): string {
  const actual = realpathSync(path);
  if (!within(realpathSync(root), actual)) throw new Error(`PATH_OUTSIDE_SCOPE: ${path}`);
  return actual;
}
export function privateDir(path: string): string { mkdirSync(path, { recursive: true, mode: 0o700 }); return path; }
export function syncFile(path: string): void {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } catch { /* Windows: fsync on read-open or certain volumes throws EPERM — durability best-effort */ } finally { closeSync(fd); }
}
export function atomicJson(path: string, value: unknown): void {
  privateDir(dirname(path));
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    syncFile(temp);
    renameSync(temp, path);
    syncFile(dirname(path));
  } finally { rmSync(temp, { force: true }); }
}
export function readJson<T = unknown>(path: string): T { return JSON.parse(readFileSync(path, "utf8")) as T; }

/** Bootstrap a real native JSONL, then use the public reopen API. Pi defers a
 * brand-new session's writes until its first assistant message; accepting a task
 * must not depend on a provider responding. There is no sidecar task database. */
export function ensureNativePersistence(manager: SessionManager): void {
  const file = manager.getSessionFile();
  if (!file) throw new Error("PERSISTENCE_REQUIRED: in-memory sessions cannot own a loop task");
  if (!existsSync(file)) {
    privateDir(dirname(file));
    const header = manager.getHeader();
    if (!header) throw new Error("Missing native session header");
    const content = [header, ...manager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n";
    writeFileSync(file, content, { flag: "wx", mode: 0o600 });
    syncFile(file);
    syncFile(dirname(file));
    manager.setSessionFile(file);
  }
}

export function safeId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value)) throw new Error("Invalid stable identifier");
  return value;
}
export function relativePath(value: string): string {
  if (!value || isAbsolute(value) || /[\0\r\n\\]/.test(value) || value.split("/").some(p => p === ".." || p === ".git")) throw new Error(`Invalid relative path: ${JSON.stringify(value)}`);
  return value.replace(/^\.\//, "");
}
