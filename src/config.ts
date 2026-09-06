import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicJson, privateDir, readJson } from "./io.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = "0.1.0-rc.1";
export const HOST_KEY = Symbol.for("pi-agent-loop.host.v1");
export type Pool = "gemini" | "flash";
export interface ModelPreset {
  provider: string;
  model: string;
  thinking: "off" | "low" | "medium" | "high";
  contextWindow: number;
  maxTokens: number;
}
export interface Config {
  version: 1;
  home: string;
  credentialsFile: string;
  glmUrl?: string;
  geminiUrl?: string;
  owner: ModelPreset;
  gemini: ModelPreset;
  flash: ModelPreset;
  concurrency: { gemini: number; flash: number };
  budget: { tokens: number; seconds: number; nodes: number; childSeconds: number; childTools: number; checkSeconds: number };
  python: { enabled: boolean; executable: string; cellSeconds: number };
  sandbox: { landrun: string; network: boolean; readRoots: string[] };
  pricing: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
  importExcludes: string[];
}
export const DEFAULTS: Config = {
  version: 1,
  home: join(homedir(), ".local", "share", "pi-agent-loop"),
  credentialsFile: join(homedir(), ".config", "pi-agent-loop", "credentials.json"),
  owner: { provider: "loop-glm", model: "glm-5.3", thinking: "high", contextWindow: 128000, maxTokens: 16384 },
  gemini: { provider: "loop-gemini", model: "gemini-3.8-flash-high", thinking: "high", contextWindow: 128000, maxTokens: 8192 },
  flash: { provider: "loop-glm", model: "glm-5.3-flash", thinking: "low", contextWindow: 128000, maxTokens: 8192 },
  concurrency: { gemini: 12, flash: 3 },
  budget: { tokens: 2000000, seconds: 7200, nodes: 500, childSeconds: 900, childTools: 80, checkSeconds: 180 },
  python: { enabled: true, executable: process.platform === "win32" ? "python" : join(ROOT, "runtime", "python", "bin", "python3"), cellSeconds: 120 },
  sandbox: { landrun: join(ROOT, "runtime", "bin", "landrun"), network: true, readRoots: [] },
  pricing: {},
  importExcludes: [".env", ".env.local", ".env.production", ".credentials"],
};
const expand = (path: string): string => resolve(path.replace(/^~(?=\/|$)/, homedir()));
function integer(value: unknown, min: number, max: number, name: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be an integer in [${min}, ${max}]`);
}
export function loadConfig(path?: string, override: Partial<Config> = {}): Config {
  const file = path ?? process.env.PI_LOOP_CONFIG ?? join(homedir(), ".config", "pi-agent-loop", "config.json");
  if (path && !existsSync(expand(file))) throw new Error(`Configuration not found: ${file}`);
  const raw = existsSync(expand(file)) ? readJson<Partial<Config>>(expand(file)) : {};
  const cfg = { ...DEFAULTS, ...raw, ...override } as Config;
  for (const key of ["owner", "gemini", "flash", "concurrency", "budget", "python", "sandbox"] as const) {
    (cfg as unknown as Record<string, unknown>)[key] = { ...DEFAULTS[key], ...raw[key], ...override[key] };
  }
  if (cfg.version !== 1) throw new Error("Unsupported configuration version");
  cfg.home = expand(process.env.PI_LOOP_HOME ?? cfg.home);
  cfg.credentialsFile = expand(process.env.PI_LOOP_CREDENTIALS ?? cfg.credentialsFile);
  if (!process.platform.startsWith("win")) cfg.python.executable = expand(cfg.python.executable);
  cfg.sandbox.landrun = expand(cfg.sandbox.landrun);
  integer(cfg.concurrency.gemini, 10, 20, "concurrency.gemini");
  integer(cfg.concurrency.flash, 1, 8, "concurrency.flash");
  if (cfg.owner.model !== "glm-5.3" || cfg.flash.model !== "glm-5.3-flash" || !/^gemini-3\.8-flash(?:-high)?$/.test(cfg.gemini.model)) throw new Error("The specified three-model matrix is fixed");
  if (cfg.owner.provider !== cfg.flash.provider || cfg.gemini.provider === cfg.owner.provider) throw new Error("GLM and Gemini require separate provider bindings");
  for (const role of ["owner", "gemini", "flash"] as const) {
    const m = cfg[role];
    if (!/^[\w.-]+$/.test(m.provider) || !["off", "low", "medium", "high"].includes(m.thinking)) throw new Error(`Invalid ${role} preset`);
    integer(m.contextWindow, 8192, 2000000, `${role}.contextWindow`);
    integer(m.maxTokens, 128, m.contextWindow - 1024, `${role}.maxTokens`);
  }
  for (const [key, value] of Object.entries(cfg.budget)) integer(value, 1, 100000000, `budget.${key}`);
  integer(cfg.python.cellSeconds, 1, 3600, "python.cellSeconds");
  if (typeof cfg.python.enabled !== "boolean" || typeof cfg.sandbox.network !== "boolean") throw new Error("Invalid boolean configuration");
  if (!Array.isArray(cfg.sandbox.readRoots) || cfg.sandbox.readRoots.some(p => typeof p !== "string")) throw new Error("Invalid readRoots");
  cfg.sandbox.readRoots = cfg.sandbox.readRoots.map(p => realpathSync(expand(p)));
  if (!Array.isArray(cfg.importExcludes) || cfg.importExcludes.some(p => typeof p !== "string" || !p || p.includes("..") || p.includes("\\"))) throw new Error("Invalid import exclusions");
  for (const rate of Object.values(cfg.pricing)) for (const v of Object.values(rate)) if (!Number.isFinite(v) || v < 0) throw new Error("Invalid configured price");
  return cfg;
}

const secrets = new Set<string>();
export function redact(value: string): string {
  let text = value;
  for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
  return text;
}
export function containsCredential(bytes: string | Buffer): boolean {
  for (const secret of secrets) if (typeof bytes === "string" ? bytes.includes(secret) : bytes.includes(Buffer.from(secret))) return true;
  return false;
}
export interface Endpoints { glm: string; gemini: string; authenticated: boolean }
function validUrl(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("A provider base URL is required");
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error("Provider URL must not embed credentials, query or fragment");
  return raw.replace(/\/$/, "");
}
export function credentials(cfg: Config, required = true): Endpoints {
  let values: Record<string, any> = {};
  if (existsSync(cfg.credentialsFile)) {
    if (process.platform !== "win32" && (statSync(cfg.credentialsFile).mode & 0o077) !== 0) throw new Error("Credential file must have mode 0600");
    values = readJson(cfg.credentialsFile);
  }
  const gp = values.providers?.["zai-nanshan"] ?? values.glm ?? {};
  const ep = values.providers?.["local-8045-proxy"] ?? values.gemini ?? {};
  const glmKey = process.env.PI_LOOP_GLM_KEY ?? gp.api_key;
  const geminiKey = process.env.PI_LOOP_GEMINI_KEY ?? ep.api_key;
  for (const [key, name] of [[glmKey, "PI_LOOP_GLM_KEY"], [geminiKey, "PI_LOOP_GEMINI_KEY"]]) {
    if (typeof key === "string" && key.length >= 6) { secrets.add(key); process.env[name] = key; }
  }
  const authenticated = Boolean(glmKey && geminiKey);
  if (required && !authenticated) throw new Error(`BLOCKED_CREDENTIAL: ${cfg.credentialsFile}`);
  return {
    glm: validUrl(cfg.glmUrl ?? gp.base_url ?? "https://configure-glm.invalid/v1"),
    gemini: validUrl(process.env.PI_LOOP_GEMINI_URL ?? process.env.PI_LOOP_GEMINI_URL_FALLBACK ?? cfg.geminiUrl ?? ep.base_url ?? "http://192.168.3.2:18045/v1"),
    authenticated,
  };
}
export function prepareNativeConfig(cfg: Config, endpoints: Endpoints): string {
  const agentDir = privateDir(join(cfg.home, "agent"));
  const model = (p: ModelPreset) => ({ id: p.model, name: p.model, reasoning: true, input: ["text"], contextWindow: p.contextWindow, maxTokens: p.maxTokens,
    cost: cfg.pricing[p.model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  atomicJson(join(agentDir, "models.json"), { providers: {
    [cfg.owner.provider]: { baseUrl: endpoints.glm, api: "openai-responses", apiKey: "$PI_LOOP_GLM_KEY", compat: { supportsDeveloperRole: false }, models: [model(cfg.owner), model(cfg.flash)] },
    [cfg.gemini.provider]: { baseUrl: endpoints.gemini, api: "openai-completions", apiKey: "$PI_LOOP_GEMINI_KEY",
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStore: false }, models: [model(cfg.gemini)] },
  } });
  atomicJson(join(agentDir, "settings.json"), {
    defaultProvider: cfg.owner.provider, defaultModel: cfg.owner.model, defaultThinkingLevel: cfg.owner.thinking,
    compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 24000 },
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 1500, maxDelayMs: 15000 }, packages: [],
    subagents: { watchdog: { enabled: false, children: { enabled: false } } },
  });
  atomicJson(join(agentDir, "extensions", "subagent", "config.json"), {
    defaultSubagentContext: "fresh", asyncByDefault: true, globalConcurrencyLimit: cfg.concurrency.gemini,
    maxSubagentDepth: 1, maxSubagentSpawnsPerRun: cfg.budget.nodes, maxSubagentSpawnsPerSession: cfg.budget.nodes,
    maxActiveAsyncRunsPerSession: cfg.concurrency.gemini + cfg.concurrency.flash,
    capacity: { abandonedSlotReleaseAfterMs: false },
    timeoutMs: cfg.budget.childSeconds * 1000,
    worktreeProvider: "native", worktreeBaseDir: join(cfg.home, "worktrees"),
    toolDescriptionMode: "compact", resultDisplay: "summary", intercomBridge: { enabled: false },
  });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_LOOP_RUNTIME_CONFIG = JSON.stringify(cfg);
  // The upstream asynchronous control/artifact directory must survive a new
  // shell invocation and must not inherit an ephemeral MCP command TMPDIR.
  process.env.TMPDIR = privateDir(join(cfg.home, "native-tmp"));
  process.env.PI_LOOP_WORKTREE_POLICY = JSON.stringify({ worktreeRoot: join(cfg.home, "worktrees"), metadataRoots: [join(cfg.home, "projects"), join(cfg.home, "tasks")] });
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  return agentDir;
}
export function runtimeConfig(): Config {
  if (!process.env.PI_LOOP_RUNTIME_CONFIG) throw new Error("Use the pi-agent-loop launcher");
  return JSON.parse(process.env.PI_LOOP_RUNTIME_CONFIG) as Config;
}
