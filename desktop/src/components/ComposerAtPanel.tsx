/**
 * `@` reference picker — surfaces project files/folders (and native
 * attach-file / attach-folder escape hatches) so the user can drop an object
 * into the composer as an attachment. Keyboard navigation is driven by the
 * host (the composer owns the caret), so this panel is a pure view over the
 * shared `items` array — render and highlight can never desync.
 */

import {
  useEffect,
  useRef,
  type CSSProperties,
  type Ref,
} from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import {
  IconAttach,
  IconFileText,
  IconFolder,
  IconFolderPlus,
  IconSearch,
} from "@/components/icons";

const ICON_SIZE = 16;

export type AtItem =
  | { id: string; kind: "attach-file" }
  | { id: string; kind: "attach-folder" }
  | {
      id: string;
      kind: "file";
      name: string;
      relativePath: string;
      isDir: boolean;
    };

export interface ComposerAtLabels {
  search: string;
  attachFile: string;
  attachFolder: string;
  empty: string;
  noProject: string;
  loading: string;
}

export function ComposerAtPanel({
  open,
  locale,
  style,
  panelRef,
  items,
  query,
  projectPath,
  loading,
  activeIndex,
  onActiveIndexChange,
  onPick,
  labels,
}: {
  open: boolean;
  locale: Locale;
  style?: CSSProperties;
  panelRef?: Ref<HTMLDivElement | null>;
  /** Sole navigable list — same array the host walks with the keyboard. */
  items: AtItem[];
  /** Live `@` query (mirrored into the search bar, not editable here). */
  query: string;
  /** Active project path; null → no project listing, hint instead. */
  projectPath: string | null;
  loading?: boolean;
  activeIndex: number;
  onActiveIndexChange: (i: number) => void;
  onPick: (item: AtItem) => void;
  labels: ComposerAtLabels;
}) {
  const tr = createT(locale);
  const listRef = useRef<HTMLDivElement | null>(null);

  const setRefs = (node: HTMLDivElement | null) => {
    listRef.current = node;
    if (typeof panelRef === "function") panelRef(node);
    else if (panelRef && "current" in panelRef) {
      (panelRef as { current: HTMLDivElement | null }).current = node;
    }
  };

  // Keep the highlighted row in view as the user arrows through the list.
  useEffect(() => {
    if (!open) return;
    const panel = listRef.current;
    if (!panel) return;
    const el = panel.querySelector<HTMLElement>(
      `[data-at-idx="${activeIndex}"]`,
    );
    if (!el) return;
    const pRect = panel.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (eRect.top < pRect.top) panel.scrollTop -= pRect.top - eRect.top;
    else if (eRect.bottom > pRect.bottom)
      panel.scrollTop += eRect.bottom - pRect.bottom;
  }, [activeIndex, open, items.length]);

  if (!open) return null;

  const q = (query ?? "").trim();
  const fileCount = items.reduce(
    (n, i) => (i.kind === "file" ? n + 1 : n),
    0,
  );
  const firstFileIdx = items.findIndex((i) => i.kind === "file");
  const showLoading = !!loading && fileCount === 0 && !!projectPath;
  const showEmpty = !loading && fileCount === 0 && !!projectPath;
  const showNoProject = !projectPath;

  return (
    <div
      ref={setRefs}
      className="menu-panel composer-plus composer-plus--portal composer-at"
      role="listbox"
      aria-activedescendant={
        items[activeIndex] ? `at-opt-${activeIndex}` : undefined
      }
      data-filter-query={q}
      style={style}
    >
      <div className="composer-plus__search" aria-hidden>
        <span className="composer-plus__search-ico" aria-hidden>
          <IconSearch size={ICON_SIZE} />
        </span>
        {q ? (
          <span className="composer-plus__search-q">{q}</span>
        ) : (
          <span className="composer-plus__search-ph">{labels.search}</span>
        )}
        {q ? (
          <>
            <span className="composer-plus__search-caret" aria-hidden />
            <span className="composer-plus__search-count">{fileCount}</span>
          </>
        ) : null}
      </div>

      {items.map((item, idx) => {
        const active = idx === activeIndex;
        const divider =
          idx === firstFileIdx && firstFileIdx > 0 ? (
            <div
              key="at-divider"
              className="composer-plus__divider"
              role="separator"
            />
          ) : null;

        let icon: React.ReactNode;
        let title: string;
        let desc = "";
        if (item.kind === "attach-file") {
          icon = <IconAttach size={ICON_SIZE} />;
          title = labels.attachFile;
        } else if (item.kind === "attach-folder") {
          icon = <IconFolderPlus size={ICON_SIZE} />;
          title = labels.attachFolder;
        } else {
          icon = item.isDir ? (
            <IconFolder size={ICON_SIZE} />
          ) : (
            <IconFileText size={ICON_SIZE} />
          );
          title = item.name;
          desc =
            item.relativePath && item.relativePath !== item.name
              ? item.relativePath
              : "";
        }

        return (
          <div key={item.id} className="composer-at__rowwrap">
            {divider}
            <button
              type="button"
              id={`at-opt-${idx}`}
              role="option"
              aria-selected={active}
              data-at-idx={idx}
              className={
                "composer-plus__item" + (active ? " is-active" : "")
              }
              onMouseEnter={() => onActiveIndexChange(idx)}
              onClick={() => onPick(item)}
            >
              <span className="composer-plus__ico" aria-hidden>
                {icon}
              </span>
              <span className="composer-plus__title">{title}</span>
              {desc ? (
                <span className="composer-plus__desc">{desc}</span>
              ) : null}
            </button>
          </div>
        );
      })}

      {showLoading ? (
        <div className="composer-plus__item composer-plus__item--muted" aria-busy>
          <span className="composer-plus__ico" aria-hidden>
            <IconFolder size={ICON_SIZE} />
          </span>
          <span className="composer-plus__title">{labels.loading}</span>
        </div>
      ) : null}

      {showEmpty ? (
        <div className="composer-plus__item composer-plus__item--muted">
          <span className="composer-plus__title">
            {q ? tr("slash.empty") : labels.empty}
          </span>
        </div>
      ) : null}

      {showNoProject ? (
        <div className="composer-plus__item composer-plus__item--muted">
          <span className="composer-plus__title">{labels.noProject}</span>
        </div>
      ) : null}
    </div>
  );
}
