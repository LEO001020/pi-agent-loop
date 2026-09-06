import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Artifacts } from "../src/artifacts.ts";
import { loadConfig } from "../src/config.ts";
import { ensureNativePersistence } from "../src/io.ts";
import { checkPath, scopedBash, scopedTools, toolEnvironment, type ToolScope } from "../src/sandbox.ts";
import { PythonAccelerator } from "../src/python.ts";
import { candidateFrom, candidatePatch, git, gitText, importWorkspace, treeIdentity, applyToSource } from "../src/workspace.ts";

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "pi-loop-primitives-"));
  const root = join(base, "workspace"); mkdirSync(root);
  const cfg = loadConfig(undefined, { home: join(base, "profile"), credentialsFile: join(base, "credentials.json") });
  const scope: ToolScope = { root, scratch: join(base, "scratch"), writable: true, writeScopes: ["."], readRoots: [] };
  return { base, root, cfg, scope, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("first original task is durable before any assistant message", () => {
  const f = fixture();
  try {
    const manager = SessionManager.create(f.root, join(f.base, "sessions"));
    ensureNativePersistence(manager);
    manager.appendCustomEntry("test.original", { objective: "do not wait for a model to save this" });
    assert.match(readFileSync(manager.getSessionFile()!, "utf8"), /do not wait for a model/);
    const reopened = SessionManager.open(manager.getSessionFile()!);
    assert.equal(reopened.getEntries().filter(x => x.type === "custom").length, 1);
  } finally { f.cleanup(); }
});

test("artifact cursor returns a match after 6000 characters and reconstructs long lines", () => {
  const f = fixture();
  try {
    const store = new Artifacts(join(f.base, "artifacts"));
    const text = "x".repeat(21000) + "NEEDED_TAIL" + "y".repeat(9000);
    const ref = store.put(text, { media: "text/plain", provenance: "tool-observation", label: "long raw output" });
    const match = store.read(ref, 0, 1000, "NEEDED_TAIL") as any;
    assert.ok(match.offset > 6000); assert.match(match.text, /NEEDED_TAIL/);
    let offset: number | null = 0, actual = "";
    while (offset !== null) { const row = store.read(ref, offset, 4096) as any; actual += row.text; offset = row.nextOffset; }
    assert.equal(actual, text);
    writeFileSync(store.path(ref), "tampered");
    assert.throws(() => store.text(ref), /ARTIFACT_CHANGED/);
  } finally { f.cleanup(); }
});

test("scoped native tools retain real schemas, reject traversal, and enforce OS write boundaries", async () => {
  const f = fixture();
  try {
    const outside = join(f.base, "outside"); mkdirSync(outside); writeFileSync(join(outside, "secret"), "CANARY");
    symlinkSync(outside, join(f.root, "escape"));
    assert.throws(() => checkPath(f.scope, "escape/secret"), /TOOL_PATH_SCOPE/);
    const tools = scopedTools(f.cfg, () => f.scope);
    const ctx = { cwd: f.root } as any;
    await tools.find(t => t.name === "write")!.execute("w", { path: "number.txt", content: "41\n" }, undefined, undefined, ctx);
    await tools.find(t => t.name === "edit")!.execute("e", { path: "number.txt", edits: [{ oldText: "41", newText: "42" }] }, undefined, undefined, ctx);
    const content = await tools.find(t => t.name === "read")!.execute("r", { path: "number.txt" }, undefined, undefined, ctx);
    assert.match(JSON.stringify(content.content), /42/);
    const command = `! cat '${outside}/secret' && ! sh -c 'echo bad > "${outside}/secret"' && echo allowed`;
    let output = "";
    const result = await scopedBash(f.cfg, f.scope).exec(command, f.root, { onData: data => { output += data.toString(); }, timeout: 10 });
    assert.equal(result.exitCode, 0, output); assert.match(output, /allowed/);
    assert.equal(readFileSync(join(outside, "secret"), "utf8"), "CANARY");
    const denied = await scopedBash(f.cfg, { ...f.scope, writable: false }).exec("echo bad > number.txt", f.root, { onData: () => {}, timeout: 5 });
    assert.notEqual(denied.exitCode, 0); assert.equal(readFileSync(join(f.root, "number.txt"), "utf8"), "42\n");
    assert.equal(toolEnvironment(f.cfg, f.scope).PI_LOOP_GLM_KEY, undefined);
  } finally { f.cleanup(); }
});

test("dirty user snapshot and no-op candidates are valid; changed source refuses publication", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "file.txt"), "first\n");
    git(f.root, ["init"]); git(f.root, ["add", "."]); git(f.root, ["commit", "-m", "initial"]);
    writeFileSync(join(f.root, "file.txt"), "dirty user state\n");
    writeFileSync(join(f.root, "extra.txt"), "user untracked\n");
    const origin = importWorkspace(f.cfg, f.root);
    const candidate = candidateFrom(origin, join(f.base, "candidate"), [], {});
    assert.equal(candidate.tree.sha256, origin.initial.sha256);
    assert.equal(candidatePatch(origin, candidate).length, 0);
    writeFileSync(join(candidate.root, "file.txt"), "fixed\n");
    git(candidate.root, ["add", "file.txt"]); git(candidate.root, ["commit", "-m", "fix"]);
    candidate.commit = gitText(candidate.root, ["rev-parse", "HEAD"]); candidate.tree = treeIdentity(candidate.root);
    const patch = join(f.base, "delivery.patch"); writeFileSync(patch, candidatePatch(origin, candidate));
    writeFileSync(join(f.root, "extra.txt"), "later user work\n");
    assert.throws(() => applyToSource(origin, patch), /SOURCE_CHANGED/);
    assert.equal(readFileSync(join(f.root, "file.txt"), "utf8"), "dirty user state\n");
  } finally { f.cleanup(); }
});

test("real sandboxed IPython keeps variables, survives a Python exception, and resets explicitly", { timeout: 120000 }, async () => {
  const f = fixture();
  const python = new PythonAccelerator(f.cfg, () => f.scope, join(f.base, "cells"));
  try {
    const first = await python.execute("value = 37\nprint(value)");
    assert.equal(first.status, "ok", JSON.stringify(first)); assert.match(first.stdout, /37/);
    const second = await python.execute("print(value + 5)");
    assert.equal(second.status, "ok"); assert.match(second.stdout, /42/); assert.equal(second.kernelEpoch, first.kernelEpoch);
    const broken = await python.execute("raise ValueError('intentional cell failure')");
    assert.equal(broken.status, "error");
    const recovered = await python.execute("print(value)"); assert.match(recovered.stdout, /37/);
    const noSecrets = await python.execute("import os\nprint(os.environ.get('PI_LOOP_GLM_KEY'), os.environ.get('PI_LOOP_GEMINI_KEY'))");
    assert.match(noSecrets.stdout, /None None/);
    python.reset();
    const reset = await python.execute("print('value' in globals())");
    assert.match(reset.stdout, /False/); assert.ok(reset.resetNotice); assert.ok(reset.kernelEpoch > first.kernelEpoch);
    const controller = new AbortController();
    const running = python.execute("import time\ntime.sleep(30)", controller.signal);
    setTimeout(() => controller.abort(), 300);
    const interrupted = await running; assert.equal(interrupted.status, "aborted");
    const alive = await python.execute("print(6 * 7)"); assert.equal(alive.status, "ok"); assert.match(alive.stdout, /42/);
  } finally { await python.dispose(); f.cleanup(); }
});
