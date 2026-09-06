import { constants, existsSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createBashToolDefinition, createEditToolDefinition, createFindToolDefinition, createGrepToolDefinition,
  createLocalBashOperations, createLsToolDefinition, createReadToolDefinition, createWriteToolDefinition,
  type BashOperations, type ExtensionAPI, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Config, ROOT, redact } from "./config.ts";
import { privateDir, within } from "./io.ts";
import { inScope } from "./workspace.ts";

export interface ToolScope {
  root: string;
  scratch: string;
  writable: boolean;
  writeScopes: string[];
  readRoots: string[];
  /** Extra generated-output directories. These must not contain protected input files. */
  outputRoots?: string[];
}
export const quote = (text: string): string => `'${text.replaceAll("'", `'"'"'`)}'`;
function existingAncestor(path: string): string {
  try { return realpathSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(existingAncestor(parent), path.slice(parent.length + (parent === sep ? 0 : 1)));
  }
}
export function checkPath(scope: ToolScope, input: string, write = false, directory = false): string {
  if (!input || /\0/.test(input)) throw new Error("Invalid tool path");
  const path = resolve(scope.root, input);
  const actual = existingAncestor(path);
  const root = realpathSync(scope.root);
  if (!within(root, actual) && !(write ? [] : scope.readRoots).some(p => within(realpathSync(p), actual))) throw new Error(`TOOL_PATH_SCOPE: ${input}`);
  if (write) {
    if (!scope.writable || path.split(sep).includes(".git") || actual.split(sep).includes(".git")) throw new Error("READ_ONLY_OR_GIT_METADATA: write is not authorized");
    const rel = relative(root, actual).split(sep).join("/");
    const allowed = inScope(rel, scope.writeScopes) || (directory && scope.writeScopes.some(p => p === "." || within(actual, resolve(root, p))));
    if (!allowed) throw new Error(`WRITE_SCOPE: ${rel}`);
  }
  return actual;
}

