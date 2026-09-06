import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { arch, platform, release } from "node:os";
import { randomUUID } from "node:crypto";
import { Artifacts, type Artifact } from "./artifacts.ts";
import { type Config, ROOT, redact } from "./config.ts";
import { jsonHash, privateDir, relativePath, sha256 } from "./io.ts";
import { scopedBash, quote, type ToolScope } from "./sandbox.ts";
import { assertCandidate, copyTree, treeIdentity, type Candidate } from "./workspace.ts";

export interface CheckSpec {
  description: string;
  script: string;
  preflight?: string;
  expectBaselineFailure?: boolean;
  baselineFailureMarker?: string;
  outputDirectories?: string[];
}
export interface ExecutionObservation {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  exitCode: number | null;
  error?: string;
  output: Artifact;
  outputBytes: number;
  outputComplete: boolean;
  before: string;
  after: string;
  inputUnchanged: boolean;
  preflight?: { exitCode: number | null; output: Artifact; error?: string };
}
export interface VerificationReceipt {
  version: 1;
  id: string;
  target: string;
  candidateId: string;
  candidateHash: string;
  candidateCommit: string;
  nodeVersions: Record<string, number>;
  taskRevision: number;
  taskGeneration: number;
  spec: Artifact;
  script: Artifact;
  environment: { sha256: string; record: Artifact };
  candidate: ExecutionObservation;
  baseline?: ExecutionObservation;
  passed: boolean;
  reason: string;
  authority: "COMMAND_OBSERVATION_NOT_SEMANTIC_ORACLE";
  integrity: "read-only-source-with-private-generated-output";
}

export function environmentIdentity(cfg: Config): object {
  const file = (path: string): string | null => existsSync(path) ? sha256(readFileSync(path)) : null;
  return {
    os: [platform(), arch(), release()], node: { version: process.version, binary: file(realpathSync(process.execPath)) },
    python: { executable: cfg.python.executable, binary: existsSync(cfg.python.executable) ? file(realpathSync(cfg.python.executable)) : null,
      packages: file(join(ROOT, "requirements.lock")) },
    npmLock: file(join(ROOT, "package-lock.json")), landrun: file(cfg.sandbox.landrun),
    nativePatch: file(join(ROOT, "runtime", "native-patch-manifest.json")), replPatch: file(join(ROOT, "runtime", "repl-patch-manifest.json")),
    network: cfg.sandbox.network, readRoots: cfg.sandbox.readRoots,
    coverage: "candidate file bytes, evaluator script, lockfiles, declared runtime binaries/configuration; not all system-library bytes or mutable remote-service state",
  };
}

export async function observeCommand(cfg: Config, scope: ToolScope, command: string, store: Artifacts, label: string, signal?: AbortSignal, extraReads: string[] = []): Promise<{ exitCode: number | null; output: Artifact; outputBytes: number; outputComplete: boolean; error?: string; startedAt: number; endedAt: number }> {
  const startedAt = Date.now();
  const buffers: Buffer[] = [];
  let bytes = 0, retained = 0, exitCode: number | null = null, error: string | undefined;
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const result = await scopedBash(cfg, scope, extraReads).exec(command, scope.root, {
      signal: combined, timeout: cfg.budget.checkSeconds,
      onData: chunk => {
        bytes += chunk.length;
        if (retained + chunk.length <= 60 * 1024 * 1024) { buffers.push(Buffer.from(chunk)); retained += chunk.length; }
        else controller.abort(new Error("Verification output exceeded 60 MiB; incomplete output cannot pass acceptance"));
      },
    });
    exitCode = result.exitCode;
  } catch (failure) { error = redact(failure instanceof Error ? failure.message : String(failure)); }
  const output = store.put(redact(Buffer.concat(buffers).toString("utf8")), { label, media: "text/plain", provenance: "tool-observation" });
  return { exitCode, output, outputBytes: bytes, outputComplete: bytes === retained, ...(error ? { error } : {}), startedAt, endedAt: Date.now() };
}

export function validateCheckSpec(spec: CheckSpec): void {
  if (!spec.description?.trim() || !spec.script?.trim() || spec.script.length > 64000) throw new Error("Check requires a description and bounded executable script");
  if (spec.expectBaselineFailure && (!spec.preflight?.trim() || !spec.baselineFailureMarker?.trim())) throw new Error("A claimed reproduction needs a successful baseline preflight and a specific failure marker, not just nonzero exit");
  for (const path of spec.outputDirectories ?? []) {
    relativePath(path);
    if ([".", "", "/"].includes(path) || path.startsWith(".git")) throw new Error("Output permission cannot cover the source root or Git metadata");
  }
}

