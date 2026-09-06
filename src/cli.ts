import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { InteractiveMode, ModelRuntime, SessionManager, runRpcMode } from "@earendil-works/pi-coding-agent";
import * as lockfile from "proper-lockfile";
import { ROOT, VERSION, credentials, loadConfig, prepareNativeConfig, redact, type Config } from "./config.ts";
import { Artifacts } from "./artifacts.ts";
import { privateDir, syncFile, within } from "./io.ts";
import { listSessions, openLoop } from "./runtime.ts";
import { TASK_ENTRY, validateState } from "./state.ts";
import { applyToSource, assertCandidate, type Candidate, type Origin } from "./workspace.ts";
import { scopedBash, type ToolScope } from "./sandbox.ts";

const HELP = `Pi Agent Loop ${VERSION}

  pi-agent-loop tui --workspace /path/to/project
  pi-agent-loop rpc --workspace /path/to/project
  pi-agent-loop --mode rpc                    # Pi desktop-compatible native RPC
  pi-agent-loop run --workspace DIR --task "task" [--json]
  pi-agent-loop tui --resume latest
  pi-agent-loop doctor [--offline]            # real configured-provider probes
  pi-agent-loop sessions
  pi-agent-loop export --resume SESSION --output result.patch
  pi-agent-loop apply --resume SESSION --confirm
  pi-agent-loop desktop

Configuration: --config FILE, --credentials FILE, --home DIR, --gemini-url URL,
               --scripts-only, --task-file FILE, --workspace DIR, --resume FILE.
Three fixed model roles; Gemini execution 10-20, Flash 1-8, one owner per profile.
Source directories are preserved. Applying an accepted patch is a separate explicit
operation which rejects changed user snapshots. See README for tested boundaries.
`;