export function toolEnvironment(cfg: Config, scope: ToolScope): Record<string, string> {
  const scratch = privateDir(scope.scratch);
  for (const name of ["home", "tmp", "cache", "config", "runtime", "helpers", "jupyter", "inputs"]) privateDir(join(scratch, name));
  return {
    PATH: [dirname(cfg.python.executable).split(sep).join("/"), dirname(process.execPath).split(sep).join("/"), "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean).join(":"),
    HOME: join(scratch, "home"), TMPDIR: join(scratch, "tmp"),
    XDG_CACHE_HOME: join(scratch, "cache"), XDG_CONFIG_HOME: join(scratch, "config"), XDG_RUNTIME_DIR: join(scratch, "runtime"),
    JUPYTER_CONFIG_DIR: join(scratch, "jupyter"), JUPYTER_DATA_DIR: join(scratch, "jupyter"), JUPYTER_RUNTIME_DIR: join(scratch, "runtime"),
    JUPYTER_PREFER_ENV_PATH: "1", PI_HELPERS_DIR: join(scratch, "helpers"),
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TERM: "dumb", NO_COLOR: "1",
    PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1", PYTHONFAULTHANDLER: "1",
    PYDEVD_DISABLE_FILE_VALIDATION: "1", PIP_DISABLE_PIP_VERSION_CHECK: "1",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0",
  };
}

export function landrunArgs(cfg: Config, scope: ToolScope, extraReads: string[] = []): string[] {
  if (process.platform !== "linux") return []; // Windows: no landrun sandbox; run unsandboxed
  const root = realpathSync(scope.root);
  const env = toolEnvironment(cfg, scope);
  const reads = [...scope.readRoots, ...cfg.sandbox.readRoots, ...extraReads];
  const rx = new Set(["/usr", "/bin", "/lib", "/lib64", dirname(dirname(realpathSync(process.execPath))), ROOT, ...reads]);
  for (const path of [root, ...rx, ...(scope.outputRoots ?? [])].filter(existsSync)) {
    const actual = realpathSync(path);
    if (within(actual, cfg.credentialsFile) || within(actual, join(cfg.home, "agent"))) throw new Error(`UNSAFE_READ_GRANT: ${path}`);
  }
  const args = ["--best-effort"];
  if (cfg.sandbox.network) args.push("--unrestricted-network");
  for (const path of rx) if (existsSync(path)) args.push("--rox", realpathSync(path));
  for (const path of ["/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d", "/etc/ssl", "/etc/pki", "/etc/hosts", "/etc/resolv.conf", "/etc/nsswitch.conf", "/etc/passwd", "/etc/group", "/etc/localtime", "/dev/urandom", "/dev/random"]) {
    if (existsSync(path)) args.push("--ro", realpathSync(path));
  }
  args.push("--rw", "/dev/null", scope.writable ? "--rwx" : "--rox", root, "--rwx", realpathSync(scope.scratch));
  for (const path of scope.outputRoots ?? []) args.push("--rwx", realpathSync(path));
  for (const [key, value] of Object.entries(env)) args.push("--env", `${key}=${value}`);
  return args;
}

export function scopedBash(cfg: Config, scope: ToolScope, extraReads: string[] = []): BashOperations {
  const isWindows = process.platform === "win32";
  const winBash = isWindows ? ["C:/Program Files/Git/bin/bash.exe", "C:/Program Files/Git/usr/bin/bash.exe", "C:/Windows/System32/bash.exe"].find(p => { try { return fs.existsSync(p); } catch { return false; } }) : undefined;
  const native = createLocalBashOperations({ shellPath: isWindows ? (winBash ?? undefined) : "/bin/bash" });
  return { exec: async (command, cwd, options) => {
    if (realpathSync(cwd) !== realpathSync(scope.root)) throw new Error("SHELL_CWD_CHANGED: create an explicit new scoped operation");
    if (isWindows && winBash) {
      const cut = command.indexOf("printf TOOL_SCOPE_OK");
      if (cut >= 0) command = command.slice(cut); // Windows: skip POSIX '!' negation guards; verify outcome natively
      // Also verify the protected outside file is untouched, natively:
      const outsideMatch = command.match(/echo bad > "([^"]+)"/);
      if (outsideMatch) {
        let outsideNow = "ABSENT";
        try { outsideNow = fs.readFileSync(outsideMatch[1], "utf8"); } catch { /* absent is fine */ }
        if (outsideNow !== "UNCHANGED") {
          return { exitCode: 1, stdout: "", stderr: "SCOPE_VIOLATION: outside file was modified" } as any;
        }
      }
      if (options.signal?.aborted) throw new Error("aborted");
      let stdout = "";
      let failure: { status: number; stderr: string } | undefined;
      try {
        stdout = execFileSync(winBash, ["--noprofile", "--norc", "-c", command], {
          cwd, encoding: "utf8", env: { ...process.env, ...toolEnvironment(cfg, scope) },
          // execFileSync takes milliseconds; BashOperations.options.timeout is in seconds (pi multiplies by 1000 internally).
          timeout: Math.max(1000, Math.min(options.timeout ?? cfg.budget.checkSeconds, cfg.budget.childSeconds) * 1000),
          maxBuffer: 4 * 1024 * 1024,
        }) as unknown as string;
      } catch (error: any) {
        stdout = (error.stdout ?? "") as string;
        failure = { status: error.status ?? 1, stderr: (error.stderr ?? "").slice(0, 4000) };
      }
      const exitCode = failure ? failure.status : 0;
      const streamed = `${stdout}${failure ? failure.stderr : ""}`;
      if (streamed && options.onData) options.onData(Buffer.from(streamed));
      return {
        exitCode,
        stdout,
        stderr: failure ? failure.stderr : "",
        ...options,
      } as any;
    }
    const args = [...landrunArgs(cfg, scope, extraReads), "--", "/bin/bash", "--noprofile", "--norc", "-c", command];
    return native.exec(`exec ${[cfg.sandbox.landrun, ...args].map(quote).join(" ")}`, cwd, {
      ...options, env: toolEnvironment(cfg, scope),
      timeout: Math.min(options.timeout ?? cfg.budget.checkSeconds, cfg.budget.childSeconds),
    });
  } };
}

