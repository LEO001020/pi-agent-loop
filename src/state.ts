import { randomUUID } from "node:crypto";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Artifact, Artifacts } from "./artifacts.ts";
import type { Pool } from "./config.ts";
import { jsonHash, safeId, syncFile } from "./io.ts";

export const TASK_ENTRY = "pi-agent-loop.task.v1";
export const ORIGIN_ENTRY = "pi-agent-loop.origin.v1";
export type TaskStatus = "running" | "paused" | "blocked" | "budget_exhausted" | "cancelled" | "complete";
export type NodeStatus = "pending" | "starting" | "running" | "returned" | "admitted" | "rejected" | "failed" | "cancelled" | "stale" | "unknown";
export type NodeKind = "inspect" | "patch" | "select" | "review";
export interface Obligation { id: string; description: string; source: string; quote: string }
export interface NodeSpec {
  id: string;
  pool: Pool;
  kind: NodeKind;
  task: string;
  dependsOn: string[];
  scope: string[];
  obligations: string[];
  alternativeGroup?: string;
  repl?: boolean;
}
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number; known: boolean }
export interface Attempt {
  id: string;
  taskId: string;
  nodeId: string;
  pool: Pool;
  nodeVersion: number;
  generation: number;
  revision: number;
  startedAt: number;
  base: Artifact;
  inputVersions: Record<string, number>;
  launchIntent: Artifact;
  contractPath: string;
  attestationPath: string;
  runId?: string;
  asyncDir?: string;
  terminalAt?: number;
  processTerminal?: Artifact;
  result?: Artifact;
  report?: Artifact;
  patch?: Artifact;
  changedPaths?: string[];
  preimages?: Record<string, string | null>;
  usage?: Usage;
  error?: string;
}
export interface Admission {
  level: "supported" | "hypothesis";
  rationale: Artifact;
  evidence: string[];
  inputVersions: Record<string, number>;
  at: number;
}
export interface TaskNode {
  id: string;
  version: number;
  pool: Pool;
  kind: NodeKind;
  label: string;
  spec: Artifact;
  dependsOn: string[];
  status: NodeStatus;
  attempt?: Attempt;
  priorAttempts: Artifact[];
  admission?: Admission;
  reason?: string;
  reviewFor?: StageRef;
  selectionSources?: Record<string, number>;
}
export interface Observation {
  id: string;
  kind: "read" | "command";
  target: string;
  nodeVersions: Record<string, number>;
  treeHash: string;
  record: Artifact;
  passed: boolean;
  purpose: "inspection" | "acceptance";
  taskRevision: number;
  taskGeneration: number;
}
export interface StageRef {
  id: string;
  artifact: Artifact;
  treeHash: string;
  nodeVersions: Record<string, number>;
}
export interface TaskState {
  schemaVersion: 1;
  id: string;
  revision: number;
  generation: number;
  status: TaskStatus;
  original: Artifact;
  amendments: Artifact[];
  origin: Artifact;
  startedAt: number;
  updatedAt: number;
  obligations: Obligation[];
  nodes: Record<string, TaskNode>;
  observations: Record<string, Observation>;
  artifacts: Record<string, Artifact>;
  stage?: StageRef;
  reviews: Array<{ nodeId: string; version: number; stageId: string; treeHash: string }>;
  unresolved: Array<{ id: string; description: string; evidence: string[] }>;
  ownerUsage: Usage;
  childUsage: Record<string, { pool: Pool; usage: Usage; settled: boolean; runId?: string }>;
  orphanedRuns: Attempt[];
  finalReceipt?: Artifact;
  delivery?: Artifact;
  reason?: string;
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, known: true });
export function parseUsage(value: unknown): Usage {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  let known = true;
  const number = (name: string): number => {
    if (typeof input[name] !== "number" || !Number.isFinite(input[name]) || Number(input[name]) < 0) { known = false; return 0; }
    return input[name] as number;
  };
  const usage = { input: number("input"), output: number("output"), cacheRead: number("cacheRead"), cacheWrite: number("cacheWrite"),
    turns: typeof input.turns === "number" && Number.isFinite(input.turns) ? Math.max(0, input.turns) : 1, known: true };
  usage.known = known;
  return usage;
}
export function addUsage(left: Usage, right: Usage): Usage {
  return { input: left.input + right.input, output: left.output + right.output, cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite, turns: left.turns + right.turns, known: left.known && right.known };
}
export const usageTokens = (usage: Usage): number => usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
export function taskUsage(state: TaskState): Usage {
  return Object.values(state.childUsage).reduce((sum, row) => addUsage(sum, row.usage), state.ownerUsage);
}
export function newTask(original: Artifact, origin: Artifact): TaskState {
  const now = Date.now();
  return { schemaVersion: 1, id: randomUUID(), revision: 1, generation: 1, status: "running", original, origin, amendments: [],
    startedAt: now, updatedAt: now, obligations: [], nodes: {}, observations: {}, artifacts: { [original.id]: original, [origin.id]: origin },
    reviews: [], unresolved: [], ownerUsage: emptyUsage(), childUsage: {}, orphanedRuns: [] };
}
export function remember(state: TaskState, ref: Artifact): Artifact { state.artifacts[ref.id] = ref; return ref; }
export function requirementText(state: TaskState, store: Artifacts): string {
  return store.text(state.original) + state.amendments.map((ref, i) => `\n\nUSER REVISION ${i + 2}:\n${store.text(ref)}`).join("");
}
export function topological(nodes: Record<string, TaskNode>, ids = Object.keys(nodes)): string[] {
  const ordered: string[] = [], active = new Set<string>(), done = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id)) return;
    if (active.has(id)) throw new Error(`DEPENDENCY_CYCLE: ${id}`);
    const node = nodes[id]; if (!node) throw new Error(`MISSING_DEPENDENCY: ${id}`);
    active.add(id);
    for (const dependency of node.dependsOn) visit(dependency);
    active.delete(id); done.add(id); ordered.push(id);
  };
  ids.forEach(visit);
  return ordered;
}
export function versionsCurrent(state: TaskState, versions: Record<string, number>): boolean {
  return Object.entries(versions).every(([id, version]) => state.nodes[id]?.version === version && !["stale", "cancelled", "rejected", "failed", "unknown"].includes(state.nodes[id].status));
}
export function invalidateDescendants(state: TaskState, changed: string[]): string[] {
  const invalid = new Set(changed);
  let size = -1;
  while (size !== invalid.size) {
    size = invalid.size;
    for (const node of Object.values(state.nodes)) if (node.dependsOn.some(id => invalid.has(id))) invalid.add(node.id);
  }
  for (const id of invalid) {
    const node = state.nodes[id]; if (!node) continue;
    node.version++;
    if (["starting", "running", "unknown"].includes(node.status) && node.attempt) state.orphanedRuns.push(structuredClone(node.attempt));
    node.status = "stale";
    node.reason = "A declared input or node contract changed; prior observations remain history, not current authority.";
    delete node.admission;
  }
  if (state.stage && Object.keys(state.stage.nodeVersions).some(id => invalid.has(id))) delete state.stage;
  state.reviews = state.reviews.filter(review => !invalid.has(review.nodeId));
  return [...invalid];
}

