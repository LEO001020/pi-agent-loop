import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { credentials, loadConfig, redact } from "../src/config.ts";

const cfg = loadConfig(undefined, { credentialsFile: "/workspace/.credentials/credentials.json" });
credentials(cfg);
for (const hostname of ["127.0.0.1", "host.docker.internal", "172.17.0.1"]) {
  console.log(JSON.stringify({ hostname, dns: await dns.lookup(hostname, { all: true }).catch(error => ({ error: error.message })) }));
  for (const protocol of ["http:", "https:"]) {
    const result = await new Promise<Record<string, unknown>>(resolve => {
      const start = Date.now();
      const req = (protocol === "http:" ? http : https).request({ hostname, port: 8045, path: "/v1/models", method: "GET", timeout: 5000,
        headers: { Authorization: `Bearer ${process.env.PI_LOOP_GEMINI_KEY}`, Accept: "application/json", Connection: "close" } }, response => {
        let preview = "";
        response.on("data", chunk => { if (preview.length < 4000) preview += chunk.toString(); });
        response.on("end", () => resolve({ hostname, protocol, status: response.statusCode, preview: redact(preview.slice(0, 4000)), durationMs: Date.now() - start }));
      });
      req.on("timeout", () => req.destroy(new Error("request timeout")));
      req.on("error", error => resolve({ hostname, protocol, error: error.message, durationMs: Date.now() - start }));
      req.end();
    });
    console.log(JSON.stringify(result));
  }
}
