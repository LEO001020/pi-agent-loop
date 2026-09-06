import { createRequire } from "node:module";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { credentials, loadConfig, prepareNativeConfig, redact } from "../src/config.ts";
import { ensureNativePersistence, privateDir } from "../src/io.ts";
import { NativeClient, registerNativeAgent } from "../src/native.ts";
import lockfile from "proper-lockfile";

const cfg = loadConfig(undefined, { credentialsFile: "/workspace/.credentials/credentials.json", home: "/workspace/live-native-seam" });
privateDir(cfg.home);
const release = await lockfile.lock(cfg.home, { lockfilePath: join(cfg.home, "owner.lock"), retries: 0 });
const cwd = privateDir(join(cfg.home, "projects", `fixture-${Date.now()}`, "repo"));
writeFileSync(join(cwd, "known.txt"), "NATIVE_REAL_READ_528017\n");
for (const args of [["init"], ["add", "known.txt"], ["-c", "user.name=Pi Loop Test", "-c", "user.email=test@localhost", "commit", "-m", "fixture"]]) execFileSync("git", args, { cwd, stdio: "pipe" });
const agentDir = prepareNativeConfig(cfg, credentials(cfg));
const manager = SessionManager.create(cwd, join(cfg.home, "sessions"));
ensureNativePersistence(manager);
manager.appendCustomEntry("loop.seam.first-write", { marker: "first-write-before-provider", at: Date.now() });
console.log("FIRST_WRITE", existsSync(manager.getSessionFile()!), readFileSync(manager.getSessionFile()!, "utf8").includes("first-write-before-provider"));
let native!: NativeClient;
const registrations: Array<{ dispose(): void }> = [];
const loader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true, noSkills: true, noContextFiles: true,
  additionalExtensionPaths: [createRequire(import.meta.url).resolve("pi-subagents")],
  extensionFactories: [pi => {
    native = new NativeClient(pi.events);
    pi.on("session_start", () => {
      for (const pool of ["gemini", "flash"] as const) registrations.push(registerNativeAgent(pi, `seam-${pool}`, {
        description: "Read-only transport probe", systemPrompt: "Read the requested file with the read tool and report exactly its contents. No other work.",
        model: `${cfg[pool].provider}/${cfg[pool].model}`, thinking: cfg[pool].thinking,
        tools: ["read"], extensions: [], inheritProjectContext: false, inheritGlobalContext: false, inheritSkills: false,
        defaultContext: "fresh", defaultTimeoutMs: 60000, maxSubagentDepth: 1, completionGuard: false,
      }));
    });
    pi.on("session_shutdown", () => { registrations.splice(0).forEach(r => r.dispose()); });
    pi.events.on("subagent:async-complete", data => console.log("ASYNC_COMPLETE", redact(JSON.stringify(data))));
    pi.events.on("subagent:process-terminal", data => console.log("PROCESS_TERMINAL", redact(JSON.stringify(data))));
  }],
});
await loader.reload();
if (loader.getExtensions().errors.length) throw new Error(JSON.stringify(loader.getExtensions().errors));
const modelRuntime = await ModelRuntime.create({ modelsPath: join(agentDir, "models.json"), authPath: join(agentDir, "auth.json"), allowModelNetwork: false });
const { session } = await createAgentSession({ cwd, agentDir, modelRuntime, resourceLoader: loader, sessionManager: manager,
  model: modelRuntime.getModel(cfg.owner.provider, cfg.owner.model) });
// Extension event exceptions are logged by Pi and do not stop provider requests.
// This public native Agent stream boundary actually prevents root inference.
session.agent.streamFunction = () => { throw new Error("SEAM_ROOT_DISABLED: only explicitly requested children may call models"); };
try {
  await session.bindExtensions({ mode: "print", onError: error => console.error("EXTENSION_ERROR", redact(JSON.stringify(error))) });
  console.log("PING", JSON.stringify(await native.capabilities()));
  const pool = process.argv.includes("--flash") ? "flash" : "gemini";
  const launched = await native.spawn({ agent: `seam-${pool}`, task: "Read known.txt and return its exact contents.", cwd,
    context: "fresh", worktree: true, baseRef: "HEAD", artifacts: true, skill: false, timeoutMs: 60000 });
  console.log("LAUNCH", redact(JSON.stringify(launched)));
  let observed = false;
  for (let i = 0; i < 90; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const status = await native.status(launched.runId);
    console.log("STATUS", redact(JSON.stringify(status)));
    const file = join(launched.asyncDir, "status.json");
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      if (!["running", "queued", "pending"].includes(raw.state)) {
        console.log("RAW_TERMINAL", redact(JSON.stringify(raw)));
        const handoff = JSON.parse(readFileSync(join(launched.asyncDir, "handoff.json"), "utf8"));
        console.log("HANDOFF_CHECK", JSON.stringify(handoff));
        observed = raw.state === "complete" && handoff.groups.length === 1 && handoff.groups[0].children.length === 1 && !handoff.groups[0].children[0].patch.error;
        break;
      }
    }
  }
  if (!observed) { await native.stop(launched.runId).catch(error => console.error(String(error))); process.exitCode = 1; }
} finally {
  session.clearQueue();
  await session.abort();
  await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  session.dispose();
  await release();
}
