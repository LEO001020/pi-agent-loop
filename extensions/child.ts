import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ChildContract } from "../src/child-contract.ts";
import { atomicJson, jsonHash, privateDir, within } from "../src/io.ts";
import { installScopedTools, landrunArgs, type ToolScope } from "../src/sandbox.ts";
import { PythonAccelerator, installPython } from "../src/python.ts";
import { gitText } from "../src/workspace.ts";

/** Loaded as an explicitly pinned child extension, never via ambient discovery.
 * Child agents keep native sessions/lifecycles; this adapter constrains tools. */
export function setupChild(pi: ExtensionAPI, contract: ChildContract): void {
  const cfg = contract.cfg;
  if (contract.version !== 1 || !within(join(cfg.home, "tasks"), contract.runtimeDir) || !within(contract.runtimeDir, contract.attestationPath)) throw new Error("FOREIGN_CHILD_CONTRACT");
  let ready = false;
  let scope: ToolScope = {
    root: contract.baseRoot, scratch: join(contract.runtimeDir, "scratch"), writable: false,
    writeScopes: [], readRoots: [contract.inputsDir],
  };
  const childCfg = { ...cfg, python: { ...cfg.python, enabled: cfg.python.enabled && contract.repl } };
  installScopedTools(pi, childCfg, () => scope);
  const python = new PythonAccelerator(childCfg, () => scope, privateDir(join(contract.runtimeDir, "cells")));
  installPython(pi, python);
  const active = ["read", "bash", "grep", "find", "ls", ...(contract.kind === "patch" ? ["write", "edit"] : []), ...(childCfg.python.enabled ? ["execute"] : [])];
  pi.on("session_start", (_event, ctx) => {
    const root = realpathSync(ctx.cwd);
    if (!within(join(cfg.home, "worktrees"), root) && root !== realpathSync(contract.baseRoot)) throw new Error("CHILD_CWD_OUTSIDE_OWNED_WORKSPACE");
    const marker = join(root, ".git");
    const metadata = gitText(root, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--git-dir"]).split("\n");
    const commit = gitText(root, ["rev-parse", "HEAD"]);
    if (commit !== contract.baseCommit) throw new Error("CHILD_BASE_COMMIT_MISMATCH");
    scope = {
      root, scratch: join(contract.runtimeDir, "scratch"), writable: contract.kind === "patch", writeScopes: contract.scope,
      readRoots: [contract.inputsDir, ...metadata.map(path => realpathSync(path))],
    };
    landrunArgs(childCfg, scope);
    pi.setActiveTools(active);
    atomicJson(contract.attestationPath, {
      version: 1, taskId: contract.taskId, taskRevision: contract.taskRevision, generation: contract.generation,
      nodeId: contract.nodeId, nodeVersion: contract.nodeVersion, attemptId: contract.attemptId,
      root, baseCommit: commit, initializedAt: Date.now(), contractHash: jsonHash(contract), tools: active,
      gitMarker: existsSync(marker) && lstatSync(marker).isFile() ? readFileSync(marker, "utf8") : "owned-base-repository",
      protection: "scoped-tool-processes; parent native runtime and declared packages remain trusted",
    });
    ready = true;
  });
  pi.on("tool_call", event => {
    if (!ready || !active.includes(event.toolName)) return { block: true, reason: "The scoped child tool contract is not ready or does not authorize this tool." };
    return undefined;
  });
  pi.on("before_agent_start", event => ({ systemPrompt: `${event.systemPrompt}\n\nPI LOOP CHILD CONTRACT\nYour actual repository working directory is ${scope.root}. Read and edit repository files relative to that directory. The separate directory ${contract.inputsDir} contains only the original request and labelled upstream evidence, NOT the repository files. You own exactly one bounded task. Your isolated workspace is not the user's original directory. Do not modify Git metadata, sibling workspaces, native control files, or scope-excluded paths. The shell/Python filesystem boundary is enforced; write scope within your own tree is additionally checked at handoff. Input records retain whether premises are supported observations or provisional hypotheses. Reports, including your own acceptance report, remain model claims. Do not imply final user-task completion. Preserve reproducible scripts and exact observed failures. Persistent Python is optional and volatile; ordinary scripts remain available. No nested agents or independent provider calls are authorized.` }));
  pi.on("session_shutdown", async () => {
    ready = false;
    await python.dispose();
    if (existsSync(contract.attestationPath)) {
      const record = JSON.parse(readFileSync(contract.attestationPath, "utf8"));
      atomicJson(contract.attestationPath, { ...record, closedAt: Date.now() });
    }
  });
}
