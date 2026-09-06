import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type NativeMethod = "ping" | "spawn" | "status" | "steer" | "interrupt" | "stop" | "resume";
export interface NativeReply { text?: string; details?: Record<string, any>; fleet?: Record<string, any>; asyncSnapshot?: Record<string, any> }
export interface NativeLaunch { runId: string; asyncDir: string; details: Record<string, any> }
type EventBus = Pick<ExtensionAPI["events"], "on" | "emit">;

export class NativeRpcError extends Error {
  constructor(readonly code: string, message: string, readonly method: NativeMethod) {
    super(`NATIVE_${code}: ${message}`);
    this.name = "NativeRpcError";
  }
}

/** A transport client for the upstream public in-process RPC. It never launches,
 * schedules, kills, or recreates child agents. A timeout on spawn is ambiguous:
 * the caller must reconcile upstream state, not blindly retry the request. */
export class NativeClient {
  constructor(readonly events: EventBus) {}
  request<T = NativeReply>(method: NativeMethod, params: unknown = {}, timeoutMs = 60000): Promise<T> {
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: T): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error); else resolve(value as T);
      };
      const unsubscribe = this.events.on(`subagents:rpc:v1:reply:${requestId}`, (raw: unknown) => {
        if (!raw || typeof raw !== "object") return;
        const reply = raw as Record<string, any>;
        if (reply.requestId !== requestId) return;
        if (reply.version !== 1 || typeof reply.success !== "boolean") return finish(new Error("NATIVE_PROTOCOL_INVALID"));
        if (!reply.success) return finish(new NativeRpcError(reply.error?.code ?? "ERROR", reply.error?.message ?? "unknown error", method));
        finish(undefined, reply.data as T);
      });
      const timer = setTimeout(() => finish(new Error(`NATIVE_${method.toUpperCase()}_TIMEOUT: request=${requestId}; outcome unknown; reconcile before retry`)), timeoutMs);
      try { this.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method, params, source: { extension: "pi-agent-loop" } }); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  async capabilities(): Promise<Record<string, any>> {
    const ping = await this.request<Record<string, any>>("ping", {}, 10000);
    if (ping.version !== 1 || !ping.capabilities?.asyncSpawn || !ping.capabilities?.stop || !ping.capabilities?.resume) throw new Error("UNSUPPORTED_NATIVE_DELEGATION: public spawn/stop/resume required");
    return ping;
  }
  async spawn(params: Record<string, unknown>): Promise<NativeLaunch> {
    const data = await this.request("spawn", { ...params, async: true });
    const details = data.details;
    const runId = details?.runId ?? details?.asyncId;
    if (typeof runId !== "string" || !runId || typeof details?.asyncDir !== "string") throw new Error(`NATIVE_LAUNCH_IDENTITY_UNKNOWN: ${JSON.stringify(data)}`);
    return { runId, asyncDir: details.asyncDir, details };
  }
  status(runId?: string): Promise<NativeReply> { return this.request("status", runId ? { id: runId } : {}); }
  stop(runId: string): Promise<NativeReply> { return this.request("stop", { id: runId }); }
}

export function registerNativeAgent(pi: ExtensionAPI, name: string, definition: Record<string, unknown>): { dispose(): void } {
  const request: Record<string, any> = { version: 1, name, definition };
  pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
  if (!request.result?.ok || typeof request.result.registration?.dispose !== "function") throw request.result?.error ?? new Error(`NATIVE_AGENT_REGISTRATION_FAILED: ${name}`);
  return request.result.registration;
}
