import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.ts";
import { containsCredential } from "./config.ts";
import { jsonHash, privateDir, relativePath, sha256, within } from "./io.ts";

export interface FileIdentity { path: string; kind: "file" | "symlink"; executable: boolean; bytes: number; sha256: string }
export interface TreeIdentity { sha256: string; files: FileIdentity[]; excluded: string[]; head?: string }
export interface Origin { source: string; initial: TreeIdentity; repo: string; commit: string; exclusions: string[] }
export interface PatchInput { nodeId: string; version: number; path: string; sha256: string; baseCommit: string; preimages: Record<string, string | null> }
export interface Candidate { id: string; root: string; commit: string; tree: TreeIdentity; nodeVersions: Record<string, number>; patches: PatchInput[] }

const GIT_ARGS = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.autocrlf=false", "-c", "core.quotePath=false", "-c", "diff.external="];
export function git(cwd: string, args: readonly string[], input?: Buffer | string): Buffer {
  return execFileSync("git", [...GIT_ARGS, ...args], {
    cwd, input, maxBuffer: 256 * 1024 * 1024, timeout: 120000, stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env.PATH, HOME: "/nonexistent", LANG: "C.UTF-8", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Pi Agent Loop", GIT_AUTHOR_EMAIL: "loop@localhost", GIT_COMMITTER_NAME: "Pi Agent Loop", GIT_COMMITTER_EMAIL: "loop@localhost" },
  });
}
export const gitText = (cwd: string, args: readonly string[]): string => git(cwd, args).toString("utf8").trim();
function gitRoot(root: string): string | undefined {
  try { return realpathSync(gitText(root, ["rev-parse", "--show-toplevel"])); }
  catch (error) {
    const e = error as { status?: number; stderr?: Buffer };
    if (e.status === 128 && e.stderr?.toString().includes("not a git repository")) return undefined;
    throw error;
  }
}
function excluded(path: string, exclusions: string[]): boolean {
  return exclusions.some(x => path === x || path.startsWith(x.replace(/\/$/, "") + "/"));
}
function assertLocalSymlink(root: string, path: string): void {
  const target = readlinkSync(join(root, path));
  const lexical = resolve(dirname(join(root, path)), target);
  if (!within(root, lexical)) throw new Error(`EXTERNAL_SYMLINK: ${path}`);
  try { if (!within(root, realpathSync(join(root, path)))) throw new Error(`EXTERNAL_SYMLINK_CHAIN: ${path}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
export function treeIdentity(root: string, options: { exclusions?: string[]; gitSelection?: boolean } = {}): TreeIdentity {
  root = realpathSync(root);
  const exclusions = [".git", ".pi/subagents", ...(options.exclusions ?? [])];
  const skipped = new Set<string>();
  let paths: string[] = [];
  const top = options.gitSelection ? gitRoot(root) : undefined;
  if (top && top !== root) throw new Error("Select a repository root, not an ambiguous nested checkout");
  let head: string | undefined;
  if (top) {
    if (git(root, ["ls-files", "--stage", "-z"]).toString().split("\0").some(x => x.startsWith("160000 "))) throw new Error("SUBMODULE_IMPORT_REQUIRES_EXPLICIT_MATERIALIZATION: no contents will be silently omitted");
    paths = [...new Set(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString("utf8").split("\0").filter(Boolean))];
    try { head = gitText(root, ["rev-parse", "--verify", "HEAD"]); } catch { /* Valid unborn repository. */ }
  } else {
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const absolute = join(dir, name);
        const path = relative(root, absolute).split(sep).join("/");
        if (excluded(path, exclusions)) { skipped.add(path); continue; }
        const info = lstatSync(absolute);
        if (info.isDirectory()) walk(absolute); else paths.push(path);
        if (paths.length > 100000) throw new Error("WORKSPACE_FILE_LIMIT: select a smaller workspace");
      }
    };
    walk(root);
  }
  const files: FileIdentity[] = [];
  let total = 0;
  for (const path of paths.sort()) {
    if (excluded(path, exclusions)) { skipped.add(path); continue; }
    relativePath(path);
    const file = join(root, path);
    let info;
    try { info = lstatSync(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; // An actual staged/unstaged deletion.
      throw error;
    }
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error(`UNSUPPORTED_FILE_TYPE: ${path}`);
    if (info.size > 128 * 1024 * 1024) throw new Error(`WORKSPACE_LARGE_FILE: ${path}`);
    if (info.isSymbolicLink()) assertLocalSymlink(root, path);
    const content = info.isSymbolicLink() ? Buffer.from(readlinkSync(file)) : readFileSync(file);
    if (containsCredential(content)) throw new Error(`PROVIDER_CREDENTIAL_IN_WORKSPACE: ${path}; use an explicit exclusion`);
    files.push({ path, kind: info.isSymbolicLink() ? "symlink" : "file", executable: Boolean(info.mode & 0o111), bytes: content.length, sha256: sha256(content) });
    total += content.length;
    if (total > 2 * 1024 * 1024 * 1024 || files.length > 100000) throw new Error("WORKSPACE_SIZE_LIMIT: 2 GiB / 100000 files");
  }
  return { sha256: jsonHash(files), files, excluded: [...skipped].sort(), ...(head ? { head } : {}) };
}
export function copyTree(source: string, dest: string, identity: TreeIdentity): void {
  if (existsSync(dest)) throw new Error(`SNAPSHOT_DESTINATION_EXISTS: ${dest}`);
  privateDir(dest);
  for (const file of identity.files) {
    const target = join(dest, file.path);
    privateDir(dirname(target));
    if (file.kind === "symlink") symlinkSync(readlinkSync(join(source, file.path)), target);
    else { copyFileSync(join(source, file.path), target); chmodSync(target, file.executable ? 0o755 : 0o644); }
  }
  if (treeIdentity(dest).sha256 !== identity.sha256) throw new Error("SOURCE_CHANGED_DURING_COPY");
}
export function importWorkspace(cfg: Config, source: string): Origin {
  source = realpathSync(source);
  if (!lstatSync(source).isDirectory()) throw new Error("Workspace must be a directory");
  if (within(source, cfg.home) || within(source, cfg.credentialsFile)) throw new Error("Workspace cannot contain the loop profile or provider credentials");
  const initial = treeIdentity(source, { gitSelection: true, exclusions: cfg.importExcludes });
  const repo = join(cfg.home, "projects", randomUUID(), "repo");
  copyTree(source, repo, initial);
  const after = treeIdentity(source, { gitSelection: true, exclusions: cfg.importExcludes });
  if (after.sha256 !== initial.sha256 || after.head !== initial.head) throw new Error("SOURCE_CHANGED_DURING_IMPORT");
  git(repo, ["init", "--initial-branch=pi-loop"]);
  git(repo, ["add", "--all", "--force"]);
  git(repo, ["commit", "--allow-empty", "-m", "Preserved user working snapshot"]);
  return { source, initial, repo, commit: gitText(repo, ["rev-parse", "HEAD"]), exclusions: cfg.importExcludes };
}
export function candidateFrom(origin: Origin, destination: string, patches: PatchInput[], nodeVersions: Record<string, number>): Candidate {
  if (existsSync(destination)) throw new Error("Candidate path already exists");
  privateDir(dirname(destination));
  git(dirname(destination), ["clone", "--no-local", "--no-hardlinks", "--no-checkout", origin.repo, destination]);
  git(destination, ["remote", "remove", "origin"]);
  git(destination, ["checkout", "--detach", origin.commit]);
  for (const patch of patches) {
    const bytes = readFileSync(patch.path);
    if (sha256(bytes) !== patch.sha256) throw new Error("PATCH_BYTES_CHANGED");
    const current = new Map(treeIdentity(destination).files.map(file => [file.path, jsonHash(file)]));
    for (const [path, preimage] of Object.entries(patch.preimages)) {
      if ((current.get(path) ?? null) !== preimage) throw new Error(`PATCH_PREIMAGE_CONFLICT: ${patch.nodeId}: ${path}; construct a new explicit integration candidate instead of guessing a merge`);
    }
    if (bytes.length) git(destination, ["apply", "--index", "--binary", "--whitespace=nowarn", patch.path]);
  }
  git(destination, ["commit", "--allow-empty", "-m", "Assemble input-bound candidate"]);
  const commit = gitText(destination, ["rev-parse", "HEAD"]);
  return { id: randomUUID(), root: destination, commit, tree: treeIdentity(destination), nodeVersions, patches };
}
export function assertCandidate(candidate: Candidate): void {
  if (treeIdentity(candidate.root).sha256 !== candidate.tree.sha256 || gitText(candidate.root, ["rev-parse", "HEAD"]) !== candidate.commit) throw new Error("STALE_CANDIDATE: candidate bytes or commit changed");
}
export function candidatePatch(origin: Origin, candidate: Candidate): Buffer {
  assertCandidate(candidate);
  return git(candidate.root, ["diff", "--binary", "--no-ext-diff", "--no-textconv", origin.commit, candidate.commit]);
}
export function patchPaths(repo: string, path: string): string[] {
  const fields = git(repo, ["apply", "--numstat", "-z", path]).toString("utf8").split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    if (!fields[i]) continue;
    const match = /^[^\t]+\t[^\t]+\t(.*)$/.exec(fields[i]);
    if (!match) throw new Error("UNSUPPORTED_PATCH_NUMSTAT");
    if (match[1]) paths.push(relativePath(match[1]));
    else { paths.push(relativePath(fields[++i]), relativePath(fields[++i])); }
  }
  return [...new Set(paths)];
}
export function inScope(path: string, scopes: string[]): boolean {
  return scopes.some(scope => scope === "." || path === scope.replace(/\/$/, "") || (scope.endsWith("/") && path.startsWith(scope)));
}
export function applyToSource(origin: Origin, patchFile: string): void {
  const now = treeIdentity(origin.source, { gitSelection: true, exclusions: origin.exclusions });
  if (now.sha256 !== origin.initial.sha256 || now.head !== origin.initial.head) throw new Error("SOURCE_CHANGED: export and reconcile the patch without overwriting user edits");
  if (statPatch(patchFile) === 0) return;
  git(origin.source, ["apply", "--check", "--binary", patchFile]);
  const second = treeIdentity(origin.source, { gitSelection: true, exclusions: origin.exclusions });
  if (second.sha256 !== now.sha256 || second.head !== now.head) throw new Error("SOURCE_CHANGED_DURING_PREFLIGHT");
  git(origin.source, ["apply", "--binary", "--whitespace=nowarn", patchFile]);
}
function statPatch(path: string): number { return readFileSync(path).length; }