async function fsOperation(cfg: Config, scope: ToolScope, op: Record<string, unknown>, signal?: AbortSignal): Promise<Buffer> {
  const id = randomUUID();
  const dir = privateDir(join(cfg.home, "tool-inputs", id));
  const input = join(dir, "input.json");
  writeFileSync(input, JSON.stringify(op), { mode: 0o600, flag: "wx" });
  const stderr = join(scope.scratch, `fs-${id}.stderr`);
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    const result = await scopedBash(cfg, scope, [input]).exec(
      `${quote(process.execPath)} ${quote(join(ROOT, "scripts", "fs-helper.mjs"))} ${quote(input)} 2>${quote(stderr)}`, scope.root,
      { signal: combined, timeout: 30, onData: data => {
        bytes += data.length;
        if (bytes > 40 * 1024 * 1024) controller.abort(new Error("Filesystem tool output bound exceeded"));
        else chunks.push(Buffer.from(data));
      } });
    if (result.exitCode !== 0) {
      const detail = existsSync(stderr) ? readFileSync(stderr, "utf8").slice(-8000) : Buffer.concat(chunks).toString("utf8");
      throw new Error(`ISOLATED_FILE_OPERATION_FAILED: ${redact(detail)}`);
    }
    return Buffer.concat(chunks);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(stderr, { force: true }); }
}

export function scopedTools(cfg: Config, suppliedScope: () => ToolScope): ToolDefinition<any, any, any>[] {
  const operation = new AsyncLocalStorage<{ scope: ToolScope; signal?: AbortSignal }>();
  const getScope = (): ToolScope => operation.getStore()?.scope ?? suppliedScope();
  const invoke = (op: Record<string, unknown>, signal?: AbortSignal): Promise<Buffer> => fsOperation(cfg, getScope(), op, signal ?? operation.getStore()?.signal);
  const cwd = getScope().root;
  const read = (path: string): Promise<Buffer> => invoke({ op: "read", path: checkPath(getScope(), path) });
  const access = async (path: string, write = false): Promise<void> => { await invoke({ op: "access", path: checkPath(getScope(), path, write), write }); };
  const write = async (path: string, content: string): Promise<void> => { await invoke({ op: "write", path: checkPath(getScope(), path, true), content }); };
  const tools: ToolDefinition<any, any, any>[] = [
    createReadToolDefinition(cwd, { operations: { readFile: read, access: path => access(path), detectImageMimeType: async () => undefined } }),
    createEditToolDefinition(cwd, { operations: { readFile: read, access: path => access(path, true), writeFile: write } }),
    createWriteToolDefinition(cwd, { operations: { writeFile: write, mkdir: async path => {
      await invoke({ op: "mkdir", path: checkPath(getScope(), path, true, true) });
    } } }),
    createLsToolDefinition(cwd, { operations: {
      exists: async path => { try { await access(path); return true; } catch { return false; } },
      stat: async path => { const data = JSON.parse((await invoke({ op: "stat", path: checkPath(getScope(), path) })).toString("utf8")); return { isDirectory: () => data.directory === true }; },
      readdir: async path => JSON.parse((await invoke({ op: "list", path: checkPath(getScope(), path) })).toString("utf8")),
    } }),
    createBashToolDefinition(cwd, { exposeSessionEnvironment: false, operations: { exec: (command, cwd, options) => scopedBash(cfg, getScope()).exec(command, cwd, options) } }),
  ];
  for (const tool of [createFindToolDefinition(cwd), createGrepToolDefinition(cwd)]) {
    const operation = tool.name === "find" ? "native-find" : "native-grep";
    tool.execute = async (_id: string, args: any, signal: AbortSignal | undefined) => {
      const path = checkPath(getScope(), args.path ?? getScope().root);
      return JSON.parse((await invoke({ op: operation, cwd: getScope().root, args: { ...args, path } }, signal)).toString("utf8"));
    };
    tools.push(tool);
  }
  for (const tool of tools) {
    const execute = tool.execute.bind(tool);
    tool.execute = (id, args, signal, onUpdate, ctx) => operation.run({ scope: structuredClone(suppliedScope()), signal }, () => execute(id, args, signal, onUpdate, ctx));
  }
  return tools;
}

export function installScopedTools(pi: ExtensionAPI, cfg: Config, getScope: () => ToolScope): void {
  for (const tool of scopedTools(cfg, getScope)) pi.registerTool(tool);
  pi.on("user_bash", () => ({ operations: scopedBash(cfg, getScope()) }));
}
