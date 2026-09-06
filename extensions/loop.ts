import { Type, type TSchema } from "typebox";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { TaskController, type ControllerHost } from "../src/controller.ts";
import { PythonAccelerator, installPython } from "../src/python.ts";
import { installScopedTools, type ToolScope } from "../src/sandbox.ts";
import { privateDir } from "../src/io.ts";
import { redact } from "../src/config.ts";

export interface LoopBinding extends ControllerHost {
  controller?: TaskController;
  python?: PythonAccelerator;
  ready: boolean;
  initializationError?: string;
}
const stableId = Type.String({ minLength: 1, maxLength: 96 });
const text = Type.String({ minLength: 1, maxLength: 6000 });
const ids = Type.Array(stableId, { maxItems: 128 });
const object = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value });

const OPERATING_POLICY = `PI AGENT LOOP — REVISABLE EVIDENCE DATAFLOW
You are the one GLM-5.3 semantic owner. Optimize verified task success and avoid downstream error propagation, not agent count or ceremony. Inspect actual files and compute directly using the available read-only shell and optional Python. The user's original directory is preserved; all patch generation occurs in isolated Gemini worktrees. Persistent Python variables are optional accelerators, never final verification inputs.

First read the unaltered request and record its material obligations with exact source-artifact quotes. A checklist is an interpretation, not permission to discard a requirement. Create meaningful inspect/patch/select/review nodes with explicit dependencies. Gemini execution has a 10-20 lane pool, and its first fan-out requires at least 10 genuinely independent contracts; use distinct investigations, independent test cases, or alternative implementations rather than duplicate role chatter. Keep useful capacity filled when justified ready work exists. Flash's separate 1-8 pool supports selection, light analysis and independent review. The root remains one instance.

Workers return CLAIMS. A native completed run means lifecycle completion, not semantic validity. Before a dependency can be consumed, explicitly admit it as supported by a current host-recorded source observation/check, or as an explicit provisional hypothesis. Keep provisional premises conditional; they cannot certify final delivery. Use loop_observe for exact source evidence and loop_check for independent executable checks. Ordinary worker self-tests are useful diagnostics but are not independent acceptance receipts.

The graph is revisable. When evidence contradicts a premise, revise or reject only the affected dependency closure; preserve independent work. Do not compile uncertain semantic transitions into unconditional success edges. Selection compares alternatives; it does not make them true. New synthesis is a new patch node. Native worktrees prevent file collisions; exact preimage and input-version checks reject incompatible integration.

Stage chosen admitted patch nodes. Check the exact integrated stage independently using a script outside the writer's authority and read-only source inputs. Build outputs may use explicitly empty output directories or scratch; do not grant write access to input files. Reproduction checks require a successful baseline preflight and an actual expected failure marker, not a missing command or missing test file. A successful command supports only its tested proposition. Request independent Flash reviews of the actual stage and original request; retain concrete concerns until explicitly resolved with discriminating evidence.

Finish only through loop_finish: every material original obligation must map to current stage observations, at least one current executable check must pass, independent stage review must support completion, and unresolved counterexamples or provisional dependencies must not remain. A legitimate diagnostic/no-op task may have an empty diff. No model's confidence, majority, JSON validity, generated test, clean diff, or native terminal status is an oracle.

Use loop_history and loop_evidence to recover raw records after compaction. Large entries support intra-entry character offsets; a truncated preview is not the whole evidence. Distinguish historical observations from current workspace state. No hidden reasoning trace is promised. Cancellation, user revisions and session replacement invalidate old callbacks. Use loop_block for a real blocker; do not loop on empty 'continue' messages. Missing provider prices are UNKNOWN, not zero cost.`;

