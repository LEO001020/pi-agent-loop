import { createRequire } from "node:module";
import { createJiti } from "jiti";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Config, containsCredential, redact } from "./config.ts";
import { landrunArgs, toolEnvironment, type ToolScope } from "./sandbox.ts";
import { privateDir, sha256 } from "./io.ts";

interface Engine {
  isRunning: boolean;
  start(): Promise<void>;
  execute(code: string, options: { signal?: AbortSignal; maxOutputChars: number; onStream(chunk: string, name: "stdout" | "stderr"): void }): Promise<any>;
  killSync(): void;
  dispose(): Promise<void>;
}

/** Additive use of the audited upstream IPython engine. No tool takeover, no
 * ambient helper discovery, no credential inheritance, no automatic pickle replay. */
export class PythonAccelerator {
  private engine?: Engine;
  private epoch = 0;
  private calls = 0;
  private busy = false;
  constructor(readonly cfg: Config, readonly scope: () => ToolScope, readonly artifactDir: string) {}
  reset(): void { this.epoch++; this.engine?.killSync(); this.engine = undefined; }
  async dispose(): Promise<void> {
    const engine = this.engine; this.engine = undefined; this.epoch++;
    if (!engine) return;
    const timer = setTimeout(() => engine.killSync(), 3000);
    try { await engine.dispose(); } finally { clearTimeout(timer); engine.killSync(); }
  }
  async execute(code: string, signal?: AbortSignal, onUpdate?: (text: string) => void): Promise<any> {
    if (!this.cfg.python.enabled) throw new Error("PYTHON_ACCELERATOR_DISABLED: ordinary Python scripts remain available");
    if (!existsSync(this.cfg.python.executable)) throw new Error("PYTHON_ACCELERATOR_NOT_INSTALLED: run the installer or use scripts-only mode");
    if (this.busy) throw new Error("PYTHON_CELL_IN_PROGRESS: wait for the current cell before issuing another");
    if (!code.trim() || code.length > 100000) throw new Error("Python code must contain 1-100000 characters");
    if (containsCredential(code)) throw new Error("SENSITIVE_PYTHON_INPUT_REJECTED: do not embed provider credentials in code");
    this.busy = true;
    const scope = this.scope();
    const id = randomUUID();
    privateDir(this.artifactDir);
    const sourcePath = join(this.artifactDir, `${id}.py`);
    const outputPath = join(this.artifactDir, `${id}.stdout`);
    const errorPath = join(this.artifactDir, `${id}.stderr`);
    writeFileSync(sourcePath, code, { flag: "wx", mode: 0o600 });
    writeFileSync(outputPath, "", { flag: "wx", mode: 0o600 });
    writeFileSync(errorPath, "", { flag: "wx", mode: 0o600 });
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const start = Date.now();
    let bytes = 0;
    let resetNotice: string | undefined;
    const deadline = setTimeout(() => controller.abort(new Error("Python cell deadline")), this.cfg.python.cellSeconds * 1000);
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => { hardKill = setTimeout(() => this.reset(), 3000); };
    combined.addEventListener("abort", onAbort, { once: true });
    try {
      if (!this.engine?.isRunning) {
        if (this.calls) resetNotice = "The prior kernel is no longer live. Variables were reset; reconstruct from recorded scripts/data before relying on results.";
        this.engine?.killSync();
        const root = dirname(createRequire(import.meta.url).resolve("pi-repl-py/package.json"));
        const module = await createJiti(import.meta.url, { interopDefault: false }).import(join(root, "src", "engine", "index.ts")) as any;
        this.engine = new module.EngineManager({
          cwd: scope.root, pythonPath: this.cfg.python.executable, inheritEnv: false, env: toolEnvironment(this.cfg, scope),
          commandPrefix: process.platform === "win32" ? undefined : { command: this.cfg.sandbox.landrun, args: [...landrunArgs(this.cfg, scope), "--"] },
          skipRestore: true,
        }) as Engine;
        this.epoch++;
      }
      const ownedEpoch = this.epoch;
      const engine = this.engine;
      const bootTimer = setTimeout(() => engine.killSync(), 40000);
      try { await engine.start(); } finally { clearTimeout(bootTimer); }
      if (combined.aborted) throw new Error("PYTHON_ABORTED_BEFORE_EXECUTION");
      this.calls++;
      const result = await engine.execute(code, { signal: combined, maxOutputChars: 16000,
        onStream: (chunk, channel) => {
          const clean = redact(chunk);
          bytes += Buffer.byteLength(clean);
          if (bytes > 64 * 1024 * 1024) { controller.abort(new Error("Python output quota")); return; }
          appendFileSync(channel === "stdout" ? outputPath : errorPath, clean);
          onUpdate?.(clean.slice(-4000));
        } });
      return { ...result, ...(ownedEpoch !== this.epoch ? { status: "aborted", reset: true } : {}),
        kernelEpoch: ownedEpoch, resetNotice, sourcePath, sourceSha256: sha256(code), outputPath, errorPath,
        rawOutputBytes: bytes, rawOutputComplete: bytes <= 64 * 1024 * 1024,
        durationMs: Date.now() - start, statePersistence: "current-session-kernel-only", verification: false };
    } catch (error) {
      this.reset();
      throw new Error(`PYTHON_ACCELERATOR_FAILURE: ${redact(error instanceof Error ? error.message : String(error))}; source=${sourcePath}; ordinary scripts remain available`);
    } finally {
      clearTimeout(deadline); if (hardKill) clearTimeout(hardKill);
      combined.removeEventListener("abort", onAbort);
      this.busy = false;
    }
  }
}

export function installPython(pi: ExtensionAPI, accelerator: PythonAccelerator): void {
  if (!accelerator.cfg.python.enabled) return;
  pi.registerTool({
    name: "execute", label: "Persistent Python (optional)",
    description: "Execute an IPython cell. Variables persist only while this session's kernel remains live. Exceptions do not necessarily roll back assignments. Kernel restart is explicitly reported. Ordinary reproducible scripts remain the baseline. Cell results are observations, not acceptance certificates; never rely on invisible kernel state for final verification.",
    parameters: Type.Object({ code: Type.String({ minLength: 1, maxLength: 100000 }) }),
    async execute(_id, args, signal, onUpdate) {
      const result = await accelerator.execute(args.code, signal, text => onUpdate?.({ content: [{ type: "text", text }], details: {} }));
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: result.status !== "ok" };
    },
  });
  pi.registerCommand("python-reset", { description: "Discard volatile Python variables; recorded scripts are retained", handler: async (_args, ctx) => {
    accelerator.reset(); ctx.ui.notify("Python kernel reset; previous variables are no longer valid.", "info");
  } });
  pi.on("session_shutdown", () => accelerator.dispose());
}
