import { createJiti } from "jiti";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const jiti = createJiti(import.meta.url, { interopDefault: false });
const sandbox = await jiti.import("../src/sandbox.ts");
const config = await jiti.import("../src/config.ts");
const cfg = config.loadConfig(undefined, {});
const probeRoot = mkdtempSync(join(tmpdir(), "probe3-"));
const root = join(probeRoot, "workspace"); mkdirSync(root, { recursive: true });
const outside = join(probeRoot, "outside.txt"); writeFileSync(outside, "UNCHANGED");
const scope = { root, scratch: join(probeRoot, "scratch"), writable: true, writeScopes: ["."], readRoots: [] };
const command = `! cat '${outside}' && ! sh -c 'echo bad > "${outside}"' && printf TOOL_SCOPE_OK > inside.txt && cat inside.txt`;

// 1. what does the win32 branch actually execute? replicate manually
const cut = command.indexOf("printf TOOL_SCOPE_OK");
const sliced = command.slice(cut);
console.log("SLICED:", JSON.stringify(sliced));

const env = { ...process.env, ...sandbox.toolEnvironment(cfg, scope) };
const winBash = "C:/Program Files/Git/bin/bash.exe";
try {
  const out = execFileSync(winBash, ["--noprofile", "--norc", "-c", sliced], { cwd: root, encoding: "utf8", env, timeout: 10000 });
  console.log("manual sliced =>", JSON.stringify(out));
} catch (e) {
  console.log("manual sliced FAIL:", e.status, JSON.stringify(e.message.slice(0, 400)));
}
// 2. through scopedBash
let output = "";
const result = await sandbox.scopedBash(cfg, scope).exec(command, root, { timeout: 10, onData: c => { output += c.toString(); } });
console.log("scopedBash:", JSON.stringify({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }));
