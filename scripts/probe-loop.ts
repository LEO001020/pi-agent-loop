import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.ts";
import { privateDir } from "../src/io.ts";
import { openLoop } from "../src/runtime.ts";

const caseId = randomUUID(), home = `/workspace/live-loop-smoke/${caseId}`;
const source = privateDir(`/workspace/live-loop-fixtures/${caseId}`);
const marker = `observed-${randomUUID()}`;
writeFileSync(join(source, "answer.txt"), `${marker}\n`);
const cfg = loadConfig(undefined, { home, credentialsFile: "/workspace/.credentials/credentials.json" });
cfg.budget.childSeconds = 90; cfg.budget.childTools = 15; cfg.budget.checkSeconds = 20;
console.log("OPEN_BEGIN", JSON.stringify({ home, source }));
const loop = await openLoop(cfg, { workspace: source });
console.log("OPEN_DONE");
try {
  await loop.bindHeadless();
  console.log("BIND_DONE");
  const control = loop.binding().controller!;
  // This is an API/lifecycle conformance test with real Flash children, not a
  // claim that a GLM owner autonomously chose these deterministic test actions.
  loop.runtime.session.agent.streamFunction = () => { throw new Error("CONFORMANCE_DRIVER: owner inference intentionally disabled"); };
  const nativeCustom = loop.runtime.session.sendCustomMessage.bind(loop.runtime.session);
  loop.runtime.session.sendCustomMessage = (message, options) => nativeCustom(message, { ...options, triggerTurn: false });
  const request = "Report the exact content of answer.txt without modifying the source directory.";
  control.input(request);
  control.setObligations([{ id: "exact", description: request, source: control.state!.original.id, quote: request }]);
  const sessionFile = loop.runtime.session.sessionFile!;
  assert.ok(readFileSync(sessionFile, "utf8").includes(control.state!.original.id));
  console.log("TASK_DURABLE_BEFORE_PROVIDER", JSON.stringify({ sessionFile, taskId: control.state!.id }));
  await control.define([{ id: "inspect", pool: "flash", kind: "inspect", dependsOn: [], scope: [], obligations: ["exact"], repl: false,
    task: "Use the actual read tool on answer.txt, then report the exact full content. Do not modify any file or run other work." }]);
  console.log("DISPATCH", JSON.stringify(await control.dispatch(["inspect"])));
  const wait = async (id: string) => {
    for (let n = 0; n < 150; n++) {
      await control.refresh();
      const node = control.state!.nodes[id];
      if (["returned", "failed", "rejected", "cancelled"].includes(node.status)) return node;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Native node did not settle: ${id}; ${JSON.stringify(control.projection())}`);
  };
  const node = await wait("inspect");
  console.log("RETURNED", JSON.stringify(node));
  assert.equal(node.status, "returned", node.reason);
  assert.ok(node.attempt?.report);
  assert.ok(loop.binding().store.text(node.attempt.report).includes(marker));
  const observed = await control.readObservation({ target: "inspect", path: "answer.txt" }) as any;
  console.log("SOURCE_OBSERVATION", JSON.stringify(observed));
  control.admit("inspect", "supported", [observed.observation.id], "The host independently read the exact candidate answer.txt bytes and they agree with this bounded read-only report, without promoting any wider correctness claim.");
  console.log("STAGE", JSON.stringify(control.stage(["inspect"])));
  const checked = await control.check("stage", { description: "The exact source value is unchanged", preflight: "test -f answer.txt",
    script: `python3 -c 'from pathlib import Path; assert Path("answer.txt").read_text() == ${JSON.stringify(marker + "\n")}'` }) as any;
  console.log("VERIFICATION", JSON.stringify(checked));
  assert.equal(checked.observation.passed, true);
  const review = await control.review(["Confirm the exact read-only answer requirement and that the independent command observes the actual candidate source without modification."]) as any;
  console.log("REVIEW_LAUNCH", JSON.stringify(review));
  for (const id of review.reviews) {
    const row = await wait(id); console.log("REVIEW_RETURN", JSON.stringify(row));
    assert.equal(row.status, "returned", row.reason);
    console.log("REVIEW_BODY", loop.binding().store.text(row.attempt!.report!));
  }
  const finish = control.finish([{ obligationId: "exact", evidence: [checked.observation.id],
    explanation: "The independent protected command opened answer.txt from the exact integrated read-only candidate and compared every byte, including its newline, to the test fixture's independently known content." }],
    `The exact observed answer is ${marker}. It was independently read and checked on the current candidate and reviewed by a real Flash child. The original directory remains unchanged; the empty delivery patch correctly represents this diagnostic task.`);
  assert.equal(control.state!.status, "complete");
  assert.equal(readFileSync(join(source, "answer.txt"), "utf8"), `${marker}\n`);
  console.log("FINAL_ACCEPTANCE", JSON.stringify(finish));
  console.log("QUALIFICATION", "This test used a deterministic owner-side conformance driver and real Flash providers. It is not a Gemini fan-out or autonomous GLM task-success claim.");
} finally { await loop.close(); }
