import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { join } from "node:path";
import { credentials, loadConfig, prepareNativeConfig, redact } from "../src/config.ts";
import { privateDir } from "../src/io.ts";

const cfg = loadConfig(undefined, { credentialsFile: "/workspace/.credentials/credentials.json", home: "/workspace/live-seams" });
privateDir(cfg.home);
const release = await lockfile.lock(cfg.home, { lockfilePath: join(cfg.home, "owner.lock"), retries: 0 });
try {
  const endpoints = credentials(cfg);
  const agentDir = prepareNativeConfig(cfg, endpoints);
  const runtime = await ModelRuntime.create({ modelsPath: join(agentDir, "models.json"), authPath: join(agentDir, "auth.json"), allowModelNetwork: false });
  console.log(JSON.stringify({ node: process.version, platform: process.platform, endpoints, pricing: "UNKNOWN_UNLESS_CONFIGURED" }));
  for (const role of ["owner", "gemini", "flash"] as const) {
    const preset = cfg[role];
    const model = runtime.getModel(preset.provider, preset.model);
    if (!model) throw new Error(`Model unavailable: ${role}: ${runtime.getError()}`);
    const t = Date.now();
    const reply = await runtime.completeSimple(model, {
      systemPrompt: "Transport test. Reply exactly PI_LOOP_OK.", messages: [{ role: "user", content: "Reply PI_LOOP_OK", timestamp: Date.now() }],
    }, { maxTokens: 256, signal: AbortSignal.timeout(90000) });
    const text = reply.content.filter(x => x.type === "text").map(x => x.text).join("");
    const ok = reply.stopReason === "stop" && text.includes("PI_LOOP_OK");
    console.log(redact(JSON.stringify({ role, model: model.id, api: model.api, ok, durationMs: Date.now() - t, text, error: reply.errorMessage, usage: reply.usage })));
    if (!ok) process.exitCode = 1;
  }
} finally { await release(); }
