import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentSession, ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import { Artifacts, type Artifact } from "./artifacts.ts";
import { type Config, ROOT, redact } from "./config.ts";
import type { ChildContract } from "./child-contract.ts";
import { atomicJson, jsonHash, privateDir, readJson, relativePath, safeId, sha256, syncFile, within } from "./io.ts";
import { NativeClient, NativeRpcError, registerNativeAgent, type NativeReply } from "./native.ts";
import { checkPath, type ToolScope } from "./sandbox.ts";
import {
  addUsage, emptyUsage, invalidateDescendants, newTask, parseUsage, progressKey, remember, requirementText, TaskJournal, taskUsage,
  topological, usageTokens, versionsCurrent,
  type Attempt, type NodeSpec, type Observation, type Obligation, type StageRef, type TaskNode, type TaskState, type TaskStatus,
} from "./state.ts";
import {
  assertCandidate, candidateFrom, candidatePatch, git, gitText, inScope, patchPaths, treeIdentity,
  type Candidate, type Origin, type PatchInput,
} from "./workspace.ts";
import { environmentIdentity, observeCommand, verifyCandidate, type CheckSpec, type VerificationReceipt } from "./verification.ts";

export interface ControllerHost {
  readonly cfg: Config;
  readonly origin: Origin;
  readonly originRef: Artifact;
  readonly store: Artifacts;
  readonly manager: SessionManager;
  session?: AgentSession;
  publish(type: string, data: unknown): void;
  clearContinuation(): void;
  abortRoot(): Promise<void>;
  resetPython(): void;
}
interface Fence { task: string; revision: number; generation: number }
const TERMINAL = new Set(["complete", "completed", "failed", "cancelled", "canceled", "interrupted", "stopped", "timed_out"]);
const ACTIVE = new Set(["starting", "running", "unknown"]);
const childError = (value: unknown): string => redact(value instanceof Error ? value.message : String(value)).slice(0, 6000);

/** Task-specific semantics over upstream Pi sessions and subagent lifecycle.
 * Native owns execution/scheduling; this class owns input validity, admission,
 * original obligations and current-evidence acceptance. */
export class TaskController {
  state?: TaskState;
  readonly journal: TaskJournal;
  readonly native: NativeClient;
  private stopped = false;
  private disposed = false;
  private refreshing?: Promise<void>;
  private operation?: AbortController;
  private mutationBusy = false;
  private deadline?: ReturnType<typeof setTimeout>;
  private poller?: ReturnType<typeof setInterval>;
  private continuationCount = 0;
  private lastProgress = "";
  private registrations: Array<{ dispose(): void }> = [];
  private listeners: Array<() => void> = [];
  private backgroundError?: string;

  constructor(readonly pi: ExtensionAPI, readonly host: ControllerHost) {
    this.journal = new TaskJournal(host.manager, (type, value) => pi.appendEntry(type, value));
    this.native = new NativeClient(pi.events);
  }
  async attach(): Promise<void> {
    this.state = this.journal.restore();
    this.stopped = this.state?.status !== "running";
    await this.native.capabilities();
    if (this.state) {
      this.host.store.path(this.state.original); this.host.store.path(this.state.origin);
      this.checkpoint();
    }
    for (const event of ["subagent:async-complete", "subagent:process-terminal"]) {
      this.listeners.push(this.pi.events.on(event, () => { void this.refresh().catch(error => this.reportBackground(error)); }));
    }
    this.poller = setInterval(() => {
      if (!this.disposed && this.liveAttempts().length) void this.refresh().catch(error => this.reportBackground(error));
    }, 1500);
    this.poller.unref();
    this.emit();
  }
  snapshot(): TaskState | undefined { return this.state ? structuredClone(this.state) : undefined; }
  hasOperation(): boolean { return this.mutationBusy || Boolean(this.operation); }
  private reportBackground(error: unknown): void {
    this.backgroundError = childError(error);
    this.host.publish("diagnostic", { error: this.backgroundError, outcome: "not silently accepted" });
  }
  private checkpoint(): void {
    if (!this.state) return;
    try { this.journal.save(this.state); }
    catch (error) {
      this.stopped = true;
      this.host.clearContinuation(); this.operation?.abort(); this.host.resetPython();
      for (const attempt of this.liveAttempts()) if (attempt.runId) void this.native.stop(attempt.runId).catch(failure => this.reportBackground(failure));
      void this.host.abortRoot().catch(failure => this.reportBackground(failure));
      this.emit();
      throw error;
    }
    this.emit();
  }
  private emit(): void { this.host.publish("loop", this.projection()); }
  private current(): TaskState {
    const state = this.state;
    if (!state || state.status !== "running" || this.stopped || this.journal.failed || this.disposed) throw new Error(`TASK_NOT_RUNNING: ${state?.status ?? "no task"}`);
    if (Date.now() - state.startedAt >= this.host.cfg.budget.seconds * 1000 || usageTokens(taskUsage(state)) >= this.host.cfg.budget.tokens) {
      this.latch("budget_exhausted", "The whole-task reported-usage/time budget is exhausted. In-flight calls may have unreported usage; this is not a billing guarantee.");
      void this.stopOwned().catch(error => this.reportBackground(error));
      throw new Error("TASK_BUDGET_EXHAUSTED");
    }
    return state;
  }
  authorizeOwner(): void { this.current(); }
  private fence(): Fence { const s = this.current(); return { task: s.id, revision: s.revision, generation: s.generation }; }
  private assertFence(fence: Fence): TaskState {
    const s = this.current();
    if (s.id !== fence.task || s.revision !== fence.revision || s.generation !== fence.generation) throw new Error("STALE_ATTEMPT_REJECTED: task revision or cancellation generation changed");
    return s;
  }
  private ref(id: string): Artifact {
    const ref = this.state?.artifacts[id];
    if (!ref) throw new Error("Artifact is not part of this task's recorded evidence");
    this.host.store.path(ref);
    return ref;
  }
  private put(value: string | Buffer | object, label: string, provenance: Artifact["provenance"] = "host-record", media: Artifact["media"] = "application/json"): Artifact {
    const state = this.state; if (!state) throw new Error("No active task");
    return remember(state, this.host.store.put(value, { label, provenance, media }));
  }
  private taskRoot(): string {
    if (!this.state) throw new Error("No task");
    return privateDir(join(this.host.cfg.home, "tasks", safeId(this.state.id)));
  }
  private armDeadline(): void {
    if (this.deadline) clearTimeout(this.deadline);
    if (this.state?.status !== "running") return;
    const remaining = Math.max(1, this.host.cfg.budget.seconds * 1000 - (Date.now() - this.state.startedAt));
    this.deadline = setTimeout(() => {
      this.latch("budget_exhausted", "Whole-task wall-clock budget exhausted; artifacts and unresolved obligations are retained.");
      void this.stopOwned().finally(() => this.host.abortRoot()).catch(error => this.reportBackground(error));
    }, remaining);
    this.deadline.unref();
  }

