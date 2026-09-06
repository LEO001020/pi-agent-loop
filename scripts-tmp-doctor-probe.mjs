import { createJiti } from "jiti";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const jiti = createJiti(import.meta.url, { interopDefault: false });
const sandbox = await jiti.import("../src/sandbox.ts");
const config = await jiti.import("../src/config.ts");
const cfg = config.loadConfig(undefined, {});
console.log("cfg.sandbox:", JSON.stringify(cfg.sandbox));
console.log("cfg.home:", cfg.home);

// mimic doctor probe
const { privateDir } = await jiti.import("../src/io.ts");
const probeRoot = privateDir(join(cfg.home, "doctor-probe-test", String(Date.now())));
const root = privateDir(join(probeRoot, "workspace"));
const outside = join(probeRoot, "outside.txt");
writeFileSync(outside, "UNCHANGED");
const scope = { root, scratch: join(probeRoot, "scratch"), writable: true, writeScopes: ["."], readRoots: [] };

const command = `! cat '${outside}' && ! sh -c 'echo bad > "${outside}"' && printf TOOL_SCOPE_OK > inside.txt && cat inside.txt`;
let output = "";
const result = await sandbox.scopedBash(cfg, scope).exec(command, root, { timeout: 10, onData: c => { output += c.toString(); } });
console.log("RESULT:", JSON.stringify({ exitCode: result.exitCode, stdout: result.stdout, stderr: (result.stderr || "").slice(0, 500) }));
console.log("onData output:", JSON.stringify(output));
console.log("outside still:", readFileSync(outside, "utf8"));
console.log("env used PATH:", sandbox.toolEnvironment(cfg, scope).PATH);
console.log("env used HOME:", sandbox.toolEnvironment(cfg, scope).HOME);
