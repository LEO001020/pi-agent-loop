import { closeSync, existsSync, fsyncSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { containsCredential } from "./config.ts";
import { assertWithin, privateDir, safeId, sha256, syncFile } from "./io.ts";

export interface Artifact {
  id: string;
  sha256: string;
  bytes: number;
  media: "text/plain" | "application/json" | "text/x-patch" | "text/x-python";
  provenance: "user-input" | "model-claim" | "tool-observation" | "host-record";
  label: string;
}

/** Content-addressed immutable files; the authoritative references live in the
 * native Pi journal. This is not a second transcript or task database. */
export class Artifacts {
  readonly root: string;
  constructor(root: string) { this.root = realpathSync(privateDir(root)); }
  put(data: string | Buffer | object, metadata: Omit<Artifact, "id" | "sha256" | "bytes">): Artifact {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
    if (bytes.length > 64 * 1024 * 1024) throw new Error("ARTIFACT_LIMIT: maximum single artifact is 64 MiB");
    if (containsCredential(bytes)) throw new Error("SENSITIVE_ARTIFACT_REJECTED: refusing to persist a provider credential; bytes were not silently changed");
    const hash = sha256(bytes);
    const id = `a-${hash}`;
    const file = join(this.root, id);
    if (!existsSync(file)) {
      writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
      const fd = openSync(file, "r+"); // Windows: fsync on a read-only fd throws EPERM; r+ is durable and permitted
      try { fsyncSync(fd); } catch { /* best-effort on filesystems that reject fsync */ } finally { closeSync(fd); }
      syncFile(this.root);
    }
    if (sha256(readFileSync(file)) !== hash) throw new Error("ARTIFACT_COLLISION_OR_TAMPER");
    return { id, sha256: hash, bytes: bytes.length, ...metadata };
  }
  path(ref: Artifact): string {
    safeId(ref.id);
    if (ref.id !== `a-${ref.sha256}` || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw new Error("ARTIFACT_ID_MISMATCH");
    const path = assertWithin(this.root, join(this.root, ref.id));
    if (statSync(path).size !== ref.bytes || sha256(readFileSync(path)) !== ref.sha256) throw new Error("ARTIFACT_CHANGED: recorded evidence no longer matches its bytes");
    return path;
  }
  bytes(ref: Artifact): Buffer { return readFileSync(this.path(ref)); }
  text(ref: Artifact): string { return this.bytes(ref).toString("utf8"); }
  read(ref: Artifact, offset = 0, length = 16000, query?: string): unknown {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 48000) throw new Error("Invalid artifact cursor");
    const text = this.text(ref);
    const hit = query ? text.toLowerCase().indexOf(query.toLowerCase(), offset) : offset;
    if (hit < 0) return { artifact: ref, totalCharacters: text.length, found: false, nextOffset: null };
    const start = query ? Math.max(offset, hit - Math.min(400, Math.floor(length / 4))) : offset;
    const end = Math.min(text.length, start + length);
    return { artifact: ref, totalCharacters: text.length, offset: start, text: text.slice(start, end), hit: query ? hit : undefined,
      nextOffset: end < text.length ? end : null, complete: end >= text.length };
  }
}
