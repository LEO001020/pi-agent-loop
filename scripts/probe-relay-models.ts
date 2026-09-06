import { loadConfig, credentials, redact } from "../src/config.ts";
const cfg = loadConfig(undefined, { credentialsFile: "/workspace/.credentials/credentials.json" });
const endpoints = credentials(cfg);
// Read-only discovery on the already authorized GLM relay. No alternate
// provider or model is invoked or silently substituted by this probe.
try {
  const response = await fetch(`${endpoints.glm}/models`, { headers: { Authorization: `Bearer ${process.env.PI_LOOP_GLM_KEY}` }, signal: AbortSignal.timeout(15000) });
  const body = await response.json() as any;
  console.log(JSON.stringify({ status: response.status, modelIds: Array.isArray(body.data) ? body.data.slice(0, 200).map((item: any) => item.id) : undefined,
    error: !response.ok ? redact(JSON.stringify(body)).slice(0, 1000) : undefined }));
} catch (error) { console.log(JSON.stringify({ error: redact(error instanceof Error ? error.message : String(error)) })); process.exitCode = 1; }
