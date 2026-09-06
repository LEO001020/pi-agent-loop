import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { Artifacts } from "../src/artifacts.ts";
import { candidateFrom, git, gitText, importWorkspace, treeIdentity } from "../src/workspace.ts";
import { verifyCandidate } from "../src/verification.ts";
import { invalidateDescendants, newTask, remember, TaskJournal, topological, type TaskNode } from "../src/state.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ensureNativePersistence } from "../src/io.ts";

function setup() {
  const base = mkdtempSync(join(tmpdir(), "pi-loop-verify-"));
  const source = join(base, "source"); mkdirSync(source);
  writeFileSync(join(source, "value.txt"), "wrong\n");
  const cfg = loadConfig(undefined, { home: join(base, "profile"), credentialsFile: join(base, "keys.json") });
  const origin = importWorkspace(cfg, source);
  const baseline = candidateFrom(origin, join(base, "baseline"), [], {});
  const candidate = candidateFrom(origin, join(base, "candidate"), [], {});
  const store = new Artifacts(join(base, "artifacts"));
  return { base, source, cfg, origin, baseline, candidate, store, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("a check cannot repair its source copy and certify the unmodified wrong candidate", async () => {
  const f = setup();
  try {
    const result = await verifyCandidate({ ...f, target: "candidate", revision: 1, generation: 1, root: join(f.base, "checks"),
      spec: { description: "must not certify repaired test input", script: "set -e\nprintf 'right\\n' > value.txt\ngrep -qx right value.txt" } });
    assert.equal(result.receipt.passed, false);
    assert.notEqual(result.receipt.candidate.exitCode, 0);
    assert.match(f.store.text(result.receipt.candidate.output), /Permission denied/);
    assert.equal(readFileSync(join(f.candidate.root, "value.txt"), "utf8"), "wrong\n");
  } finally { f.cleanup(); }
});

test("missing baseline script or failed environment preflight is not defect reproduction", async () => {
  const f = setup();
  try {
    writeFileSync(join(f.candidate.root, "value.txt"), "right\n");
    git(f.candidate.root, ["add", "."]); git(f.candidate.root, ["commit", "-m", "candidate"]);
    f.candidate.commit = gitText(f.candidate.root, ["rev-parse", "HEAD"]); f.candidate.tree = treeIdentity(f.candidate.root);
    const failed = await verifyCandidate({ ...f, target: "candidate", revision: 1, generation: 1, root: join(f.base, "checks"),
      spec: { description: "missing environment is not an assertion", script: "grep -qx right value.txt", preflight: "test -f does-not-exist.py",
        expectBaselineFailure: true, baselineFailureMarker: "expected wrong value" } });
    assert.equal(failed.receipt.passed, false); assert.equal(failed.receipt.baseline?.error, "PREFLIGHT_FAILED");
    const valid = await verifyCandidate({ ...f, target: "candidate", revision: 1, generation: 1, root: join(f.base, "checks"),
      spec: { description: "value must be right", preflight: "test -f value.txt", expectBaselineFailure: true,
        baselineFailureMarker: "ASSERT_VALUE_MISMATCH", script: "if ! grep -qx right value.txt; then echo ASSERT_VALUE_MISMATCH; exit 7; fi" } });
    assert.equal(valid.receipt.passed, true, JSON.stringify(valid.receipt));
    assert.equal(valid.receipt.baseline?.exitCode, 7); assert.equal(valid.receipt.candidate.exitCode, 0);
  } finally { f.cleanup(); }
});

test("generated-output permissions may not cover any protected candidate input", async () => {
  const f = setup();
  try {
    await assert.rejects(verifyCandidate({ ...f, target: "candidate", revision: 1, generation: 1, root: join(f.base, "checks"),
      spec: { description: "invalid grant", script: "true", outputDirectories: ["value.txt"] } }), /OUTPUT_GRANT_OVERLAPS_INPUT/);
    const valid = await verifyCandidate({ ...f, target: "candidate", revision: 1, generation: 1, root: join(f.base, "checks"),
      spec: { description: "write an output without changing input", script: "cp value.txt .test-output/result; cmp value.txt .test-output/result", outputDirectories: [".test-output"] } });
    assert.equal(valid.receipt.passed, true);
  } finally { f.cleanup(); }
});

test("dependency invalidation is local and does not erase independent evidence", () => {
  const f = setup();
  try {
    const original = f.store.put("Repair A and B", { media: "text/plain", provenance: "user-input", label: "request" });
    const origin = f.store.put(f.origin, { media: "application/json", provenance: "host-record", label: "origin" });
    const state = newTask(original, origin);
    const add = (id: string, dependsOn: string[]): void => {
      const spec = remember(state, f.store.put({ id }, { media: "application/json", provenance: "host-record", label: id }));
      state.nodes[id] = { id, version: 1, pool: "gemini", kind: "inspect", label: id, spec, dependsOn, status: "admitted", priorAttempts: [] };
    };
    add("a", []); add("b", []); add("c", ["a"]); add("d", ["c"]);
    assert.deepEqual(topological(state.nodes), ["a", "b", "c", "d"]);
    assert.deepEqual(invalidateDescendants(state, ["a"]).sort(), ["a", "c", "d"]);
    assert.equal(state.nodes.b.status, "admitted"); assert.equal(state.nodes.b.version, 1);
    assert.equal(state.nodes.d.status, "stale");
    state.nodes.a.dependsOn = ["d"];
    assert.throws(() => topological(state.nodes), /DEPENDENCY_CYCLE/);
  } finally { f.cleanup(); }
});

test("durability failure latches a task out of success even when append throws", () => {
  const f = setup();
  try {
    const original = f.store.put("Complete this task", { media: "text/plain", provenance: "user-input", label: "request" });
    const origin = f.store.put(f.origin, { media: "application/json", provenance: "host-record", label: "origin" });
    const state = newTask(original, origin);
    const manager = SessionManager.create(f.source, join(f.base, "sessions")); ensureNativePersistence(manager);
    const journal = new TaskJournal(manager, () => { throw new Error("simulated disk-full"); });
    assert.throws(() => journal.save(state), /disk-full/);
    assert.equal(journal.failed, true); assert.equal(state.status, "blocked"); assert.ok(state.generation > 1);
  } finally { f.cleanup(); }
});