export function validateState(raw: unknown): TaskState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("CORRUPT_TASK_STATE");
  const state = raw as TaskState;
  safeId(state.id);
  if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 1 || !Number.isSafeInteger(state.generation) || state.generation < 1) throw new Error("CORRUPT_TASK_VERSION");
  if (!["running", "paused", "blocked", "budget_exhausted", "cancelled", "complete"].includes(state.status)) throw new Error("CORRUPT_TASK_STATUS");
  for (const name of ["amendments", "obligations", "reviews", "unresolved", "orphanedRuns"] as const) if (!Array.isArray(state[name])) throw new Error(`CORRUPT_TASK_${name}`);
  for (const name of ["nodes", "observations", "artifacts", "ownerUsage", "childUsage"] as const) if (!state[name] || typeof state[name] !== "object" || Array.isArray(state[name])) throw new Error(`CORRUPT_TASK_${name}`);
  if (!state.original || !state.origin || state.obligations.length > 128 || Object.keys(state.nodes).length > 10000 || Object.keys(state.artifacts).length > 20000) throw new Error("TASK_STATE_BOUND_EXCEEDED");
  const obligationIds = new Set<string>();
  for (const item of state.obligations) {
    safeId(item.id); if (obligationIds.has(item.id) || typeof item.description !== "string" || typeof item.quote !== "string" || typeof item.source !== "string") throw new Error("INVALID_OBLIGATION");
    obligationIds.add(item.id);
  }
  for (const [id, node] of Object.entries(state.nodes)) {
    safeId(id);
    if (node.id !== id || !Number.isSafeInteger(node.version) || node.version < 1 || !["gemini", "flash"].includes(node.pool)
      || !["inspect", "patch", "select", "review"].includes(node.kind) || !Array.isArray(node.dependsOn) || !Array.isArray(node.priorAttempts)
      || !["pending", "starting", "running", "returned", "admitted", "rejected", "failed", "cancelled", "stale", "unknown"].includes(node.status)) throw new Error(`INVALID_NODE_STATE: ${id}`);
    if (!node.spec || !state.artifacts[node.spec.id]) throw new Error("NODE_SPEC_NOT_RECORDED");
    if (node.attempt) {
      safeId(node.attempt.id);
      if (!node.attempt.base || typeof node.attempt.inputVersions !== "object" || !node.attempt.launchIntent) throw new Error("INVALID_NODE_ATTEMPT");
    }
  }
  for (const [id, ref] of Object.entries(state.artifacts)) {
    if (!/^a-[a-f0-9]{64}$/.test(id) || ref.id !== id || ref.sha256 !== id.slice(2) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) throw new Error("INVALID_ARTIFACT_REFERENCE");
  }
  topological(state.nodes);
  if (state.status === "complete" && (!state.stage || !state.finalReceipt || !state.delivery)) throw new Error("COMPLETE_WITHOUT_DELIVERY_RECEIPTS");
  return state;
}