  input(text: string): void {
    if (!text.trim() || text.length > 200000) throw new Error("Task input must contain 1-200000 characters; put larger data in workspace files");
    if (this.journal.failed) throw new Error("Durability failure must be reconciled before accepting new input");
    this.host.clearContinuation(); this.operation?.abort(); this.host.resetPython();
    const input = this.host.store.put(text, { media: "text/plain", provenance: "user-input", label: "unaltered-user-request" });
    if (!this.state || this.state.status === "complete") this.state = newTask(input, this.host.originRef);
    else {
      const state = this.state;
      state.revision++; state.generation++;
      state.amendments.push(remember(state, input));
      invalidateDescendants(state, Object.keys(state.nodes));
      state.status = "running";
      state.reason = "User revision retained verbatim. Previous interpretations/checks must be reconsidered against this revision.";
      delete state.stage; state.reviews = [];
    }
    this.stopped = false; this.continuationCount = 0; this.lastProgress = "";
    this.checkpoint(); this.armDeadline();
    if (this.state.orphanedRuns.length) void this.stopOwned(true).catch(error => this.reportBackground(error));
  }
  setObligations(obligations: Obligation[]): unknown {
    const state = this.current();
    if (this.mutationBusy) throw new Error("A control mutation is in progress");
    if (!obligations.length || obligations.length > 128) throw new Error("Use 1-128 material obligations");
    const ids = new Set<string>(), inputs = new Set([state.original.id, ...state.amendments.map(ref => ref.id)]);
    for (const obligation of obligations) {
      safeId(obligation.id);
      if (ids.has(obligation.id) || !obligation.description.trim() || obligation.description.length > 2000) throw new Error("Invalid or duplicate obligation");
      ids.add(obligation.id);
      if (!inputs.has(obligation.source) || !obligation.quote || !this.host.store.text(this.ref(obligation.source)).includes(obligation.quote)) throw new Error("OBLIGATION_SOURCE_MISMATCH: quote must occur in the unaltered user input");
    }
    state.obligations = structuredClone(obligations);
    state.reason = "Obligations are an owner interpretation; the full unaltered request remains authoritative.";
    state.reviews = [];
    this.checkpoint();
    return { obligations, original: state.original, amendments: state.amendments };
  }
  private validateNodeSpec(spec: NodeSpec, state: TaskState): void {
    safeId(spec.id);
    if (!["gemini", "flash"].includes(spec.pool) || !["inspect", "patch", "select", "review"].includes(spec.kind)) throw new Error("Invalid node role/pool");
    if (spec.kind === "patch" && spec.pool !== "gemini") throw new Error("Repository implementation lanes belong to the fixed Gemini execution layer");
    if (!spec.task.trim() || spec.task.length > 24000 || spec.dependsOn.length > 100 || spec.scope.length > 80) throw new Error("Node contract exceeds bounds");
    if (new Set(spec.dependsOn).size !== spec.dependsOn.length || spec.dependsOn.includes(spec.id)) throw new Error("Invalid dependency list");
    spec.dependsOn.forEach(safeId);
    if (spec.kind === "patch" && !spec.scope.length) throw new Error("Patch nodes require an explicit write scope");
    for (const path of spec.scope) if (path !== ".") relativePath(path);
    for (const id of spec.obligations) if (!state.obligations.some(item => item.id === id)) throw new Error(`Unknown original obligation: ${id}`);
    if (spec.alternativeGroup) safeId(spec.alternativeGroup);
  }
  async define(specs: NodeSpec[]): Promise<unknown> {
    const state = this.current();
    if (this.mutationBusy || this.operation) throw new Error("Wait for the current control operation");
    if (!state.obligations.length) throw new Error("Record source-bound original obligations before defining work");
    if (!specs.length || specs.length > 100 || new Set(specs.map(s => s.id)).size !== specs.length) throw new Error("Use 1-100 distinct node contracts");
    specs.forEach(spec => this.validateNodeSpec(spec, state));
    const preview = structuredClone(state.nodes);
    for (const spec of specs) preview[spec.id] = { ...(preview[spec.id] ?? {}), id: spec.id, dependsOn: spec.dependsOn } as TaskNode;
    topological(preview);
    if (Object.keys(preview).length > this.host.cfg.budget.nodes) throw new Error("Task node budget exceeded");
    const changed = specs.filter(spec => state.nodes[spec.id] && this.host.store.text(state.nodes[spec.id].spec) !== JSON.stringify(spec, null, 2) + "\n").map(spec => spec.id);
    if (changed.length) invalidateDescendants(state, changed);
    for (const spec of specs) {
      const existing = state.nodes[spec.id], ref = this.put(spec, `node-spec-${spec.id}`);
      if (existing && existing.spec.id === ref.id && !["stale", "failed", "rejected", "cancelled"].includes(existing.status)) continue;
      const priorAttempts = [...(existing?.priorAttempts ?? [])];
      if (existing?.attempt) priorAttempts.push(this.put(existing.attempt, `attempt-history-${existing.attempt.id}`));
      const version = existing ? existing.version + (changed.includes(spec.id) || existing.status === "stale" ? 0 : 1) : 1;
      state.nodes[spec.id] = { id: spec.id, version, pool: spec.pool, kind: spec.kind, label: spec.task.slice(0, 240), spec: ref,
        dependsOn: [...spec.dependsOn], status: "pending", priorAttempts };
    }
    this.checkpoint();
    if (state.orphanedRuns.length) await this.stopOwned(true);
    return { changed, nodes: specs.map(spec => this.nodeView(state.nodes[spec.id])) };
  }
  private spec(node: TaskNode): NodeSpec { return JSON.parse(this.host.store.text(node.spec)) as NodeSpec; }
  private rootCandidate(): Candidate {
    const origin = this.host.origin;
    if (treeIdentity(origin.repo).sha256 !== origin.initial.sha256 || gitText(origin.repo, ["rev-parse", "HEAD"]) !== origin.commit) throw new Error("ORIGIN_CHANGED: the preserved task baseline was modified");
    return { id: `origin-${origin.commit}`, root: origin.repo, commit: origin.commit, tree: origin.initial, nodeVersions: {}, patches: [] };
  }
  private candidate(ref: Artifact): Candidate {
    const candidate = JSON.parse(this.host.store.text(ref)) as Candidate;
    if (!candidate || !within(this.host.cfg.home, candidate.root) || !candidate.tree || !candidate.nodeVersions || !Array.isArray(candidate.patches)) throw new Error("FOREIGN_CANDIDATE_REFERENCE");
    assertCandidate(candidate); return candidate;
  }
  private buildCandidate(ids: string[], allowReturned = false): Candidate {
    const state = this.current();
    if (!ids.length) return this.rootCandidate();
    const order = topological(state.nodes, ids), versions: Record<string, number> = {}, patches: PatchInput[] = [], groups = new Set<string>();
    for (const id of order) {
      const node = state.nodes[id], spec = this.spec(node);
      if (node.status !== "admitted" && !(allowReturned && ids.includes(id) && node.status === "returned")) throw new Error(`UNADMITTED_INPUT: ${id}`);
      if (!node.attempt || !versionsCurrent(state, node.attempt.inputVersions)) throw new Error(`STALE_NODE_INPUTS: ${id}`);
      versions[id] = node.version;
      if (node.kind === "patch") {
        if (!node.attempt.patch || !node.attempt.preimages) throw new Error(`MISSING_NATIVE_PATCH: ${id}`);
        if (spec.alternativeGroup && groups.has(spec.alternativeGroup)) throw new Error(`COMPETING_PATCHES: ${spec.alternativeGroup}; select one or construct a new explicit integration node`);
        if (spec.alternativeGroup) groups.add(spec.alternativeGroup);
        const base = this.candidate(node.attempt.base);
        patches.push({ nodeId: id, version: node.version, path: this.host.store.path(node.attempt.patch), sha256: node.attempt.patch.sha256,
          baseCommit: base.commit, preimages: node.attempt.preimages });
      }
    }
    return candidateFrom(this.host.origin, join(this.taskRoot(), "candidates", randomUUID(), "repo"), patches, versions);
  }
  private baseFor(node: TaskNode): Candidate {
    if (node.reviewFor) return this.candidate(node.reviewFor.artifact);
    if (node.kind === "select") return this.rootCandidate();
    return node.dependsOn.length ? this.buildCandidate(node.dependsOn) : this.rootCandidate();
  }
  private ready(node: TaskNode): boolean {
    const state = this.state;
    if (!state || !["pending", "stale"].includes(node.status)) return false;
    if (node.kind === "select") return Object.entries(node.selectionSources ?? {}).every(([id, version]) => state.nodes[id]?.version === version && ["returned", "admitted"].includes(state.nodes[id].status));
    return node.dependsOn.every(id => state.nodes[id]?.status === "admitted" && state.nodes[id].admission && versionsCurrent(state, state.nodes[id].admission!.inputVersions));
  }
  private liveAttempts(orphansOnly = false): Attempt[] {
    if (!this.state) return [];
    const attempts = [...this.state.orphanedRuns, ...(orphansOnly ? [] : Object.values(this.state.nodes).filter(node => ACTIVE.has(node.status)).flatMap(node => node.attempt ? [node.attempt] : []))];
    return [...new Map(attempts.filter(attempt => !attempt.terminalAt).map(attempt => [attempt.id, attempt])).values()];
  }
  capacity(): unknown {
    const attempts = this.liveAttempts();
    return { configured: { owner: 1, ...this.host.cfg.concurrency },
      nativeRunsReserved: { gemini: attempts.filter(a => a.pool === "gemini").length, flash: attempts.filter(a => a.pool === "flash").length },
      ready: this.state ? Object.values(this.state.nodes).filter(node => this.ready(node)).map(node => node.id) : [],
      activeModelRequests: "not inferred from native child count; measured separately in validation",
      utilizationNote: "Configured capacity is not a claim that every slot continuously issues provider requests. Tail drain and blocked dependencies are reported, not padded with fake work." };
  }
  private async startNode(node: TaskNode, fence: Fence): Promise<void> {
    let state = this.assertFence(fence);
    const spec = this.spec(node), base = this.baseFor(node), attemptId = randomUUID();
    const runtimeDir = privateDir(join(this.taskRoot(), "contracts", attemptId)), inputsDir = privateDir(join(runtimeDir, "inputs"));
    const inputVersions = { ...base.nodeVersions, ...node.selectionSources };
    const premises = [...new Set([...node.dependsOn, ...Object.keys(node.selectionSources ?? {})])].map(id => {
      const dependency = state.nodes[id]; inputVersions[id] = dependency.version;
      return { id, version: dependency.version, admission: dependency.admission?.level ?? "unverified-claim", label: dependency.label,
        report: dependency.attempt?.report, patch: dependency.attempt?.patch, evidence: dependency.admission?.evidence ?? [] };
    });
    const inputRecords: unknown[] = [];
    for (const premise of premises) {
      for (const ref of [premise.report, premise.patch].filter((x): x is Artifact => Boolean(x))) {
        const destination = join(inputsDir, ref.id);
        if (!existsSync(destination)) writeFileSync(destination, this.host.store.bytes(ref), { flag: "wx", mode: 0o600 });
      }
      inputRecords.push(premise);
    }
    if (node.reviewFor) {
      for (const observation of Object.values(state.observations).filter(o => o.target === node.reviewFor!.id && o.treeHash === node.reviewFor!.treeHash)) {
        const receipt = JSON.parse(this.host.store.text(observation.record)); inputRecords.push({ observation, receipt });
        for (const id of [receipt.script?.id, receipt.candidate?.output?.id, receipt.baseline?.output?.id].filter(Boolean)) {
          const ref = this.ref(id), destination = join(inputsDir, ref.id);
          if (!existsSync(destination)) writeFileSync(destination, this.host.store.bytes(ref), { flag: "wx", mode: 0o600 });
        }
      }
    }
    atomicJson(join(inputsDir, "premises.json"), inputRecords);
    writeFileSync(join(inputsDir, "original-request.txt"), requirementText(state, this.host.store), { flag: "wx", mode: 0o600 });
    const contractPath = join(runtimeDir, "extension.ts"), attestationPath = join(runtimeDir, "guard.json");
    const contract: ChildContract = { version: 1, taskId: state.id, taskRevision: state.revision, generation: state.generation,
      nodeId: node.id, nodeVersion: node.version, attemptId, kind: node.kind, baseRoot: base.root, baseCommit: base.commit,
      scope: spec.scope, inputsDir, runtimeDir, attestationPath, repl: spec.repl ?? (node.pool === "gemini"), cfg: this.host.cfg };
    writeFileSync(contractPath, `import { setupChild } from ${JSON.stringify(join(ROOT, "extensions", "child.ts"))};\nexport default pi => setupChild(pi, ${JSON.stringify(contract)});\n`, { flag: "wx", mode: 0o600 });
    syncFile(contractPath);
    const agentName = `loop-${node.pool}-${attemptId}`, preset = this.host.cfg[node.pool];
    this.registrations.push(registerNativeAgent(this.pi, agentName, {
      description: `${node.kind}: ${node.label}`,
      systemPrompt: "Solve exactly the supplied bounded contract using actual files and tool observations. Report verifiable source locations, checks actually run, unresolved counterexamples and limitations. Do not rely on other agents' confidence. Do not claim final user-task completion. Never modify Git metadata or start other agents. Your output remains an unverified model claim until the owner admits it against recorded evidence.",
      model: `${preset.provider}/${preset.model}`, thinking: preset.thinking,
      tools: ["read", "bash", "grep", "find", "ls", ...(node.kind === "patch" ? ["write", "edit"] : []), ...(contract.repl && this.host.cfg.python.enabled ? ["execute"] : [])],
      extensions: [contractPath], inheritProjectContext: false, inheritGlobalContext: false, inheritSkills: false,
      defaultContext: "fresh", defaultTimeoutMs: this.host.cfg.budget.childSeconds * 1000,
      toolBudget: { hard: this.host.cfg.budget.childTools }, maxSubagentDepth: 1, completionGuard: false,
    }));
    const task = `ORIGINAL REQUEST: read ${join(inputsDir, "original-request.txt")}\n\nBOUNDED CONTRACT:\n${spec.task}\n\nINPUT MANIFEST: ${join(inputsDir, "premises.json")}\nBASE COMMIT: ${base.commit}\nINPUT TREE: ${base.tree.sha256}\nWRITE SCOPE: ${JSON.stringify(spec.scope)}\n\nAll upstream reports are labelled in the manifest; a hypothesis must remain conditional. Do not promote it to a verified fact. ${node.kind === "patch" ? "Implement in this isolated worktree without Git commits; the native harness captures the exact patch." : "Inspect without modifying candidate source; scratch computation is available."}`;
    // The pinned native API deliberately accepts named Git refs, not raw object
    // IDs. Bind a protected named ref to the exact already-verified base commit.
    const baseRef = `refs/pi-loop/bases/${base.commit}`;
    git(base.root, ["update-ref", baseRef, base.commit]);
    if (gitText(base.root, ["rev-parse", baseRef]) !== base.commit) throw new Error("NATIVE_BASE_REF_BINDING_FAILED");
    const params = { agent: agentName, task, cwd: base.root, context: "fresh", async: true,
      worktree: node.kind !== "review" && node.kind !== "select", baseRef,
      skill: false, artifacts: true, timeoutMs: this.host.cfg.budget.childSeconds * 1000, toolBudget: { hard: this.host.cfg.budget.childTools },
      sessionDir: privateDir(join(this.host.cfg.home, "child-sessions", state.id)) };
    const attempt: Attempt = { id: attemptId, taskId: state.id, nodeId: node.id, pool: node.pool, nodeVersion: node.version,
      generation: state.generation, revision: state.revision, startedAt: Date.now(), base: this.put(base, `base-${attemptId}`), inputVersions,
      launchIntent: this.put({ params, contractHash: jsonHash(contract) }, `launch-intent-${attemptId}`), contractPath, attestationPath };
    if (node.attempt) node.priorAttempts.push(this.put(node.attempt, `prior-attempt-${node.attempt.id}`));
    node.attempt = attempt; node.status = "starting"; delete node.admission; delete node.reason;
    state.childUsage[attemptId] = { pool: node.pool, usage: { ...emptyUsage(), known: false }, settled: false };
    this.checkpoint();
    try {
      const launched = await this.native.spawn(params);
      attempt.runId = launched.runId; attempt.asyncDir = realpathSync(launched.asyncDir);
      if (!within(join(this.host.cfg.home, "native-tmp"), attempt.asyncDir)) throw new Error("NATIVE_ARTIFACT_DIRECTORY_NOT_DURABLE: restart with this profile's TMPDIR before executing tasks");
      if (this.state?.id !== fence.task || this.state.revision !== fence.revision || this.state.generation !== fence.generation || this.stopped) {
        this.state?.orphanedRuns.push(attempt); await this.native.stop(launched.runId); node.status = "cancelled";
      } else {
        state = this.assertFence(fence); state.childUsage[attemptId].runId = launched.runId; node.status = "running";
      }
      this.checkpoint();
    } catch (error) {
      if (!attempt.runId && error instanceof NativeRpcError && error.code === "invalid_params") {
        // Public parameter validation precedes launch. A proved rejection is
        // different from an acknowledgement timeout with an unknown outcome.
        attempt.terminalAt = Date.now();
        attempt.error = childError(error);
        attempt.processTerminal = this.put({ state: "not-started", source: "native-public-parameter-validation", error: attempt.error }, `native-rejection-${attempt.id}`, "tool-observation");
        attempt.usage = emptyUsage();
        state.childUsage[attempt.id] = { pool: node.pool, usage: emptyUsage(), settled: true };
        node.status = "failed"; node.reason = attempt.error;
        this.checkpoint();
        return;
      }
      node.status = "unknown"; attempt.error = childError(error); node.reason = attempt.error;
      if (attempt.runId) await this.native.stop(attempt.runId).catch(failure => this.reportBackground(failure));
      this.checkpoint();
    }
  }
  async dispatch(ids: string[]): Promise<unknown> {
    const state = this.current();
    if (this.mutationBusy || this.operation) throw new Error("Wait for the current control operation");
    if (state.orphanedRuns.some(a => !a.terminalAt)) throw new Error("RECONCILIATION_REQUIRED: previous native runs still own capacity");
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error("Dispatch requires distinct ready node IDs");
    const nodes = ids.map(id => { const node = state.nodes[id]; if (!node || !this.ready(node)) throw new Error(`NODE_NOT_READY: ${id}`); return node; });
    const live = this.liveAttempts();
    for (const pool of ["gemini", "flash"] as const) {
      if (live.filter(a => a.pool === pool).length + nodes.filter(n => n.pool === pool).length > this.host.cfg.concurrency[pool]) throw new Error(`POOL_CAPACITY_EXCEEDED: ${pool}`);
    }
    const firstGeminiLaunch = !Object.values(state.childUsage).some(row => row.pool === "gemini"), geminiCount = nodes.filter(node => node.pool === "gemini").length;
    if (firstGeminiLaunch && geminiCount > 0 && geminiCount < 10) throw new Error("INITIAL_EXECUTION_BASELINE: first Gemini fan-out must contain at least 10 genuinely independent contracts; use direct owner inspection until these are defined");
    this.mutationBusy = true;
    const fence = this.fence();
    try {
      await Promise.all(nodes.map(node => this.startNode(node, fence)));
      return { nodes: nodes.map(node => this.nodeView(node)), capacity: this.capacity(), note: "Native execution is asynchronous; these are launch receipts, not completion or verification." };
    } finally { this.mutationBusy = false; this.emit(); }
  }

