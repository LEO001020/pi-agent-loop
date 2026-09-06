export type PiExtensionUiMethod =
  | "notify"
  | "setStatus"
  | "setWidget"
  | "setTitle"
  | "set_editor_text";

export interface PiExtensionUiPayload {
  sessionId?: string;
  method?: PiExtensionUiMethod | string;
  message?: string;
  notifyType?: "info" | "warning" | "error" | string;
  statusKey?: string;
  statusText?: string | null;
  widgetKey?: string;
  widgetLines?: unknown;
  widgetPlacement?: "aboveEditor" | "belowEditor" | string;
  title?: string;
  text?: string;
}

export interface PiExtensionWidget {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

export interface PiExtensionSessionUi {
  statuses: Record<string, string>;
  widgets: Record<string, PiExtensionWidget>;
  title: string | null;
}

export const EMPTY_PI_EXTENSION_UI: PiExtensionSessionUi = {
  statuses: {},
  widgets: {},
  title: null,
};

function cleanText(value: unknown, limit: number): string {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").trim().slice(0, limit)
    : "";
}

export function reducePiExtensionUi(
  current: PiExtensionSessionUi,
  event: PiExtensionUiPayload,
): PiExtensionSessionUi {
  switch (event.method) {
    case "setStatus": {
      const key = cleanText(event.statusKey, 120) || "extension";
      const text = cleanText(event.statusText, 240);
      const statuses = { ...current.statuses };
      if (text) statuses[key] = text;
      else delete statuses[key];
      return { ...current, statuses };
    }
    case "setWidget": {
      const key = cleanText(event.widgetKey, 120) || "extension";
      const widgets = { ...current.widgets };
      const lines = Array.isArray(event.widgetLines)
        ? event.widgetLines
            .filter((line): line is string => typeof line === "string")
            .slice(0, 24)
            .map((line) => line.replace(/\u0000/g, "").slice(0, 500))
        : [];
      if (lines.length) {
        widgets[key] = {
          key,
          lines,
          placement:
            event.widgetPlacement === "belowEditor"
              ? "belowEditor"
              : "aboveEditor",
        };
      } else {
        delete widgets[key];
      }
      return { ...current, widgets };
    }
    case "setTitle":
      return { ...current, title: cleanText(event.title, 180) || null };
    default:
      return current;
  }
}

export function piExtensionWidgetsAt(
  state: PiExtensionSessionUi,
  placement: PiExtensionWidget["placement"],
): PiExtensionWidget[] {
  return Object.values(state.widgets).filter(
    (widget) => widget.placement === placement,
  );
}