export class TaskJournal {
  failed = false;
  constructor(readonly manager: SessionManager, readonly append: (type: string, value: unknown) => void) {}
  restore(): TaskState | undefined {
    const entry = [...this.manager.getBranch()].reverse().find(entry => entry.type === "custom" && entry.customType === TASK_ENTRY);
    if (entry?.type !== "custom") return undefined;
    const state = structuredClone(validateState(entry.data));
    if (state.status === "running") {
      state.status = "paused";
      state.generation++;
      state.reason = "Native session reopened. In-flight native runs must be reconciled before any new dispatch; no automatic replay.";
    }
    return state;
  }
  save(state: TaskState): void {
    if (this.failed) throw new Error("DURABILITY_FAILED: session is latched read-only until reopened and reconciled");
    try {
      state.updatedAt = Date.now();
      validateState(state);
      const json = JSON.stringify(state);
      if (Buffer.byteLength(json) > 8 * 1024 * 1024) throw new Error("Task projection exceeded 8 MiB; raw native history is retained");
      this.append(TASK_ENTRY, JSON.parse(json));
      const file = this.manager.getSessionFile();
      if (!file) throw new Error("Native session is not persistent");
      syncFile(file);
    } catch (error) {
      this.failed = true;
      state.status = "blocked";
      state.generation++;
      state.reason = `Durability failure; no further execution or acceptance is authorized: ${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  }
}

export function progressKey(state: TaskState): string {
  return jsonHash({ revision: state.revision, nodes: Object.values(state.nodes).map(n => [n.id, n.version, n.status]),
    observations: Object.keys(state.observations), stage: state.stage?.id, unresolved: state.unresolved, obligations: state.obligations });
}
