import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import * as lockfile from "proper-lockfile";
import {
  createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, ModelRuntime, SessionManager,
  type AgentSession, type AgentSessionRuntime, type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import { Artifacts, type Artifact } from "./artifacts.ts";
import { credentials, prepareNativeConfig, redact, type Config } from "./config.ts";
import { ensureNativePersistence, privateDir, syncFile, within } from "./io.ts";
import { importWorkspace, type Origin } from "./workspace.ts";
import { ORIGIN_ENTRY, TASK_ENTRY, validateState } from "./state.ts";
import { setupLoop, type LoopBinding } from "../extensions/loop.ts";

export interface LoopRuntime {
  readonly cfg: Config;
  readonly runtime: AgentSessionRuntime;
  readonly models: ModelRuntime;
  readonly events: EventEmitter;
  binding(): LoopBinding;
  bindHeadless(mode?: "print" | "json"): Promise<void>;
  close(): Promise<void>;
}
export async function listSessions(cfg: Config): Promise<Array<{ path: string; id: string; name: string; status: string; source?: string; modified: string }>> {
  const dir = join(cfg.home, "sessions");
  if (!existsSync(dir)) return [];
  const sessions = await SessionManager.list("/", dir);
  return sessions.map(item => {
    try {
      const manager = SessionManager.open(item.path, dir);
      const entry = [...manager.getBranch()].reverse().find(e => e.type === "custom" && e.customType === TASK_ENTRY);
      const state = entry?.type === "custom" ? validateState(entry.data) : undefined;
      return { path: item.path, id: item.id, name: manager.getSessionName() ?? state?.id ?? item.id, status: state?.status ?? "no_task", modified: item.modified.toISOString() };
    } catch (error) { return { path: item.path, id: item.id, name: item.id, status: "corrupt_or_incompatible", modified: item.modified.toISOString() }; }
  });
}

export async function openLoop(cfg: Config, options: { workspace?: string; resume?: string; requireCredentials?: boolean } = {}): Promise<LoopRuntime> {
  privateDir(cfg.home);
  const release = await lockfile.lock(cfg.home, { lockfilePath: join(cfg.home, "owner.lock"), stale: 60000, update: 10000, retries: 0 })
    .catch(() => { throw new Error("OWNER_BUSY: one GLM owner already holds this profile. Use its desktop session, or wait for stale-lock recovery after a crash."); });
  let runtime: AgentSessionRuntime | undefined, closed = false;
  const events = new EventEmitter(); events.setMaxListeners(100);
  const bindings = new WeakMap<AgentSession, LoopBinding>();
  try {
    const endpoints = credentials(cfg, options.requireCredentials ?? true);
    const agentDir = prepareNativeConfig(cfg, endpoints);
    const store = new Artifacts(join(cfg.home, "artifacts"));
    const sessionDir = privateDir(join(cfg.home, "sessions"));
    let manager: SessionManager, initialOrigin: Origin, initialOriginRef: Artifact;
    if (options.resume) {
      const selected = options.resume === "latest" ? (await listSessions(cfg)).sort((a, b) => b.modified.localeCompare(a.modified))[0]?.path : options.resume;
      if (!selected || !existsSync(selected) || !within(realpathSync(sessionDir), realpathSync(selected))) throw new Error("RESUME_SESSION_NOT_IN_PROFILE: choose an existing native session from this profile");
      manager = SessionManager.open(selected, sessionDir);
      const entry = [...manager.getBranch()].reverse().find(entry => entry.type === "custom" && entry.customType === ORIGIN_ENTRY);
      if (entry?.type !== "custom") throw new Error("Native session has no Pi Agent Loop origin binding");
      initialOriginRef = entry.data as Artifact;
      initialOrigin = JSON.parse(store.text(initialOriginRef)) as Origin;
      if (realpathSync(manager.getCwd()) !== realpathSync(initialOrigin.repo)) throw new Error("SESSION_ORIGIN_CWD_MISMATCH");
    } else {
      if (!options.workspace) throw new Error("Provide a workspace directory or an explicit native session to resume");
      initialOrigin = importWorkspace(cfg, options.workspace);
      initialOriginRef = store.put(initialOrigin, { media: "application/json", provenance: "host-record", label: "preserved-original-workspace" });
      manager = SessionManager.create(initialOrigin.repo, sessionDir);
      ensureNativePersistence(manager);
      manager.appendCustomEntry(ORIGIN_ENTRY, initialOriginRef);
      syncFile(manager.getSessionFile()!);
    }
    const models = await ModelRuntime.create({ modelsPath: join(agentDir, "models.json"), authPath: join(agentDir, "auth.json"), allowModelNetwork: false });
    const factory: CreateAgentSessionRuntimeFactory = async args => {
      if (!within(join(cfg.home, "projects"), realpathSync(args.cwd))) throw new Error("Session cwd is not an owned preserved workspace");
      ensureNativePersistence(args.sessionManager);
      const entry = [...args.sessionManager.getBranch()].reverse().find(entry => entry.type === "custom" && entry.customType === ORIGIN_ENTRY);
      const originRef = entry?.type === "custom" ? entry.data as Artifact : initialOriginRef;
      const origin = JSON.parse(store.text(originRef)) as Origin;
      if (realpathSync(origin.repo) !== realpathSync(args.cwd)) throw new Error("Refusing to bind an origin from another workspace");
      if (!entry) { args.sessionManager.appendCustomEntry(ORIGIN_ENTRY, originRef); syncFile(args.sessionManager.getSessionFile()!); }
      let session: AgentSession | undefined, abort: (() => Promise<void>) | undefined;
      const binding: LoopBinding = { cfg, origin, originRef, store, manager: args.sessionManager, ready: false,
        publish(type, data) { events.emit("event", { type, data, sessionId: args.sessionManager.getSessionId(), at: Date.now() }); },
        clearContinuation() { session?.clearQueue(); session?.abortRetry(); session?.abortCompaction(); },
        abortRoot() { return abort?.() ?? Promise.resolve(); },
        resetPython() { binding.python?.reset(); },
      };
      const services = await createAgentSessionServices({ cwd: args.cwd, agentDir: args.agentDir, modelRuntime: models,
        resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
          additionalExtensionPaths: [createRequire(import.meta.url).resolve("pi-subagents")],
          extensionFactories: [{ name: "pi-agent-loop", factory: pi => setupLoop(pi, binding) }] } });
      const extensionErrors = services.resourceLoader.getExtensions().errors;
      if (extensionErrors.length || services.diagnostics.some(item => item.type === "error")) throw new Error(`EXTENSION_INITIALIZATION_FAILED: ${JSON.stringify({ extensionErrors, diagnostics: services.diagnostics })}`);
      const model = models.getModel(cfg.owner.provider, cfg.owner.model);
      if (!model) throw new Error(`OWNER_MODEL_NOT_CONFIGURED: ${models.getError() ?? "unknown"}`);
      const result = await createAgentSessionFromServices({ services, sessionManager: args.sessionManager, sessionStartEvent: args.sessionStartEvent,
        model, thinkingLevel: cfg.owner.thinking, scopedModels: [{ model, thinkingLevel: cfg.owner.thinking }] });
      session = result.session; binding.session = session; bindings.set(session, binding);
      abort = session.abort.bind(session);
      const nativePrompt = session.prompt.bind(session), nativeSteer = session.steer.bind(session), nativeFollow = session.followUp.bind(session);
      let inputDepth = 0;
      const requireReady = (): void => {
        if (!binding.ready || !binding.controller) throw new Error(`LOOP_NOT_INITIALIZED: ${binding.initializationError ?? "bind the native session first"}`);
      };
      session.prompt = async (text, opts) => {
        requireReady();
        if (opts?.source !== "extension" && !(text.startsWith("/") && opts?.expandPromptTemplates !== false)) binding.controller!.input(text);
        // Native prompt may route a streaming user message through steer/followUp.
        // That is one user revision, not another independently accepted input.
        inputDepth++;
        try { return await nativePrompt(text, opts); } finally { inputDepth--; }
      };
      session.steer = async (text, images) => { requireReady(); if (!inputDepth) binding.controller!.input(text); return nativeSteer(text, images); };
      session.followUp = async (text, images) => { requireReady(); if (!inputDepth) binding.controller!.input(text); return nativeFollow(text, images); };
      session.abort = async () => {
        if (!binding.ready || !binding.controller) { await abort!(); return; }
        await binding.controller.stop("paused", "Native abort requested: task continuation and owned children were stopped together.");
      };
      const nativeStream = session.agent.streamFunction;
      session.agent.streamFunction = (requested, context, streamOptions) => {
        requireReady(); binding.controller!.authorizeOwner();
        if (requested.provider !== cfg.owner.provider || requested.id !== cfg.owner.model) throw new Error("OWNER_MODEL_BINDING_VIOLATION");
        return nativeStream(requested, context, streamOptions);
      };
      const nativeStop = session.agent.shouldStopAfterTurn;
      session.agent.shouldStopAfterTurn = async (context, signal) => {
        const status = binding.controller?.state?.status;
        return (status !== undefined && status !== "running") || (await nativeStop?.(context, signal)) === true;
      };
      const nativeSetModel = session.setModel.bind(session);
      session.setModel = async (requested, options) => {
        if (requested.provider !== cfg.owner.provider || requested.id !== cfg.owner.model) throw new Error("The root remains the single configured GLM-5.3 owner; select execution pools through loop tasks");
        return nativeSetModel(requested, options);
      };
      const nativeBind = session.bindExtensions.bind(session);
      session.bindExtensions = async (...bindArgs) => {
        await nativeBind(...bindArgs);
        if (!binding.ready) throw new Error(`LOOP_BIND_FAILED: ${binding.initializationError ?? "session-start did not initialize"}`);
      };
      session.navigateTree = async () => { throw new Error("Use native session fork/resume through the host; in-place tree rewinds do not silently rewind task evidence or live workspaces"); };
      session.subscribe(event => events.emit("event", { type: "pi", data: event, sessionId: args.sessionManager.getSessionId(), at: Date.now() }));
      return { ...result, services, diagnostics: services.diagnostics };
    };
    runtime = await createAgentSessionRuntime(factory, { cwd: initialOrigin.repo, agentDir, sessionManager: manager,
      sessionStartEvent: { type: "session_start", reason: options.resume ? "resume" : "new" } });
    const ownedRuntime = runtime;
    const nativeSwitch = runtime.switchSession.bind(runtime);
    runtime.switchSession = async (path, options) => {
      if (!existsSync(path) || !within(realpathSync(sessionDir), realpathSync(path))) throw new Error("Session replacement is restricted to this profile's native sessions");
      return nativeSwitch(path, options);
    };
    const facade: LoopRuntime = { cfg, runtime: ownedRuntime, models, events,
      binding() { const binding = bindings.get(ownedRuntime.session); if (!binding) throw new Error("Native session binding missing"); return binding; },
      async bindHeadless(mode = "print") {
        const bind = async (): Promise<void> => {
          const session = ownedRuntime.session;
          await session.bindExtensions({ mode,
            commandContextActions: { waitForIdle: () => session.waitForIdle(), newSession: opts => ownedRuntime.newSession(opts),
              switchSession: (path, opts) => ownedRuntime.switchSession(path, opts),
              fork: async (entry, opts) => ({ cancelled: (await ownedRuntime.fork(entry, opts)).cancelled }),
              navigateTree: async () => { throw new Error("Use native fork/resume"); },
              reload: async () => { throw new Error("Restart the pinned runtime to reload packages; dynamic package replacement invalidates the audited artifact boundary"); } },
            onError: error => events.emit("event", { type: "extension_error", data: { error: redact(error.error), event: error.event }, at: Date.now() }) });
        };
        ownedRuntime.setRebindSession(bind); await bind();
      },
      async close() {
        if (closed) return; closed = true;
        try { await ownedRuntime.dispose(); }
        finally { await release(); events.removeAllListeners(); }
      },
    };
    return facade;
  } catch (error) {
    if (runtime) await runtime.dispose().catch(() => undefined);
    await release(); throw error;
  }
}
