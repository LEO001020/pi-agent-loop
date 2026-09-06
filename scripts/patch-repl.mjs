import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, "node_modules", "pi-repl-py");
const digest = data => createHash("sha256").update(data).digest("hex");
const manifestPath = join(root, "runtime", "repl-patch-manifest.json");
const prior = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { files: [] };
const replacements = [
  {
    path: "src/engine/index.ts",
    before: "0b9583b1ed0e7fa06cf5e88b55bc66f3cf2a51436f8540e8d62139dc21f29e0d",
    edits: [
      ["export interface EngineOptions {", "export interface EngineOptions {\n\t/** Pi Loop additive adapter: explicit interpreter and restricted process launch. */\n\tpythonPath?: string;\n\tcommandPrefix?: { command: string; args: string[] };\n\tinheritEnv?: boolean;"],
      ["this.pythonPath = resolvePythonPath(this.options.cwd);", "this.pythonPath = this.options.pythonPath ?? resolvePythonPath(this.options.cwd);"],
      ["this.kernel = await KernelClient.start(this.pythonPath, {", "this.kernel = await KernelClient.start(this.pythonPath, {\n\t\t\t\tcommandPrefix: this.options.commandPrefix,\n\t\t\t\tinheritEnv: this.options.inheritEnv,"],
      ["commandPrefix: this.options.commandPrefix,", "commandPrefix: this.options.commandPrefix,\n\t\t\t\tonCreated: (kernel) => { this.kernel = kernel; if (this.isShutdown()) kernel.kill(); },"],
    ],
  },
  {
    path: "src/engine/kernel.ts",
    before: "59883f464f19e65cc219d5d7086acbf8d504713d13520b1af1ffcdd6999fdb89",
    edits: [
      ["export interface KernelOptions {", "export interface KernelOptions {\n\t/** Pi Loop additive adapter; upstream framing and kernel lifecycle are retained. */\n\tcommandPrefix?: { command: string; args: string[] };\n\tinheritEnv?: boolean;"],
      ["if (requested && existsSync(requested)) return requested;\n\treturn process.cwd();", "if (requested && !existsSync(requested)) throw new Error(`REPL_CWD_MISSING: ${requested}`);\n\treturn requested ?? process.cwd();"],
      ["const child = spawn(pythonPath, [BRIDGE_PATH], {", "const command = opts.commandPrefix?.command ?? pythonPath;\n\t\tconst args = opts.commandPrefix ? [...opts.commandPrefix.args, pythonPath, BRIDGE_PATH] : [BRIDGE_PATH];\n\t\tconst child = spawn(command, args, {"],
      ["env: { ...process.env, ...(opts.env ?? {}) },", "env: opts.inheritEnv === false ? { ...(opts.env ?? {}) } : { ...process.env, ...(opts.env ?? {}) },"],
      ["kc.child = child;", "kc.child = child;\n\t\tchild.once(\"error\", (error) => {\n\t\t\tkc.rejectBootWaiters(error);\n\t\t\tkc.settleActive(error);\n\t\t\tkc.kill();\n\t\t});"],
      ["active.onStream?.(text.slice(0, keep), name);", "// Pi Loop stores raw chunks outside model context; returned buffers stay capped.\n\t\tactive.onStream?.(text, name);"],
      ["kill(): void {\n\t\tthis.stopWatchdog();", "kill(): void {\n\t\tthis.stopWatchdog();\n\t\tthis.rejectBootWaiters(new Error(\"kernel killed\"));\n\t\tfor (const pending of this.pending.values()) {\n\t\t\tif (pending.timer) clearTimeout(pending.timer);\n\t\t\tpending.reject(new Error(\"kernel killed\"));\n\t\t}\n\t\tthis.pending.clear();"],
      ["export interface KernelOptions {", "export interface KernelOptions {\n\tonCreated?: (kernel: KernelClient) => void;"],
      ["kc.send({ op: \"boot\", helpers, snapshot: opts.snapshot });", "opts.onCreated?.(kc);\n\t\tif (!kc.child) throw new Error(\"kernel cancelled during boot\");\n\t\tkc.send({ op: \"boot\", helpers, snapshot: opts.snapshot });"],
    ],
  },
];
const files = [];
const writes = [];
for (const patch of replacements) {
  const path = join(base, patch.path);
  const original = readFileSync(path, "utf8");
  const actual = digest(original);
  const existing = prior.files.find(row => row.path === patch.path && row.before === patch.before && row.after === actual);
  let updated = original;
  if (actual !== patch.before) {
    if (!existing) throw new Error(`Refusing to patch unknown pi-repl-py source: ${patch.path} ${actual}`);
    // Reverse this patch's known replacements before upgrading an earlier patch
    // revision. The original full-file hash must match before any write occurs.
    for (const [from, to] of [...patch.edits].reverse()) {
      const count = updated.split(to).length - 1;
      if (count > 1) throw new Error(`Ambiguous reverse patch: ${patch.path}`);
      if (count === 1) updated = updated.replace(to, from);
    }
    if (digest(updated) !== patch.before) throw new Error(`Cannot reconstruct audited original: ${patch.path}`);
  }
  for (const [from, to] of patch.edits) {
    if (updated.split(from).length !== 2) throw new Error(`Patch context not unique: ${patch.path}: ${from.slice(0, 80)}`);
    updated = updated.replace(from, to);
  }
  writes.push({ path, updated });
  files.push({ path: patch.path, before: patch.before, after: digest(updated), edits: patch.edits.length });
}
for (const { path, updated } of writes) writeFileSync(path, updated);
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, JSON.stringify({ version: 2, package: "pi-repl-py@0.8.0", files }, null, 2) + "\n");
console.log(JSON.stringify({ package: "pi-repl-py@0.8.0", files }));
