/**
 * Workspace switcher — the icons at the foot of the sidebar, above the
 * profile row.
 *
 * Presentational only: it renders the workspaces it is given and reports
 * clicks. Persistence and the meaning of each workspace live in
 * `src/lib/workspace.ts` and `App.tsx`.
 */

import {
  IconWorkspaceCode,
  IconWorkspacePr,
} from "@/components/icons";
import { WORKSPACES, type WorkspaceId } from "@/lib/workspace";

const ICONS: Record<
  WorkspaceId,
  (props: { size?: number }) => React.ReactElement
> = {
  code: IconWorkspaceCode,
  pr: IconWorkspacePr,
};

export function WorkspaceSwitcher({
  active,
  onSelect,
  labels,
  comingSoonSuffix,
}: {
  active: WorkspaceId;
  onSelect: (id: WorkspaceId) => void;
  /** Tooltip / aria label per workspace id. */
  labels: Record<WorkspaceId, string>;
  /** Appended to the label of a workspace that is not built yet. */
  comingSoonSuffix: string;
}) {
  return (
    <div
      className="ws-switch"
      role="tablist"
      aria-orientation="horizontal"
      aria-label={labels[active]}
    >
      {WORKSPACES.map((w) => {
        const Icon = ICONS[w.id];
        const isActive = w.id === active;
        const label = w.comingSoon
          ? `${labels[w.id]} · ${comingSoonSuffix}`
          : labels[w.id];
        return (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            // Only the active tab is reachable by Tab; arrows move within.
            tabIndex={isActive ? 0 : -1}
            className={
              "ws-switch__btn" +
              (isActive ? " ws-switch__btn--active" : "") +
              (w.comingSoon ? " ws-switch__btn--soon" : "")
            }
            title={label}
            aria-label={label}
            onClick={() => onSelect(w.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = WORKSPACES.findIndex((x) => x.id === active);
              const delta = e.key === "ArrowRight" ? 1 : -1;
              const next =
                WORKSPACES[(i + delta + WORKSPACES.length) % WORKSPACES.length]!;
              onSelect(next.id);
            }}
          >
            <Icon size={17} />
          </button>
        );
      })}
    </div>
  );
}
