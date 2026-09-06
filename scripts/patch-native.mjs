import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "node_modules/pi-subagents/src/runs/shared/worktree.ts");
const receipt = join(root, "runtime/native-patch-manifest.json");
const before = "e804f49e2f4f2eb5639c1fc3d3cc31ec0d9599306ebd2b1b9889c31c1292f950";
const sha = text => createHash("sha256").update(text).digest("hex");
const raw = readFileSync(target, "utf8");
const prior = existsSync(receipt) ? JSON.parse(readFileSync(receipt, "utf8")) : null;
if (sha(raw) !== before) {
  if (prior?.before !== before || prior?.after !== sha(raw)) throw new Error("Unknown native worktree source; refusing patch");
  const patched = raw.replace('"--default-prefix"', '"--src-prefix=a/", "--dst-prefix=b/"');
  const record = { ...prior, version: 2, after: sha(patched), gitCompatibility: "explicit a/ and b/ prefixes also work on Git 2.39.5" };
  writeFileSync(target, patched);
  writeFileSync(receipt, JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify(record));
} else {
  const context = 'function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): GitResult {\n\tconst result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8", windowsHide: true, shell: false, ...(env ? { env: { ...process.env, ...env } } : {}) });';
  const replacement = `/** Pi Loop compatibility guard. The runtime is still the upstream allocator,
 * capture and cleanup implementation. Before it invokes Git in a child-writable
 * tree, validate the marker against protected native metadata and its backlink.
 * No model-supplied replacement .git file can redirect host-side capture. */
function assertPiLoopWorktreeMarker(cwd: string): void {
  if (!process.env.PI_LOOP_WORKTREE_POLICY) return;
  const policy = JSON.parse(process.env.PI_LOOP_WORKTREE_POLICY) as { worktreeRoot: string; metadataRoots: string[] };
  const inside = (root: string, candidate: string) => {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep));
  };
  const actual = fs.realpathSync(cwd);
  if (!inside(policy.worktreeRoot, actual)) return;
  let dir = actual;
  while (inside(policy.worktreeRoot, dir)) {
    const marker = path.join(dir, ".git");
    if (fs.existsSync(marker)) {
      const info = fs.lstatSync(marker);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error("PI_LOOP_FOREIGN_GIT_MARKER");
      const content = fs.readFileSync(marker, "utf8");
      const match = /^gitdir: ([^\\r\\n]+)\\r?\\n?$/.exec(content);
      if (!match) throw new Error("PI_LOOP_INVALID_GIT_MARKER");
      const metadata = fs.realpathSync(path.resolve(dir, match[1]!));
      if (inside(policy.worktreeRoot, metadata) || !policy.metadataRoots.some(root => inside(root, metadata))) throw new Error("PI_LOOP_UNTRUSTED_GIT_METADATA");
      const backlink = fs.readFileSync(path.join(metadata, "gitdir"), "utf8").trim();
      if (path.resolve(metadata, backlink) !== marker) throw new Error("PI_LOOP_WRONG_GIT_BACKLINK");
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("PI_LOOP_MISSING_GIT_MARKER");
}

function runGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): GitResult {
  assertPiLoopWorktreeMarker(cwd);
  const controlled = process.env.PI_LOOP_WORKTREE_POLICY ? ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.attributesFile=/dev/null", "-c", "diff.external="] : [];
  const result = spawnSync("git", [...controlled, "-C", cwd, ...args], { encoding: "utf-8", windowsHide: true, shell: false, timeout: process.env.PI_LOOP_WORKTREE_POLICY ? 30000 : undefined, ...(env ? { env: { ...process.env, ...env } } : {}) });`;
  if (raw.split(context).length !== 2) throw new Error("Native patch context changed");
  const patched = raw.replace(context, replacement).replace('"--default-prefix"', '"--src-prefix=a/", "--dst-prefix=b/"');
  writeFileSync(target, patched);
  const record = { version: 2, package: "pi-subagents@0.65.1", path: "src/runs/shared/worktree.ts", before, after: sha(patched), purpose: "host-side Git marker confinement before capture; bounded setup command", gitCompatibility: "explicit a/ and b/ prefixes also work on Git 2.39.5" };
  mkdirSync(dirname(receipt), { recursive: true });
  writeFileSync(receipt, JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify(record));
}