  private nativeJson(attempt: Attempt, name: string): any | undefined {
    if (!attempt.asyncDir || !attempt.runId || !/^[a-z0-9.-]+$/i.test(name)) return undefined;
    const directory = realpathSync(attempt.asyncDir), path = join(directory, name);
    if (!existsSync(path)) return undefined;
    const info = lstatSync(path);
    if (info.isSymbolicLink() || !info.isFile() || info.size > 64 * 1024 * 1024 || !within(directory, realpathSync(path))) throw new Error("UNTRUSTED_NATIVE_ARTIFACT");
    return readJson(path);
  }
  private nativeFile(attempt: Attempt, path: string): Buffer {
    const actual = realpathSync(path), permitted = [attempt.asyncDir, join(this.host.cfg.home, "child-sessions"), join(this.host.cfg.home, "sessions", "subagent-artifacts")].filter((x): x is string => Boolean(x));
    if (!permitted.some(root => within(root, actual)) || lstatSync(path).isSymbolicLink() || lstatSync(actual).size > 60 * 1024 * 1024) throw new Error(`FOREIGN_NATIVE_ARTIFACT: ${path}`);
    return readFileSync(actual);
  }
  private usageFrom(status: any, attempt: Attempt): void {
    const state = this.state; if (!state) return;
    let usage = emptyUsage();
    const steps = Array.isArray(status.steps) ? status.steps : [];
    if (!steps.length) usage.known = false;
    for (const step of steps) {
      if (Array.isArray(step.modelAttempts) && step.modelAttempts.length) {
        for (const modelAttempt of step.modelAttempts) usage = addUsage(usage, parseUsage(modelAttempt.usage));
      } else usage = addUsage(usage, parseUsage(step.usage));
    }
    attempt.usage = usage;
    state.childUsage[attempt.id] = { pool: attempt.pool, usage, settled: Boolean(attempt.terminalAt), ...(attempt.runId ? { runId: attempt.runId } : {}) };
  }
  private terminalProof(attempt: Attempt, status: any): any | undefined {
    const proof = this.nativeJson(attempt, "process-terminal.json") ?? status.lifecycle?.processTerminal;
    if (!proof || proof.version !== 1 || proof.runId !== attempt.runId || !["observed", "not-started"].includes(proof.state)) return undefined;
    if (proof.state === "observed" && (!Number.isFinite(proof.observedAt) || !Array.isArray(proof.instances)
      || proof.instances.some((item: any) => item.kind === "pi-writer" && item.processTree?.state !== "observed"))) return undefined;
    return proof;
  }
  private reconcileUnacknowledged(attempt: Attempt): void {
    if (attempt.runId || !this.state) return;
    const intent = JSON.parse(this.host.store.text(attempt.launchIntent));
    const root = join(this.host.cfg.home, "native-tmp", `pi-subagents-uid-${process.getuid?.() ?? "unknown"}`, "async-subagent-runs");
    if (!existsSync(root)) return;
    const matches: Array<{ path: string; runId: string }> = [];
    for (const name of readdirSync(root).slice(-2000)) {
      const path = join(root, name), statusPath = join(path, "status.json");
      try {
        if (!existsSync(statusPath) || lstatSync(path).isSymbolicLink() || lstatSync(statusPath).isSymbolicLink()) continue;
        const status = readJson<any>(statusPath);
        if (status.runId === name && Array.isArray(status.agents) && status.agents.includes(intent.params.agent)
          && Number(status.startedAt) >= attempt.startedAt - 2000) matches.push({ path: realpathSync(path), runId: name });
      } catch { /* A concurrently written unrelated status is not proof for this intent. */ }
    }
    if (matches.length === 1) { attempt.runId = matches[0].runId; attempt.asyncDir = matches[0].path; }
    else if (matches.length > 1) attempt.error = "AMBIGUOUS_NATIVE_INTENT: multiple native runs claim the same unique launch contract";
  }
  private async refreshAttempt(attempt: Attempt): Promise<void> {
    this.reconcileUnacknowledged(attempt);
    if (!attempt.runId || !attempt.asyncDir || attempt.terminalAt || !this.state) return;
    let nativeStatus: NativeReply | undefined;
    try { nativeStatus = await this.native.request("status", { id: attempt.runId }, 10000); }
    catch (error) { attempt.error = `Native status query failed: ${childError(error)}`; }
    const status = this.nativeJson(attempt, "status.json");
    if (!status || status.runId !== attempt.runId || typeof status.state !== "string") return;
    this.usageFrom(status, attempt);
    if (!TERMINAL.has(status.state)) return;
    const proof = this.terminalProof(attempt, status);
    if (!proof) return;
    attempt.terminalAt = Date.now();
    attempt.processTerminal = this.put(proof, `native-terminal-${attempt.id}`, "tool-observation");
    attempt.result = this.put({ status, nativeStatus }, `native-result-${attempt.id}`, "tool-observation");
    this.usageFrom(status, attempt);
    const state = this.state, node = state.nodes[attempt.nodeId];
    const live = !this.stopped && state.status === "running" && attempt.taskId === state.id && attempt.generation === state.generation
      && attempt.revision === state.revision && node?.attempt?.id === attempt.id && node.version === attempt.nodeVersion && versionsCurrent(state, attempt.inputVersions);
    if (!live) { if (node?.attempt?.id === attempt.id && ACTIVE.has(node.status)) node.status = "cancelled"; return; }
    if (status.state !== "complete" && status.state !== "completed") {
      node.status = "failed"; node.reason = typeof status.error === "string" ? status.error.slice(0, 3000) : `Native child ended ${status.state}`; return;
    }
    try {
      const guard = readJson<any>(attempt.attestationPath);
      if (guard.attemptId !== attempt.id || guard.nodeVersion !== attempt.nodeVersion || guard.taskRevision !== attempt.revision || guard.generation !== attempt.generation) throw new Error("MISSING_OR_FOREIGN_CHILD_GUARD");
      this.put(guard, `guard-${attempt.id}`, "tool-observation");
      const base = this.candidate(attempt.base);
      let reportPath: string | undefined;
      if (node.kind === "patch" || node.kind === "inspect") {
        const handoff = this.nativeJson(attempt, "handoff.json");
        if (!handoff || handoff.version !== 1 || handoff.runId !== attempt.runId || !Array.isArray(handoff.groups) || handoff.groups.length !== 1) throw new Error("MISSING_OR_AMBIGUOUS_NATIVE_HANDOFF");
        const group = handoff.groups[0];
        if (group.baseCommit !== base.commit || realpathSync(group.repoRoot) !== realpathSync(base.root) || !Array.isArray(group.children) || group.children.length !== 1) throw new Error("FOREIGN_HANDOFF_INPUT_BINDING");
        const child = group.children[0];
        if (child.patch?.error || typeof child.patch?.path !== "string") throw new Error(`NATIVE_PATCH_CAPTURE_FAILED: ${child.patch?.error ?? "missing patch"}`);
        const bytes = this.nativeFile(attempt, child.patch.path), patch = this.put(bytes, `patch-${attempt.id}`, "tool-observation", "text/x-patch");
        const changedPaths = bytes.length ? patchPaths(base.root, this.host.store.path(patch)) : [];
        if (node.kind === "inspect" && changedPaths.length) throw new Error("READ_ONLY_NODE_CHANGED_INPUTS");
        if (changedPaths.some(path => !inScope(path, this.spec(node).scope))) throw new Error("PATCH_SCOPE_VIOLATION: preserve and reconsider the contract; scope is not silently widened");
        attempt.patch = patch; attempt.changedPaths = changedPaths;
        const files = new Map(base.tree.files.map(file => [file.path, jsonHash(file)]));
        attempt.preimages = Object.fromEntries(changedPaths.map(path => [path, files.get(path) ?? null]));
        this.put(handoff, `native-handoff-${attempt.id}`, "tool-observation"); reportPath = child.outputPath;
      }
      const localOutput = join(attempt.asyncDir!, "output-0.log");
      const outputPath = existsSync(localOutput) ? localOutput : reportPath;
      if (!outputPath) throw new Error("NATIVE_REPORT_MISSING");
      attempt.report = this.put(this.nativeFile(attempt, outputPath), `claim-${attempt.id}`, "model-claim", "text/plain");
      node.status = "returned";
      node.reason = "Native run settled. Output remains a model claim until explicitly admitted against current evidence.";
      if (node.reviewFor) {
        const review = this.parseReview(node);
        if (review?.verdict === "concern") state.unresolved.push({ id: `review-${attempt.id}`, description: review.findings.join("; ").slice(0, 4000), evidence: [attempt.report.id] });
      }
    } catch (error) { node.status = "rejected"; node.reason = childError(error); }
  }
  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (!this.state || this.disposed || this.journal.failed) return;
    this.refreshing = (async () => {
      const before = JSON.stringify(this.state);
      await Promise.all(this.liveAttempts().map(attempt => this.refreshAttempt(attempt).catch(error => { attempt.error = childError(error); })));
      if (this.state) {
        this.state.orphanedRuns = this.state.orphanedRuns.filter(attempt => !attempt.terminalAt);
        if (JSON.stringify(this.state) !== before) this.checkpoint();
      }
    })();
    try { await this.refreshing; } finally { this.refreshing = undefined; }
  }
  private nodeView(node: TaskNode): Record<string, unknown> {
    return { id: node.id, version: node.version, pool: node.pool, kind: node.kind, label: node.label, dependsOn: node.dependsOn,
      status: node.status, ready: this.ready(node), admission: node.admission?.level, report: node.attempt?.report?.id, patch: node.attempt?.patch?.id,
      runId: node.attempt?.runId, processSettled: Boolean(node.attempt?.terminalAt), reason: node.reason };
  }
  projection(): unknown {
    const s = this.state;
    if (!s) return { status: "no_task", originalSource: this.host.origin.source, workspace: this.host.origin.repo, capacity: this.capacity() };
    const nodes = Object.values(s.nodes);
    const visible = [...nodes.filter(n => ["running", "starting", "unknown", "returned", "rejected", "failed"].includes(n.status)), ...nodes.filter(n => ["pending", "stale"].includes(n.status))].slice(0, 80);
    return { taskId: s.id, revision: s.revision, generation: s.generation, status: s.status, reason: s.reason, original: s.original, amendments: s.amendments,
      originalSource: this.host.origin.source, workspace: this.host.origin.repo, obligations: s.obligations,
      nodes: visible.map(n => this.nodeView(n)), totalNodes: nodes.length, omittedNodes: nodes.length - visible.length,
      stage: s.stage, evidence: Object.values(s.observations).slice(-20), unresolved: s.unresolved, capacity: this.capacity(), usage: taskUsage(s),
      pricing: Object.keys(this.host.cfg.pricing).length ? "USER_CONFIGURED_RATES" : "UNKNOWN_NOT_FREE", artifacts: Object.keys(s.artifacts).length,
      nativeSession: this.host.manager.getSessionFile(), delivery: s.delivery, durability: this.journal.failed ? "failed" : "native-fsynced", backgroundDiagnostic: this.backgroundError };
  }
  async inspectNodes(offset = 0, limit = 30): Promise<unknown> {
    await this.refresh();
    const nodes = Object.values(this.state?.nodes ?? {});
    return { total: nodes.length, nodes: nodes.slice(offset, offset + limit).map(node => ({ ...this.nodeView(node), spec: this.spec(node) })), nextOffset: offset + limit < nodes.length ? offset + limit : null };
  }
  private parseReview(node: TaskNode): { verdict: "pass" | "concern" | "unknown"; findings: string[]; evidence: string[]; candidateHash: string } | undefined {
    if (!node.attempt?.report || !node.reviewFor) return undefined;
    const text = this.host.store.text(node.attempt.report), matches = [...text.matchAll(/```loop-review\s*([\s\S]*?)```/g)];
    if (matches.length !== 1) return undefined;
    try {
      const value = JSON.parse(matches[0][1]);
      if (!["pass", "concern", "unknown"].includes(value.verdict) || value.candidateHash !== node.reviewFor.treeHash || !Array.isArray(value.findings) || !Array.isArray(value.evidence)
        || !value.evidence.length || [...value.findings, ...value.evidence].some(item => typeof item !== "string")) return undefined;
      return value;
    } catch { return undefined; }
  }

  private target(name: string): { key: string; candidate: Candidate; baseline: Candidate } {
    const state = this.current();
    if (name === "origin") return { key: "origin", candidate: this.rootCandidate(), baseline: this.rootCandidate() };
    if (name === "stage" || name === state.stage?.id) {
      const stage = state.stage;
      if (!stage || !versionsCurrent(state, stage.nodeVersions)) throw new Error("NO_CURRENT_STAGE");
      return { key: stage.id, candidate: this.candidate(stage.artifact), baseline: this.rootCandidate() };
    }
    const node = state.nodes[name];
    if (!node?.attempt || !["returned", "admitted"].includes(node.status)) throw new Error("Observe a returned node, the current stage, or origin");
    const candidate = this.buildCandidate([name], true);
    return { key: name, candidate, baseline: this.candidate(node.attempt.base) };
  }

  async readObservation(input: { target: string; path: string; offset?: number; length?: number; query?: string }): Promise<unknown> {
    const state = this.current(), fence = this.fence();
    const { key, candidate } = this.target(input.target);
    const scope: ToolScope = { root: candidate.root, scratch: join(this.taskRoot(), "owner-scratch"), writable: false, writeScopes: [], readRoots: [] };
    const path = checkPath(scope, relativePath(input.path));
    const info = lstatSync(path);
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error("OBSERVATION_FILE_BOUND: select a regular file up to 32 MiB or use a bounded programmatic command");
    const bytes = readFileSync(path);
    assertCandidate(candidate); this.assertFence(fence);
    const source = this.put(bytes, `read-${input.path}`, "tool-observation", "text/plain");
    const window = this.host.store.read(source, input.offset ?? 0, input.length ?? 12000, input.query);
    const id = randomUUID();
    const record = this.put({ id, checked: "exact file bytes at the recorded candidate revision", relativePath: input.path,
      source, candidateId: candidate.id, candidateHash: candidate.tree.sha256, candidateCommit: candidate.commit,
      nodeVersions: candidate.nodeVersions, taskRevision: state.revision, taskGeneration: state.generation,
      observedAt: Date.now(), window }, `read-observation-${id}`, "tool-observation");
    const observation: Observation = { id, kind: "read", target: key, nodeVersions: candidate.nodeVersions, treeHash: candidate.tree.sha256,
      record, passed: true, purpose: "inspection", taskRevision: state.revision, taskGeneration: state.generation };
    state.observations[id] = observation;
    this.checkpoint();
    return { observation, window, qualification: "A direct source observation does not validate an arbitrary interpretation of that source." };
  }

  async check(target: string, spec: CheckSpec, signal?: AbortSignal): Promise<unknown> {
    const state = this.current();
    if (this.mutationBusy || this.operation) throw new Error("An input-bound control operation is already active");
    const fence = this.fence(), own = new AbortController(); this.operation = own;
    const linked = signal ? AbortSignal.any([signal, own.signal]) : own.signal;
    try {
      const selected = this.target(target);
      const verified = await verifyCandidate({ cfg: this.host.cfg, store: this.host.store, target: selected.key,
        candidate: selected.candidate, baseline: selected.baseline, revision: state.revision, generation: state.generation,
        spec, root: join(this.taskRoot(), "verification"), signal: linked });
      // Preserve the completed observation even if a user revision made it stale.
      for (const ref of verified.artifacts) remember(state, ref);
      const observation: Observation = { id: verified.receipt.id, kind: "command", target: selected.key,
        nodeVersions: selected.candidate.nodeVersions, treeHash: selected.candidate.tree.sha256,
        record: verified.artifact, passed: verified.receipt.passed, purpose: "acceptance",
        taskRevision: fence.revision, taskGeneration: fence.generation };
      state.observations[observation.id] = observation;
      this.checkpoint();
      this.assertFence(fence);
      return { observation, result: verified.receipt, output: this.host.store.read(verified.receipt.candidate.output, 0, 12000) };
    } finally { if (this.operation === own) this.operation = undefined; this.emit(); }
  }

  private observed(id: string, target?: { key: string; candidate: Candidate }): Observation {
    const state = this.current(), observation = state.observations[id];
    if (!observation || observation.taskRevision !== state.revision || observation.taskGeneration !== state.generation
      || !versionsCurrent(state, observation.nodeVersions)) throw new Error(`STALE_OR_UNKNOWN_OBSERVATION: ${id}`);
    this.host.store.path(observation.record);
    if (target && (observation.target !== target.key || observation.treeHash !== target.candidate.tree.sha256
      || jsonHash(observation.nodeVersions) !== jsonHash(target.candidate.nodeVersions))) throw new Error(`OBSERVATION_INPUT_MISMATCH: ${id}`);
    if (observation.kind === "command") {
      const receipt = JSON.parse(this.host.store.text(observation.record)) as VerificationReceipt;
      if (receipt.environment.sha256 !== jsonHash(environmentIdentity(this.host.cfg))) throw new Error(`VERIFICATION_ENVIRONMENT_CHANGED: ${id}`);
      for (const ref of [receipt.script, receipt.spec, receipt.environment.record, receipt.candidate.output, receipt.baseline?.output,
        receipt.candidate.preflight?.output, receipt.baseline?.preflight?.output].filter((x): x is Artifact => Boolean(x))) this.host.store.path(ref);
      if (receipt.passed !== observation.passed || receipt.taskRevision !== observation.taskRevision || receipt.taskGeneration !== observation.taskGeneration
        || receipt.candidateHash !== observation.treeHash) throw new Error("OBSERVATION_RECEIPT_MISMATCH");
    }
    return observation;
  }

  admit(id: string, level: "supported" | "hypothesis", evidence: string[], rationale: string): unknown {
    const state = this.current(), node = state.nodes[id];
    if (!node?.attempt || !["returned", "admitted"].includes(node.status) || !node.attempt.terminalAt) throw new Error("Only a settled returned node can be admitted");
    if (!["supported", "hypothesis"].includes(level) || rationale.trim().length < 40 || rationale.length > 16000) throw new Error("Supply a substantive owner adjudication, not a confidence score");
    if (!versionsCurrent(state, node.attempt.inputVersions)) throw new Error("Node inputs changed; revise and rerun only affected work");
    const selected = this.target(id);
    const observations = evidence.map(ref => this.observed(ref, selected));
    if (level === "supported" && !observations.some(o => o.passed)) throw new Error("SUPPORTED_REQUIRES_CURRENT_OBSERVATION: a worker report is not an observation");
    if (node.kind === "patch" && level === "supported" && !observations.some(o => o.kind === "command" && o.purpose === "acceptance" && o.passed)) throw new Error("PATCH_ADMISSION_REQUIRES_INDEPENDENT_EXECUTION_CHECK");
    const reason = this.put({ nodeId: id, version: node.version, level, rationale, evidence, actualTree: selected.candidate.tree.sha256,
      authority: "OWNER_INTERPRETATION_OF_OBSERVATIONS_NOT_PROOF" }, `admission-${id}`);
    node.admission = { level, rationale: reason, evidence, inputVersions: { ...node.attempt.inputVersions }, at: Date.now() };
    node.status = "admitted";
    node.reason = level === "hypothesis" ? "Explicit provisional premise; descendants must retain uncertainty and this cannot certify final completion." : "Owner admitted the bounded result against current observations; semantic interpretation remains fallible.";
    this.checkpoint();
    return { node: this.nodeView(node), newlyReady: Object.values(state.nodes).filter(item => this.ready(item)).map(item => item.id) };
  }

  async reject(id: string, reason: string): Promise<unknown> {
    const state = this.current(), node = state.nodes[id];
    if (!node || !reason.trim()) throw new Error("A known node and rejection reason are required");
    const invalidated = invalidateDescendants(state, [id]);
    node.status = "rejected"; node.reason = reason.slice(0, 6000);
    this.put({ nodeId: id, reason, invalidated, at: Date.now() }, `rejection-${id}`);
    this.checkpoint();
    await this.stopOwned(true);
    return { rejected: id, invalidated, unaffected: Object.keys(state.nodes).filter(key => !invalidated.includes(key)) };
  }

  stage(ids: string[]): unknown {
    const state = this.current();
    if (this.hasOperation()) throw new Error("Wait for the current control mutation or check");
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate candidate-node IDs");
    const candidate = this.buildCandidate(ids);
    const artifact = this.put(candidate, `candidate-${candidate.id}`);
    state.stage = { id: candidate.id, artifact, treeHash: candidate.tree.sha256, nodeVersions: { ...candidate.nodeVersions } };
    state.reason = "Candidate assembled; current independent stage checks and source-bound obligation coverage are still required.";
    this.checkpoint();
    return { stage: state.stage, root: candidate.root, byteIdentity: candidate.tree.sha256,
      note: "Empty patch sets are valid for diagnostic/no-op tasks. Integration is not assumed correct merely because patches do not conflict." };
  }

  async select(ids: string[], question: string): Promise<unknown> {
    const state = this.current();
    if (ids.length < 2 || ids.length > 20 || new Set(ids).size !== ids.length) throw new Error("Select requires 2-20 distinct returned alternatives");
    const sources: Record<string, number> = {};
    for (const id of ids) {
      const node = state.nodes[id];
      if (!node || !["returned", "admitted"].includes(node.status) || !node.attempt?.report) throw new Error(`Alternative not returned: ${id}`);
      sources[id] = node.version;
    }
    const id = `selector-${randomUUID()}`;
    await this.define([{ id, pool: "flash", kind: "select", task: `Compare the explicitly unverified alternative reports and patches supplied in the input manifest. ${question}\nDo not average conflicting implementations or treat majority agreement as proof. Recommend an ID, a new synthesis contract, or ABSTAIN. State the specific missing discriminating observation and failure risks. Your result is advisory; only the GLM-5.3 owner selects and independently verifies the integration.`,
      dependsOn: [], scope: [], obligations: state.obligations.map(o => o.id), repl: false }]);
    state.nodes[id].selectionSources = sources;
    this.checkpoint();
    return { selector: id, sources, launched: await this.dispatch([id]), authority: "ADVISORY_SELECTION_NOT_ACCEPTANCE" };
  }

  async review(criteria: string[]): Promise<unknown> {
    const state = this.current(), stage = state.stage;
    if (!stage || !versionsCurrent(state, stage.nodeVersions)) throw new Error("Stage a current candidate before independent review");
    this.candidate(stage.artifact);
    if (!criteria.length || criteria.length > this.host.cfg.concurrency.flash || criteria.some(c => !c.trim() || c.length > 3000)) throw new Error("Use 1 to the configured Flash capacity of concrete review criteria");
    const specs: NodeSpec[] = criteria.map((criterion, index) => ({
      id: `review-${randomUUID()}`, pool: "flash", kind: "review", dependsOn: [], scope: [], obligations: state.obligations.map(o => o.id), repl: false,
      task: `Independently inspect the actual read-only candidate against the ORIGINAL REQUEST. Your criterion: ${criterion}\nCandidate hash: ${stage.treeHash}\nOriginal obligations: ${JSON.stringify(state.obligations)}\nThe input manifest supplies host-executed check receipts and exact scripts/logs, not the executor's confidence narrative. Look for omissions, vacuous checks, counterexamples, unintended side effects and incorrect API assumptions. Passing checks support only the behavior they cover. End your technical report with exactly one fenced block tagged loop-review containing JSON with keys verdict (pass|concern|unknown), candidateHash (the hash above), findings (string array), evidence (nonempty array of concrete source locations/check references). This is a fallible semantic review, not proof. Do not repair the candidate. Criterion index ${index + 1}.`,
    }));
    await this.define(specs);
    for (const spec of specs) {
      state.nodes[spec.id].reviewFor = structuredClone(stage);
      state.reviews.push({ nodeId: spec.id, version: state.nodes[spec.id].version, stageId: stage.id, treeHash: stage.treeHash });
    }
    this.checkpoint();
    return { stage, reviews: specs.map(s => s.id), launched: await this.dispatch(specs.map(s => s.id)) };
  }

  counterexample(description: string, evidence: string[]): unknown {
    const state = this.current();
    if (!description.trim() || description.length > 6000 || state.unresolved.length >= 128) throw new Error("Counterexample description/retention bound exceeded");
    evidence.forEach(id => this.ref(id));
    const item = { id: `counterexample-${randomUUID()}`, description, evidence };
    state.unresolved.push(item); this.checkpoint();
    return item;
  }
  resolveCounterexample(id: string, checks: string[], explanation: string): unknown {
    const state = this.current(), item = state.unresolved.find(value => value.id === id);
    if (!item || explanation.trim().length < 60 || !checks.length) throw new Error("Resolve an existing counterexample with current discriminating checks and a substantive explanation");
    const target = this.target("stage");
    for (const check of checks) {
      const observation = this.observed(check, target);
      if (observation.kind !== "command" || !observation.passed) throw new Error("A model opinion or failed check cannot resolve a counterexample");
    }
    const receipt = this.put({ counterexample: item, checks, explanation, stage: state.stage, at: Date.now(),
      authority: "OWNER_REBUTTAL_WITH_EXECUTABLE_EVIDENCE_NOT_PROOF" }, `counterexample-resolution-${id}`);
    state.unresolved = state.unresolved.filter(value => value.id !== id);
    this.checkpoint(); return { resolved: id, receipt };
  }

  finish(coverage: Array<{ obligationId: string; evidence: string[]; explanation: string }>, conclusion: string): unknown {
    const state = this.current();
    if (this.hasOperation() || this.liveAttempts().length) throw new Error("UNSETTLED_WORK: all owned work must settle or be explicitly cancelled before final acceptance");
    if (state.unresolved.length) throw new Error("UNRESOLVED_COUNTEREXAMPLES: repair or resolve them with current discriminating evidence");
    if (!state.obligations.length || conclusion.trim().length < 80) throw new Error("Final acceptance requires explicit original obligations and a substantive synthesis");
    const target = this.target("stage"), stage = state.stage!;
    if (Object.keys(stage.nodeVersions).some(id => state.nodes[id].admission?.level !== "supported")) throw new Error("PROVISIONAL_DEPENDENCY: the delivered artifact still depends on an unresolved hypothesis");
    if (coverage.length !== state.obligations.length || new Set(coverage.map(row => row.obligationId)).size !== coverage.length) throw new Error("Every original obligation must occur exactly once in the final coverage map");
    let executableCoverage = false;
    for (const row of coverage) {
      if (!state.obligations.some(item => item.id === row.obligationId) || !row.evidence.length || row.explanation.trim().length < 40) throw new Error("Missing original obligation or insufficient evidence mapping");
      for (const id of row.evidence) {
        const observation = this.observed(id, target);
        if (!observation.passed) throw new Error("A failed observation cannot support final acceptance");
        executableCoverage ||= observation.kind === "command" && observation.purpose === "acceptance";
      }
    }
    if (!executableCoverage) throw new Error("Final candidate needs at least one actual independent executable check, not only model prose");
    const reviews = state.reviews.filter(review => review.stageId === stage.id && review.treeHash === stage.treeHash);
    if (!reviews.length) throw new Error("Current independent Flash review has not been requested");
    let passes = 0;
    const reviewEvidence: unknown[] = [];
    for (const ref of reviews) {
      const node = state.nodes[ref.nodeId];
      const review = node && this.parseReview(node);
      if (!node || node.version !== ref.version || !node.attempt?.terminalAt || !["returned", "admitted"].includes(node.status)
        || node.attempt.generation !== state.generation || node.attempt.revision !== state.revision || !review) throw new Error(`MISSING_OR_INVALID_CURRENT_REVIEW: ${ref.nodeId}`);
      if (review.verdict === "unknown") throw new Error(`REVIEW_UNCERTAINTY_UNRESOLVED: ${ref.nodeId}`);
      if (review.verdict === "pass") passes++;
      // A concern is allowed only after its automatically retained counterexample
      // has been explicitly resolved through a recorded executable rebuttal.
      if (review.verdict === "concern") {
        const counterexampleId = `review-${node.attempt.id}`;
        const resolution = Object.values(state.artifacts).find(a => a.label === `counterexample-resolution-${counterexampleId}`);
        if (!resolution) throw new Error(`REVIEW_CONCERN_NOT_ADJUDICATED: ${ref.nodeId}`);
        const record = JSON.parse(this.host.store.text(resolution));
        if (record.stage?.id !== stage.id || record.stage?.treeHash !== stage.treeHash) throw new Error("STALE_REVIEW_ADJUDICATION");
        for (const id of record.checks ?? []) this.observed(id, target);
      }
      reviewEvidence.push({ nodeId: node.id, report: node.attempt.report, review });
    }
    if (!passes) throw new Error("No independent current review supports delivery; obtain additional evidence rather than silently waiving all reviews");
    assertCandidate(target.candidate);
    const patch = candidatePatch(this.host.origin, target.candidate);
    const delivery = this.put(patch, `delivery-${state.id}`, "host-record", "text/x-patch");
    const receipt = this.put({ taskId: state.id, taskRevision: state.revision, generation: state.generation,
      original: state.original, amendments: state.amendments, stage, coverage, reviews: reviewEvidence, conclusion,
      environment: environmentIdentity(this.host.cfg), delivery, at: Date.now(),
      authority: "GLM_OWNER_ACCEPTANCE_CONSTRAINED_BY_CURRENT_OBSERVATIONS_NOT_GLOBAL_OPTIMALITY_OR_FORMAL_PROOF" }, `final-acceptance-${state.id}`);
    state.finalReceipt = receipt; state.delivery = delivery; state.status = "complete";
    state.reason = "Accepted on the current artifact and recorded checks/reviews. The original workspace was not automatically modified.";
    this.stopped = true; this.host.clearContinuation(); this.host.resetPython();
    if (this.deadline) clearTimeout(this.deadline);
    this.checkpoint();
    return { status: "complete", delivery, patchPath: this.host.store.path(delivery), receipt, candidateDirectory: target.candidate.root,
      sourceDirectory: this.host.origin.source, sourceModified: false, qualification: "Acceptance is supported by these specific observations, not a proof of all possible program behaviors." };
  }

  evidence(id: string, offset = 0, length = 16000, query?: string): unknown {
    return this.host.store.read(this.ref(id), offset, length, query);
  }
  history(input: { id?: string; offset?: number; length?: number; query?: string; before?: string; limit?: number }): unknown {
    const entries = this.host.manager.getEntries();
    if (input.id) {
      const entry = entries.find(entry => entry.id === input.id);
      if (!entry) throw new Error("Unknown native entry ID");
      const text = redact(JSON.stringify(entry)), offset = input.offset ?? 0, length = Math.min(48000, input.length ?? 16000);
      if (!Number.isSafeInteger(offset) || offset < 0 || length < 1) throw new Error("Invalid native-entry cursor");
      const hit = input.query ? text.toLowerCase().indexOf(input.query.toLowerCase(), offset) : offset;
      if (hit < 0) return { id: entry.id, found: false, totalCharacters: text.length };
      const start = input.query ? Math.max(offset, hit - 300) : offset, end = Math.min(text.length, start + length);
      return { id: entry.id, source: "PI_NATIVE_SESSION", type: entry.type, offset: start, text: text.slice(start, end), totalCharacters: text.length, nextOffset: end < text.length ? end : null };
    }
    const end = input.before ? entries.findIndex(entry => entry.id === input.before) : entries.length;
    if (end < 0) throw new Error("Unknown native history cursor");
    const limit = Math.min(30, Math.max(1, input.limit ?? 12));
    const selected = entries.slice(0, end).map(entry => ({ entry, text: redact(JSON.stringify(entry)) }))
      .filter(row => !input.query || row.text.toLowerCase().includes(input.query.toLowerCase())).slice(-limit);
    return { source: "PI_NATIVE_SESSION", sessionFile: this.host.manager.getSessionFile(), entries: selected.map(({ entry, text }) => {
      const hit = input.query ? text.toLowerCase().indexOf(input.query.toLowerCase()) : 0, offset = Math.max(0, hit - 250);
      return { id: entry.id, type: entry.type, timestamp: entry.timestamp, excerptOffset: offset, excerpt: text.slice(offset, offset + 1500), totalCharacters: text.length };
    }), nextBefore: selected[0]?.entry.id ?? null, detailMethod: "Use the same entry ID plus offset for lossless-in-range continuation, including toolResult and long JSON lines." };
  }

  async wait(ids: string[] = [], milliseconds = 10000): Promise<unknown> {
    const state = this.current(), fence = this.fence();
    for (const id of ids) if (!state.nodes[id]) throw new Error(`Unknown node: ${id}`);
    const end = Date.now() + Math.min(30000, Math.max(100, milliseconds));
    do {
      await this.refresh(); this.assertFence(fence);
      const nodes = ids.length ? ids.map(id => state.nodes[id]) : Object.values(state.nodes);
      if (nodes.some(node => node.status === "returned" || node.status === "failed" || node.status === "rejected") || !nodes.some(node => ACTIVE.has(node.status))) break;
      await new Promise(resolve => setTimeout(resolve, 400));
    } while (Date.now() < end);
    return this.projection();
  }

  block(reason: string): unknown {
    if (reason.trim().length < 10) throw new Error("Report the concrete missing information, infrastructure failure or unresolved contradiction");
    this.latch("blocked", reason.slice(0, 6000));
    void this.stopOwned().catch(error => this.reportBackground(error));
    return { status: "blocked", reason };
  }

  private latch(status: Exclude<TaskStatus, "running" | "complete">, reason: string): void {
    this.stopped = true;
    const state = this.state;
    if (state && state.status !== "complete") { state.status = status; state.generation++; state.reason = reason; }
    if (this.deadline) clearTimeout(this.deadline);
    this.host.clearContinuation(); this.operation?.abort(); this.host.resetPython();
    if (state && !this.journal.failed) { try { this.checkpoint(); } catch (error) { this.reportBackground(error); } }
    this.emit();
  }
  async stopOwned(orphansOnly = false): Promise<void> {
    const attempts = this.liveAttempts(orphansOnly);
    attempts.forEach(attempt => this.reconcileUnacknowledged(attempt));
    await Promise.all(attempts.filter(attempt => attempt.runId).map(attempt => this.native.stop(attempt.runId!).catch(error => { attempt.error = childError(error); })));
    const deadline = Date.now() + 35000;
    while (this.liveAttempts(orphansOnly).some(a => a.runId) && Date.now() < deadline && !this.journal.failed) {
      await this.refresh();
      if (!this.liveAttempts(orphansOnly).some(a => a.runId)) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (this.liveAttempts(orphansOnly).length) throw new Error("NATIVE_SETTLEMENT_UNKNOWN: capacity is retained; no new dispatch or silent replay is allowed");
  }
  async stop(status: "paused" | "cancelled" | "blocked" = "paused", reason = "Stopped by user"): Promise<void> {
    this.latch(status, reason);
    const outcomes = await Promise.allSettled([this.stopOwned(), this.host.abortRoot()]);
    this.host.clearContinuation();
    const rejected = outcomes.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected) { this.reportBackground(rejected.reason); throw rejected.reason; }
  }
  async resume(): Promise<void> {
    if (!this.state || this.state.status === "complete" || this.journal.failed) throw new Error("No resumable task");
    if (this.hasOperation()) throw new Error("Wait for the current operation to settle");
    await this.stopOwned();
    if (this.state.status === "budget_exhausted") throw new Error("The existing task budget is exhausted; a new explicitly budgeted task is required");
    this.state.generation++; this.state.status = "running"; this.state.reason = "Explicitly resumed; old stopped attempts are not replayed.";
    this.stopped = false; this.continuationCount = 0;
    this.checkpoint(); this.armDeadline();
  }
  ownerUsage(raw: unknown): void {
    if (!this.state || this.journal.failed) return;
    this.state.ownerUsage = addUsage(this.state.ownerUsage, parseUsage(raw)); this.checkpoint();
  }
  shouldContinue(): boolean {
    if (!this.state || this.stopped || this.disposed || this.journal.failed || this.state.status !== "running" || this.hasOperation() || this.liveAttempts().length) return false;
    try { this.current(); } catch { return false; }
    const key = progressKey(this.state);
    this.continuationCount = key === this.lastProgress ? this.continuationCount + 1 : 0; this.lastProgress = key;
    if (this.continuationCount >= 4) { this.latch("blocked", "Four settled owner turns added no new input, observation, node progress or accepted candidate. A changed operator or new information is required."); return false; }
    return true;
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.latch("paused", "Session closing; artifacts remain recoverable and native jobs must settle.");
    try { await this.stopOwned(); }
    finally {
      this.disposed = true;
      if (this.poller) clearInterval(this.poller); if (this.deadline) clearTimeout(this.deadline);
      this.listeners.splice(0).forEach(off => off()); this.registrations.splice(0).forEach(registration => registration.dispose());
    }
  }
}
