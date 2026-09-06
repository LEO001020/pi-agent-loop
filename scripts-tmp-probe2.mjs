import { createJiti } from "jiti";
import { execFileSync } from "node:child_process";
const jiti = createJiti(import.meta.url, { interopDefault: false });
const sandbox = await jiti.import("../src/sandbox.ts");
const config = await jiti.import("../src/config.ts");
const cfg = config.loadConfig(undefined, {});
const env = sandbox.toolEnvironment(cfg, { scratch: "C:/Users/hzq00/.local/share/pi-agent-loop/probe-scratch" });
console.log("PATH:", JSON.stringify(env.PATH));
console.log("HOME:", JSON.stringify(env.HOME));
const winBash = "C:/Program Files/Git/bin/bash.exe";
const cwd = "C:/Users/hzq00/.local/share/pi-agent-loop/probe-scratch/ws";
import { mkdirSync } from "node:fs";
mkdirSync(cwd, { recursive: true });
for (const [label, e] of [["bare toolEnvironment", env], ["merged", { ...process.env, ...env }]]) {
  try {
    const out = execFileSync(winBash, ["--noprofile", "--norc", "-c", "printf TOOL_SCOPE_OK > inside.txt && cat inside.txt"], { cwd, encoding: "utf8", env: e, timeout: 10000 });
    console.log(label, "=> OK:", JSON.stringify(out));
  } catch (err) {
    console.log(label, "=> FAIL status=", err.status, "stderr=", JSON.stringify((err.stderr ?? "").toString().slice(0, 300)), "msg=", err.message.slice(0, 300));
  }
}
