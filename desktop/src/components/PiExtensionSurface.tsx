import type {
  PiExtensionSessionUi,
  PiExtensionWidget,
} from "@/lib/piExtensionUi";

export function PiExtensionWidgets({
  widgets,
  label,
}: {
  widgets: PiExtensionWidget[];
  label: string;
}) {
  if (!widgets.length) return null;
  return (
    <div className="pi-ext-widgets" aria-label={label}>
      {widgets.map((widget) => (
        <div className="pi-ext-widget" key={widget.key} role="note">
          {widget.lines.map((line, index) => (
            <div className="pi-ext-widget__line" key={`${widget.key}-${index}`}>
              {line || "\u00a0"}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function PiExtensionStatus({
  state,
  label,
}: {
  state: PiExtensionSessionUi;
  label: string;
}) {
  const entries = Object.entries(state.statuses);
  if (!entries.length) return null;
  return (
    <div className="pi-ext-status" role="status" aria-label={label}>
      {entries.map(([key, text]) => (
        <span className="pi-ext-status__entry" key={key} title={key}>
          {text}
        </span>
      ))}
    </div>
  );
}
