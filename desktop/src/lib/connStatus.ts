/** Connection status pill labels derived from session FSM state. */

export type ConnPhase =
  | "idle"
  | "connecting"
  | "ready"
  | "streaming"
  | "awaiting_permission"
  | "disconnected"
  | string;

export type ConnPill = {
  /** CSS modifier: ok | warn | err | muted */
  tone: "ok" | "warn" | "err" | "muted";
  /** i18n key under conn.* */
  labelKey: string;
};

export function connPillForState(state: ConnPhase, connecting?: boolean): ConnPill {
  if (connecting || state === "connecting") {
    return { tone: "warn", labelKey: "conn.connecting" };
  }
  switch (state) {
    case "ready":
      return { tone: "ok", labelKey: "conn.ready" };
    case "streaming":
      return { tone: "ok", labelKey: "conn.streaming" };
    case "awaiting_permission":
      return { tone: "warn", labelKey: "conn.permission" };
    case "disconnected":
      return { tone: "err", labelKey: "conn.disconnected" };
    case "idle":
    default:
      return { tone: "muted", labelKey: "conn.idle" };
  }
}