interface Args { command: string; flags: Record<string, string | boolean> }
function parse(argv: string[]): Args {
  const args = [...argv];
  let command = args[0] && !args[0].startsWith("-") ? args.shift()! : "tui";
  const flags: Record<string, string | boolean> = {};
  const booleans = new Set(["help", "version", "json", "confirm", "scripts-only", "approve", "offline"]);
  const values = new Set(["config", "credentials", "home", "gemini-url", "workspace", "resume", "task", "task-file", "output", "mode", "model", "thinking", "provider"]);
  while (args.length) {
    const argument = args.shift()!;
    if (argument === "-a") { flags.approve = true; continue; }
    if (argument === "-h") { flags.help = true; continue; }
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    if (booleans.has(key)) flags[key] = true;
    else if (values.has(key)) {
      const value = args.shift(); if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`); flags[key] = value;
    } else throw new Error(`Unsupported option ${argument}. The pinned loop does not silently accept unknown native/package flags.`);
  }
  if (flags.mode === "rpc") command = "rpc";
  else if (flags.mode && flags.mode !== "interactive") throw new Error("The launcher supports native interactive and rpc modes; use run --json for task events.");
  return { command, flags };
}

async function doctor(cfg: Config, offline: boolean): Promise<unknown> {
  privateDir(cfg.home);
    const release = await lockfile.lock(cfg.home, { lockfilePath: join(cfg.home, "owner.lock"), stale: 60000, update: 10000, retries: 0 });
  try {
    const endpoints = credentials(cfg, false), agentDir = prepareNativeConfig(cfg, endpoints);
    const checks: Array<Record<string, unknown>> = [];
    const probeRoot = privateDir(join(cfg.home, "doctor", randomUUID())), root = privateDir(join(probeRoot, "workspace"));
    const outside = join(probeRoot, "outside.txt"); writeFileSync(outside, "UNCHANGED");
    const scope: ToolScope = { root, scratch: join(probeRoot, "scratch"), writable: true, writeScopes: ["."], readRoots: [] };
    let output = "", sandbox = false;
    try {
      const result = await scopedBash(cfg, scope).exec(`! cat '${outside}' && ! sh -c 'echo bad > "${outside}"' && printf TOOL_SCOPE_OK > inside.txt && cat inside.txt`, root,
        { timeout: 10, onData: chunk => { output += chunk.toString(); } });
      sandbox = result.exitCode === 0 && output.includes("TOOL_SCOPE_OK") && readFileSync(outside, "utf8") === "UNCHANGED";
      checks.push({ kind: "sandbox", passed: sandbox, exitCode: result.exitCode, output });
    } catch (error) { checks.push({ kind: "sandbox", passed: false, error: redact(String(error)) }); }
    let python = !cfg.python.enabled;
    if (cfg.python.enabled) {
      try {
        const result = execFileSync(cfg.python.executable, ["-c", "import ipykernel,jupyter_client,cloudpickle; print(ipykernel.__version__,jupyter_client.__version__,cloudpickle.__version__)"], { encoding: "utf8", timeout: 15000 });
        python = true; checks.push({ kind: "python-packages", passed: true, versions: result.trim(), persistenceTest: "see validation; an import probe alone does not prove a persistent kernel" });
      } catch (error) { checks.push({ kind: "python-packages", passed: false, error: redact(String(error)) }); }
    }
    if (!offline && endpoints.authenticated) {
      const models = await ModelRuntime.create({ modelsPath: join(agentDir, "models.json"), authPath: join(agentDir, "auth.json"), allowModelNetwork: false });
      for (const role of ["owner", "gemini", "flash"] as const) {
        const preset = cfg[role], model = models.getModel(preset.provider, preset.model), start = Date.now();
        if (!model) { checks.push({ role, passed: false, error: "Configured model missing" }); continue; }
        try {
          const reply = await models.completeSimple(model, { systemPrompt: "Transport test; reply exactly PI_LOOP_OK.", messages: [{ role: "user", content: "Reply PI_LOOP_OK", timestamp: Date.now() }] },
            { maxTokens: 256, signal: AbortSignal.timeout(90000) });
          const text = reply.content.filter(block => block.type === "text").map(block => block.text).join("");
          checks.push({ role, model: model.id, api: model.api, passed: reply.stopReason === "stop" && text.includes("PI_LOOP_OK"), durationMs: Date.now() - start,
            stopReason: reply.stopReason, text: redact(text), error: reply.errorMessage && redact(reply.errorMessage), usage: reply.usage });
        } catch (error) { checks.push({ role, model: model.id, passed: false, durationMs: Date.now() - start, error: redact(String(error)) }); }
      }
    }
    const passed = sandbox && python && (offline || (endpoints.authenticated && checks.filter(item => item.role).length === 3 && checks.filter(item => item.role).every(item => item.passed)));
    if (!passed) process.exitCode = 2;
    return { version: VERSION, node: process.version, platform: process.platform, architecture: process.arch, endpoints, checks, passed,
      providerProbes: offline ? "NOT_REQUESTED_OFFLINE" : endpoints.authenticated ? "ACTUALLY_ATTEMPTED" : "BLOCKED_CREDENTIAL", pricing: "USER_CONFIGURED_OR_UNKNOWN_NOT_FREE" };
  } finally { await release(); }
}

async function deliveryOperation(cfg: Config, command: string, flags: Args["flags"]): Promise<void> {
  if (typeof flags.resume !== "string") throw new Error("Identify the accepted native session with --resume");
    const release = await lockfile.lock(privateDir(cfg.home), { lockfilePath: join(cfg.home, "owner.lock"), stale: 60000, update: 10000, retries: 0 });
  try {
    const selected = flags.resume === "latest" ? (await listSessions(cfg)).sort((a, b) => b.modified.localeCompare(a.modified))[0]?.path : flags.resume;
    if (!selected || !within(join(cfg.home, "sessions"), resolve(selected))) throw new Error("Native session is outside this profile");
    credentials(cfg, false);
    const manager = SessionManager.open(selected), entry = [...manager.getBranch()].reverse().find(e => e.type === "custom" && e.customType === TASK_ENTRY);
    if (entry?.type !== "custom") throw new Error("No task state in the selected session");
    const state = validateState(entry.data), store = new Artifacts(join(cfg.home, "artifacts"));
    if (state.status !== "complete" || !state.delivery || !state.stage || !state.finalReceipt) throw new Error("Only a complete, current accepted delivery can be exported/applied");
    const candidate = JSON.parse(store.text(state.stage.artifact)) as Candidate; assertCandidate(candidate);
    store.path(state.finalReceipt);
    const patch = store.bytes(state.delivery);
    if (command === "export") {
      if (typeof flags.output !== "string") throw new Error("Provide --output result.patch");
      const output = resolve(flags.output);
      writeFileSync(output, patch, { flag: "wx", mode: 0o600 }); syncFile(output);
      console.log(JSON.stringify({ output, sha256: state.delivery.sha256, bytes: patch.length, sourceModified: false }));
    } else {
      if (flags.confirm !== true) throw new Error("Source application requires --confirm. Stop external writers during application.");
      const origin = JSON.parse(store.text(state.origin)) as Origin;
      applyToSource(origin, store.path(state.delivery));
      manager.appendCustomEntry("pi-agent-loop.source-application.v1", { taskId: state.id, patch: state.delivery, source: origin.source, at: Date.now() });
      syncFile(manager.getSessionFile()!);
      console.log(JSON.stringify({ applied: true, source: origin.source, patch: state.delivery.sha256 }));
    }
  } finally { await release(); }
}

export async function main(argv: string[]): Promise<void> {
  const { command, flags } = parse(argv);
  if (flags.help) { console.log(HELP); return; }
  if (flags.version) { console.log(`pi-agent-loop ${VERSION} (Pi 0.85.1)`); return; }
  const string = (name: string) => typeof flags[name] === "string" ? flags[name] as string : undefined;
  const cfg = loadConfig(string("config"), { ...(string("credentials") ? { credentialsFile: string("credentials")! } : {}),
    ...(string("home") ? { home: string("home")! } : {}), ...(string("gemini-url") ? { geminiUrl: string("gemini-url")! } : {}) });
  if (flags["scripts-only"]) cfg.python.enabled = false;
  if (flags.model && flags.model !== "auto" && flags.model !== cfg.owner.model && flags.model !== `${cfg.owner.provider}/${cfg.owner.model}`) throw new Error("The desktop root model must remain the configured GLM-5.3 owner");
  if (flags.provider && flags.provider !== cfg.owner.provider) throw new Error("The root provider is fixed by this deployment's owner preset");
  if (flags.thinking && flags.thinking !== cfg.owner.thinking) throw new Error(`Owner reasoning is ${cfg.owner.thinking}; change the explicit deployment configuration rather than a UI-only override`);
  if (command === "doctor") { console.log(redact(JSON.stringify(await doctor(cfg, flags.offline === true), null, 2))); return; }
  if (command === "sessions") { console.log(JSON.stringify(await listSessions(cfg), null, 2)); return; }
  if (command === "apply" || command === "export") { await deliveryOperation(cfg, command, flags); return; }
  if (command === "desktop") {
    const executable = process.env.PI_LOOP_DESKTOP ?? join(ROOT, "desktop", "src-tauri", "target", "release", "pi-app");
    if (!existsSync(executable)) throw new Error("Desktop binary not built. Run the documented desktop build or install the packaged Linux application.");
    const child = spawn(executable, [], { stdio: "inherit", env: { ...process.env, PI_LOOP_LAUNCHER: join(ROOT, "launch.sh"), PI_LOOP_CONFIG: string("config") ?? process.env.PI_LOOP_CONFIG,
      PI_LOOP_HOME: cfg.home, PI_LOOP_CREDENTIALS: cfg.credentialsFile } });
    await new Promise<void>((resolveDone, reject) => { child.once("error", reject); child.once("exit", code => { process.exitCode = code ?? 1; resolveDone(); }); });
    return;
  }
  if (!["tui", "rpc", "run"].includes(command)) throw new Error(`Unknown command ${command}\n${HELP}`);
  const task = string("task-file") ? readFileSync(resolve(string("task-file")!), "utf8") : string("task");
  if (string("task-file") && string("task")) throw new Error("Use --task or --task-file, not both");
  if (command === "run" && !task) throw new Error("run requires an explicit task");
  const loop = await openLoop(cfg, { workspace: string("workspace") ?? process.cwd(), resume: string("resume"), requireCredentials: command === "run" });
  try {
    if (command === "rpc") { await runRpcMode(loop.runtime); return; }
    if (command === "tui") { await new InteractiveMode(loop.runtime, task ? { initialMessage: task } : {}).run(); return; }
    await loop.bindHeadless(flags.json ? "json" : "print");
    const onEvent = (event: any): void => {
      if (flags.json) process.stdout.write(redact(JSON.stringify(event)) + "\n");
      else if (event.type === "control_error" || event.type === "initialization_error") process.stderr.write(redact(JSON.stringify(event.data)) + "\n");
    };
    loop.events.on("event", onEvent);
    const stop = () => { void loop.binding().controller!.stop("cancelled", "CLI received a termination signal").catch(error => process.stderr.write(redact(String(error)) + "\n")); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try {
      await loop.runtime.session.prompt(task!);
      // Wait on the task predicate while native completion events drive any
      // additional model turns. This is not a second provider/agent loop.
      while (loop.binding().controller?.state?.status === "running") await new Promise(resolveTick => setTimeout(resolveTick, 250));
      await loop.runtime.session.waitForIdle();
      const state = loop.binding().controller?.state;
      if (!flags.json) {
        if (state?.finalReceipt) {
          const receipt = JSON.parse(loop.binding().store.text(state.finalReceipt)); console.log(receipt.conclusion);
        }
        console.log(JSON.stringify({ status: state?.status ?? "unknown", reason: state?.reason, nativeSession: loop.runtime.session.sessionFile,
          delivery: state?.delivery && loop.binding().store.path(state.delivery), sourceModified: false }, null, 2));
      }
      process.exitCode = state?.status === "complete" ? 0 : 3;
    } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); loop.events.off("event", onEvent); }
  } finally { await loop.close(); }
}