export function setupLoop(pi: ExtensionAPI, binding: LoopBinding): void {
  const control = new TaskController(pi, binding); binding.controller = control;
  let context: ExtensionContext | undefined;
  const scope = (): ToolScope => {
    const task = control.state?.id;
    return { root: binding.origin.repo, scratch: privateDir(join(binding.cfg.home, "owner-scratch", binding.manager.getSessionId(), task ?? "idle")),
      writable: false, writeScopes: [], readRoots: [binding.store.root, binding.manager.getSessionFile()!, ...(task ? [privateDir(join(binding.cfg.home, "tasks", task))] : [])] };
  };
  installScopedTools(pi, binding.cfg, scope);
  const python = new PythonAccelerator(binding.cfg, scope, privateDir(join(binding.cfg.home, "owner-cells", binding.manager.getSessionId())));
  binding.python = python;
  installPython(pi, python);
  const tools: ToolDefinition<any, any, any>[] = [];
  const add = <T extends TSchema>(tool: ToolDefinition<T, any, any>): void => {
    const run = tool.execute.bind(tool);
    tool.execute = async (id, args, signal, update, ctx) => {
      try {
        const result = await run(id, args, signal, update, ctx);
        render();
        return result;
      } catch (error) {
        const message = redact(error instanceof Error ? error.message : String(error));
        binding.publish("control_error", { tool: tool.name, message });
        return { content: [{ type: "text", text: message }], details: { error: message }, isError: true };
      }
    };
    tools.push(tool); pi.registerTool(tool);
  };
  add({ name: "loop_obligations", label: "Original obligations", description: "Preserve a revisable interpretation of all original requirements. Every quote must occur in the original/amended user artifact; this does not replace the original request.",
    parameters: Type.Object({ obligations: Type.Array(Type.Object({ id: stableId, description: Type.String({ minLength: 1, maxLength: 2000 }), source: stableId, quote: Type.String({ minLength: 1, maxLength: 12000 }) }), { minItems: 1, maxItems: 128 }) }),
    execute: async (_id, args) => object(control.setObligations(args.obligations)) });
  add({ name: "loop_define", label: "Revise work dependencies", description: "Define or revise typed, meaningful bounded tasks. Dependencies require explicit admission; changing a node invalidates only its descendant closure. Execution uses native Pi subagents, not a second agent framework.",
    parameters: Type.Object({ nodes: Type.Array(Type.Object({ id: stableId, pool: Type.Union([Type.Literal("gemini"), Type.Literal("flash")]),
      kind: Type.Union([Type.Literal("inspect"), Type.Literal("patch")]), task: Type.String({ minLength: 1, maxLength: 24000 }),
      dependsOn: ids, scope: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { maxItems: 80 }), obligations: ids,
      alternativeGroup: Type.Optional(stableId), repl: Type.Optional(Type.Boolean()) }), { minItems: 1, maxItems: 100 }) }),
    execute: async (_id, args) => object(await control.define(args.nodes)) });
  add({ name: "loop_dispatch", label: "Dispatch ready native work", description: "Start explicitly ready nodes asynchronously within the separate Gemini/Flash capacity limits. Initial Gemini fan-out requires at least 10 meaningful contracts. Returned launch receipts are not task success.",
    parameters: Type.Object({ ids }), execute: async (_id, args) => object(await control.dispatch(args.ids)) });
  add({ name: "loop_status", label: "Task and native-run status", description: "Inspect native-settled, returned, admitted and stale states; configured capacity is not a claim that every slot is issuing a model request. Pagination includes full node contracts.",
    parameters: Type.Object({ offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })) }),
    execute: async (_id, args) => object({ state: control.projection(), nodes: await control.inspectNodes(args.offset, args.limit) }) });
  add({ name: "loop_wait", label: "Wait for useful native results", description: "Wait up to 30 seconds for a returned/error node, without interpreting its report as verified evidence. Native completion notifications also wake the owner.",
    parameters: Type.Object({ ids: Type.Optional(ids), milliseconds: Type.Optional(Type.Integer({ minimum: 100, maximum: 30000 })) }),
    execute: async (_id, args) => object(await control.wait(args.ids, args.milliseconds)) });
  add({ name: "loop_observe", label: "Record a source observation", description: "Read exact candidate file bytes and record input identity. target is origin, a returned/admitted node ID, or stage. Supports a real intra-file cursor; source observations do not make arbitrary interpretations true.",
    parameters: Type.Object({ target: stableId, path: Type.String({ minLength: 1, maxLength: 2000 }), offset: Type.Optional(Type.Integer({ minimum: 0 })), length: Type.Optional(Type.Integer({ minimum: 1, maximum: 48000 })), query: Type.Optional(Type.String({ maxLength: 500 })) }),
    execute: async (_id, args) => object(await control.readObservation(args)) });
  add({ name: "loop_check", label: "Independent candidate verification", description: "Execute the exact protected script on read-only candidate source with private generated outputs. target is a returned/admitted node or stage. Differential reproduction requires successful preflight and an expected failure marker. Captures real stdout/exit and rejects changed input/environment.",
    parameters: Type.Object({ target: stableId, description: text, script: Type.String({ minLength: 1, maxLength: 64000 }), preflight: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
      expectBaselineFailure: Type.Optional(Type.Boolean()), baselineFailureMarker: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
      outputDirectories: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { maxItems: 24 })) }),
    execute: async (_id, args, signal) => { const { target, ...spec } = args; return object(await control.check(target, spec, signal)); } });
  add({ name: "loop_admit", label: "Admit a bounded premise", description: "Owner adjudication of a returned result against current host observation IDs. supported patches require an independent passing command. hypothesis remains explicitly provisional and cannot certify final delivery.",
    parameters: Type.Object({ id: stableId, level: Type.Union([Type.Literal("supported"), Type.Literal("hypothesis")]), evidence: ids, rationale: Type.String({ minLength: 40, maxLength: 16000 }) }),
    execute: async (_id, args) => object(control.admit(args.id, args.level, args.evidence, args.rationale)) });
  add({ name: "loop_reject", label: "Reject and invalidate dependents", description: "Reject a result and invalidate only its declared descendant closure. Stops owned stale runs and preserves independent work and original history.",
    parameters: Type.Object({ id: stableId, reason: text }), execute: async (_id, args) => object(await control.reject(args.id, args.reason)) });
  add({ name: "loop_stage", label: "Assemble an exact candidate", description: "Assemble selected admitted patch nodes and their declared predecessors. Competing alternatives are not merged; incompatible file preimages are rejected. Empty selection permits legitimate no-op/diagnostic delivery.",
    parameters: Type.Object({ ids }), execute: async (_id, args) => object(control.stage(args.ids)) });
  add({ name: "loop_select", label: "Flash comparative selection", description: "Use a Flash node to compare 2-20 returned alternatives, recommend a candidate/new synthesis, or abstain. This advisory operator does not admit a premise or certify an implementation.",
    parameters: Type.Object({ ids: Type.Array(stableId, { minItems: 2, maxItems: 20 }), question: text }), execute: async (_id, args) => object(await control.select(args.ids, args.question)) });
  add({ name: "loop_review", label: "Independent Flash stage review", description: "Request 1-8 separately bounded Flash criteria on the actual stage, original request and independent command evidence. No executor confidence story is provided. Malformed/unknown results are not passes; concrete concerns remain unresolved until explicitly adjudicated.",
    parameters: Type.Object({ criteria: Type.Array(Type.String({ minLength: 1, maxLength: 3000 }), { minItems: 1, maxItems: 8 }) }), execute: async (_id, args) => object(await control.review(args.criteria)) });
  add({ name: "loop_counterexample", label: "Retain unresolved counterevidence", description: "Retain a decision-relevant contradiction or counterexample without an age-based eviction rule. Evidence values are artifact IDs.",
    parameters: Type.Object({ description: text, evidence: ids }), execute: async (_id, args) => object(control.counterexample(args.description, args.evidence)) });
  add({ name: "loop_resolve", label: "Resolve a counterexample", description: "Resolve a retained concern only with current passing stage command observations and a substantive causal explanation. The evidence remains in native history.",
    parameters: Type.Object({ id: stableId, checks: ids, explanation: Type.String({ minLength: 60, maxLength: 12000 }) }), execute: async (_id, args) => object(control.resolveCounterexample(args.id, args.checks, args.explanation)) });
  add({ name: "loop_finish", label: "Current-evidence final acceptance", description: "Finish only after every original obligation is mapped to current stage observations, executable checks and independent Flash review support the exact stage, and no provisional dependency/counterexample/unsettled native job remains. Exports an exact patch, never silently modifies the user's source.",
    parameters: Type.Object({ coverage: Type.Array(Type.Object({ obligationId: stableId, evidence: ids, explanation: Type.String({ minLength: 40, maxLength: 6000 }) }), { minItems: 1, maxItems: 128 }), conclusion: Type.String({ minLength: 80, maxLength: 24000 }) }),
    execute: async (_id, args) => {
      const result = control.finish(args.coverage, args.conclusion);
      pi.sendMessage({ customType: "loop-delivery", display: true, content: args.conclusion, details: result }, { triggerTurn: false });
      return object(result);
    } });
  add({ name: "loop_evidence", label: "Read exact evidence", description: "Read recorded evidence by immutable artifact ID with character offsets and literal search. Full originals are recoverable even when one long JSON line exceeds a context preview.",
    parameters: Type.Object({ id: stableId, offset: Type.Optional(Type.Integer({ minimum: 0 })), length: Type.Optional(Type.Integer({ minimum: 1, maximum: 48000 })), query: Type.Optional(Type.String({ maxLength: 500 })) }),
    execute: async (_id, args) => object(control.evidence(args.id, args.offset, args.length, args.query)) });
  add({ name: "loop_history", label: "Search native session history", description: "Search native Pi entries or read an exact entry ID by intra-entry character cursor. Raw tool results, earlier control projections and omitted previews stay recoverable; no second transcript store exists.",
    parameters: Type.Object({ id: Type.Optional(stableId), offset: Type.Optional(Type.Integer({ minimum: 0 })), length: Type.Optional(Type.Integer({ minimum: 1, maximum: 48000 })), query: Type.Optional(Type.String({ maxLength: 500 })), before: Type.Optional(stableId), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })) }),
    execute: async (_id, args) => object(control.history(args)) });
  add({ name: "loop_block", label: "Report a real blocker", description: "Stop truthfully as blocked, preserving artifacts and unresolved obligations. Provider/setup failure, insufficient information and unresolved contradictions are not task success.",
    parameters: Type.Object({ reason: Type.String({ minLength: 10, maxLength: 6000 }) }), execute: async (_id, args) => object(control.block(args.reason)) });

  const active = ["read", "bash", "grep", "find", "ls", ...(binding.cfg.python.enabled ? ["execute"] : []), ...tools.map(tool => tool.name)];
  const render = (): void => {
    if (!context) return;
    const state = control.state, nodes = Object.values(state?.nodes ?? {});
    context.ui.setStatus("pi-agent-loop", state ? `${state.status} | ${nodes.filter(n => n.status === "admitted").length}/${nodes.length} admitted | r${state.revision}` : "Pi Agent Loop ready");
    context.ui.setWidget("pi-agent-loop", state ? [
      `Task ${state.id.slice(0, 8)} | ${state.status} | revision ${state.revision} | generation ${state.generation}`,
      `GLM owner 1 | Gemini capacity ${binding.cfg.concurrency.gemini} | Flash capacity ${binding.cfg.concurrency.flash}`,
      `Active ${nodes.filter(n => n.status === "running" || n.status === "starting").length} | Returned ${nodes.filter(n => n.status === "returned").length} | Admitted ${nodes.filter(n => n.status === "admitted").length} | Unresolved ${state.unresolved.length}`,
      state.reason ?? "Use /loop-status, /loop-pause, /loop-resume, /loop-cancel. Native settled is not verified task success.",
      ...(state.delivery ? [`Delivery ${state.delivery.id}; /loop-delivery shows the exact patch and acceptance receipt.`] : []),
    ] : ["Submit a task. Original source is preserved; native worktrees carry parallel edits."]);
  };
  pi.on("session_start", async (_event, ctx) => {
    context = ctx; binding.ready = false;
    try { await control.attach(); pi.setActiveTools(active); binding.ready = true; render(); }
    catch (error) { binding.initializationError = redact(error instanceof Error ? error.message : String(error)); binding.publish("initialization_error", { error: binding.initializationError }); }
  });
  pi.on("before_agent_start", event => ({ systemPrompt: `${event.systemPrompt}\n\n${OPERATING_POLICY}` }));
  pi.on("context", event => ({ messages: [...event.messages.map(message => {
    if (message.role === "custom" && (message as any).customType === "subagent-notify") return { ...message, content: "NATIVE CHILD STATUS NOTIFICATION: results are available. Read loop_status, then inspect exact evidence; the native message is not an admission or completion certificate." };
    return message;
  }), { role: "user" as const, content: `HOST CURRENT-STATE PROJECTION (not a new user request):\n${JSON.stringify(control.projection())}`, timestamp: Date.now() }] }));
  pi.on("message_end", event => {
    if (event.message.role === "assistant") control.ownerUsage(event.message.usage);
  });
  pi.on("agent_settled", () => {
    render();
    if (!binding.ready || control.state?.status !== "running") return;
    const last = [...(binding.session?.state.messages ?? [])].reverse().find(message => message.role === "assistant") as any;
    if (last?.stopReason === "error") { control.block(`Owner provider failed after native retries: ${redact(last.errorMessage ?? "unknown provider failure")}`); render(); return; }
    if (control.shouldContinue()) pi.sendMessage({ customType: "loop-continuation", content: "Continue the same task from current host state. Choose a decision-relevant observation/operator, inspect a returned result, or report a concrete blocker. Prose completion is not acceptance.", display: false }, { triggerTurn: true, deliverAs: "followUp" });
  });
  pi.on("tool_call", event => {
    if (!binding.ready || !active.includes(event.toolName)) return { block: true, reason: "Use the current Pi Agent Loop tool contract; direct delegation/model switching bypasses task binding." };
    return undefined;
  });
  pi.on("session_before_tree", () => ({ cancel: true }));
  pi.on("session_shutdown", async () => { binding.ready = false; await control.dispose(); await python.dispose(); context = undefined; });
  pi.registerCommand("loop-status", { description: "Show authoritative task state and native settlement", handler: async (_args, ctx) => {
    await control.refresh(); render(); pi.sendMessage({ customType: "loop-status", display: true, content: JSON.stringify(control.projection(), null, 2) }, { triggerTurn: false });
  } });
  for (const [name, status] of [["loop-pause", "paused"], ["loop-cancel", "cancelled"]] as const) pi.registerCommand(name, {
    description: `${status === "paused" ? "Pause" : "Cancel"} the task and settle owned native children`, handler: async (_args, ctx) => {
      await control.stop(status, `Explicit /${name}`); render(); ctx.ui.notify(`Task ${status}; late results cannot revive it.`, "info");
    },
  });
  pi.registerCommand("loop-resume", { description: "Reconcile native jobs and explicitly resume the existing task", handler: async () => {
    await control.resume(); render(); pi.sendMessage({ customType: "loop-resume", display: true, content: "Explicitly resume the existing task; reobserve any stale state and reverify before final acceptance." }, { triggerTurn: true, deliverAs: "followUp" });
  } });
  pi.registerCommand("loop-delivery", { description: "Show exact verified-candidate patch and receipt locations", handler: async () => {
    const state = control.state;
    if (!state?.delivery || !state.finalReceipt) throw new Error("No accepted delivery exists");
    pi.sendMessage({ customType: "loop-delivery", display: true, content: JSON.stringify({ patch: binding.store.path(state.delivery), receipt: binding.store.path(state.finalReceipt), sourceUnchanged: true }, null, 2) }, { triggerTurn: false });
  } });
}

export default function (_pi: ExtensionAPI): void {
  throw new Error("Use the pi-agent-loop launcher: it establishes the pinned native runtime, durable profile, original workspace and single-owner lease before loading this extension.");
}