export async function verifyCandidate(input: {
  cfg: Config; store: Artifacts; target: string; candidate: Candidate; baseline?: Candidate;
  revision: number; generation: number; spec: CheckSpec; root: string; signal?: AbortSignal;
}): Promise<{ receipt: VerificationReceipt; artifact: Artifact; artifacts: Artifact[] }> {
  const { cfg, store, candidate, baseline, spec, signal } = input;
  validateCheckSpec(spec);
  assertCandidate(candidate);
  if (baseline) assertCandidate(baseline);
  if (spec.expectBaselineFailure && !baseline) throw new Error("No baseline was supplied for the differential check");
  const outputDirectories = spec.outputDirectories ?? [];
  for (const source of [candidate, baseline].filter((x): x is Candidate => Boolean(x))) {
    for (const path of outputDirectories) {
      const prefix = path.replace(/\/$/, "");
      if (source.tree.files.some(f => f.path === prefix || f.path.startsWith(`${prefix}/`))) throw new Error(`OUTPUT_GRANT_OVERLAPS_INPUT: ${path}`);
    }
  }
  const id = randomUUID();
  const home = privateDir(join(input.root, id));
  const script = store.put(spec.script, { label: `check-script-${id}`, media: "text/plain", provenance: "host-record" });
  const specRef = store.put(spec, { label: `check-spec-${id}`, media: "application/json", provenance: "host-record" });
  const environment = environmentIdentity(cfg), environmentHash = jsonHash(environment);
  const environmentRef = store.put(environment, { label: `check-environment-${id}`, media: "application/json", provenance: "host-record" });
  const records: Artifact[] = [script, specRef, environmentRef];
  const protectedScript = store.path(script);
  const run = async (source: Candidate, tag: string): Promise<ExecutionObservation> => {
    const root = join(home, tag, "source");
    copyTree(source.root, root, source.tree);
    const before = treeIdentity(root).sha256;
    const outputRoots = outputDirectories.map(path => privateDir(join(root, path)));
    const scope: ToolScope = { root, scratch: join(home, tag, "scratch"), writable: false, writeScopes: [], readRoots: [], outputRoots };
    let preflight: ExecutionObservation["preflight"];
    if (spec.preflight) {
      const p = await observeCommand(cfg, scope, `set -euo pipefail\n${spec.preflight}`, store, `${tag}-preflight`, signal);
      records.push(p.output);
      preflight = { exitCode: p.exitCode, output: p.output, ...(p.error ? { error: p.error } : {}) };
    }
    const observed = preflight && (preflight.exitCode !== 0 || preflight.error)
      ? { exitCode: null, output: preflight.output, outputBytes: preflight.output.bytes, outputComplete: true, error: "PREFLIGHT_FAILED", startedAt: Date.now(), endedAt: Date.now() }
      : await observeCommand(cfg, scope, `set -euo pipefail\n/bin/bash --noprofile --norc ${quote(protectedScript)}`, store, `${tag}-check-output`, signal, [protectedScript]);
    records.push(observed.output);
    const after = treeIdentity(root, { exclusions: outputDirectories }).sha256;
    return { ...observed, before, after, inputUnchanged: before === source.tree.sha256 && before === after,
      durationMs: observed.endedAt - observed.startedAt, ...(preflight ? { preflight } : {}) };
  };
  // Both execute the same protected script; neither can rewrite its input copy.
  const candidateRun = await run(candidate, "candidate");
  const baselineRun = spec.expectBaselineFailure && baseline ? await run(baseline, "baseline") : undefined;
  assertCandidate(candidate); if (baseline) assertCandidate(baseline);
  const environmentUnchanged = jsonHash(environmentIdentity(cfg)) === environmentHash;
  const candidatePassed = candidateRun.exitCode === 0 && !candidateRun.error && candidateRun.outputComplete && candidateRun.inputUnchanged;
  const differentialPassed = !spec.expectBaselineFailure || Boolean(baselineRun && baselineRun.exitCode !== null && baselineRun.exitCode !== 0
    && !baselineRun.error && baselineRun.inputUnchanged && baselineRun.outputComplete && baselineRun.preflight?.exitCode === 0
    && store.text(baselineRun.output).includes(spec.baselineFailureMarker!));
  const passed = candidatePassed && differentialPassed && environmentUnchanged && !signal?.aborted;
  const receipt: VerificationReceipt = {
    version: 1, id, target: input.target, candidateId: candidate.id, candidateHash: candidate.tree.sha256, candidateCommit: candidate.commit,
    nodeVersions: candidate.nodeVersions, taskRevision: input.revision, taskGeneration: input.generation,
    spec: specRef, script, environment: { sha256: environmentHash, record: environmentRef }, candidate: candidateRun,
    ...(baselineRun ? { baseline: baselineRun } : {}), passed,
    reason: passed ? "The recorded command passed on unchanged candidate input bytes under the declared environment; broader task success still requires semantic obligation coverage."
      : !environmentUnchanged ? "DECLARED_ENVIRONMENT_CHANGED" : !candidatePassed ? "CANDIDATE_CHECK_FAILED_OR_INPUT_CHANGED" : !differentialPassed ? "BASELINE_DID_NOT_ESTABLISH_EXPECTED_FAILURE" : "CANCELLED",
    authority: "COMMAND_OBSERVATION_NOT_SEMANTIC_ORACLE", integrity: "read-only-source-with-private-generated-output",
  };
  const artifact = store.put(receipt, { label: `verification-${id}`, media: "application/json", provenance: "tool-observation" });
  records.push(artifact);
  return { receipt, artifact, artifacts: records };
}
