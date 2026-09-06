import { createConnection } from "node:net";
import { credentials, loadConfig } from "../src/config.ts";

const cfg = loadConfig(undefined, { credentialsFile: "/workspace/.credentials/credentials.json" });
const endpoints = credentials(cfg);
const target = new URL(endpoints.gemini);
// These are the three routes the user explicitly supplied for their own proxy.
for (const hostname of ["127.0.0.1", "host.docker.internal", "172.17.0.1"]) {
  const outcome = await new Promise<Record<string, unknown>>(resolve => {
    const socket = createConnection({ host: hostname, port: Number(target.port || 8045), timeout: 3000 });
    socket.once("connect", () => { resolve({ hostname, connected: true }); socket.destroy(); });
    socket.once("error", error => { resolve({ hostname, connected: false, error: error.message }); socket.destroy(); });
    socket.once("timeout", () => { resolve({ hostname, connected: false, error: "timeout" }); socket.destroy(); });
  });
  console.log(JSON.stringify(outcome));
}
