/**
 * Right resource pane — Codex-inspired workbench:
 * multi-tabs · breadcrumb toolbar · preview | file tree · open-with menu.
 * Original implementation for Pi (Tauri + React).
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";

/**
 * File previewers load on demand.
 *
 * These three pull in pdf.js, docx-preview, plyr and highlight.js — the
 * heaviest dependencies in the app, and none of them is needed until someone
 * opens a file of that kind. Keeping them out of the entry chunk is the
 * difference between paying for them at launch and paying when used.
 */
const FileMediaPlayer = lazy(() =>
  import("@/components/FileMediaPlayer").then((m) => ({
    default: m.FileMediaPlayer,
  })),
);
const OfficeDocumentPreview = lazy(() =>
  import("@/components/OfficeDocumentPreview").then((m) => ({
    default: m.OfficeDocumentPreview,
  })),
);
const CodePreview = lazy(() =>
  import("@/components/CodePreview").then((m) => ({ default: m.CodePreview })),
);
import { splitPrTitleAndBody } from "@/lib/ghReview";
import { createT, type Locale } from "@/i18n";
import { resolvePreviewSrc } from "@/lib/filePreviewSrc";
import { HtmlBrowser } from "@/components/HtmlBrowser";
import { EmbeddedBrowser } from "@/components/EmbeddedBrowser";
import { MarkdownBody } from "@/components/MarkdownBody";
import { OverlayScroll } from "@/components/OverlayScroll";
import { ImageUi } from "@/components/ImageUi";
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconCopy,
  IconExternalLink,
  IconFileDiff,
  IconFileText,
  IconFolder,
  IconFiles,
  IconPlan,
  IconArrowBackUp,
  IconCheck,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTerminal,
  IconUpload,
  IconWorld,
} from "@/components/icons";
import { PlanReviewPanel } from "@/components/PlanReviewPanel";
import type { PlanReviewState } from "@/lib/planBody";
import { isOfficeKind } from "@/lib/filePreviewSrc";
import { OpenLocationButton } from "@/components/OpenLocationButton";
import { Tip } from "@/components/ui/tooltip";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { GlassModal } from "@/components/GlassModal";
import type { MessageKey } from "@/i18n";
import {
  buildUnifiedDiff,
  normalizePath,
  pathBaseName,
  pathRelativeToProject,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import {
  buildWorkspaceStatusMap,
  canDiscardWorkspaceEntry,
  filterWorkspaceGitEntries,
  isWorkspaceStaged,
  normalizeWorkspaceGitEntries,
  resolveWorkspaceAbsolutePath,
  splitDiscardPaths,
  workspaceGitKindBadge,
  workspaceGitKindMessageKey,
  type WorkspaceGitFile,
} from "@/lib/workspaceGit";
import {
  defaultResourceEditMode,
  isFsWriteConflict,
  isResourceDraftDirty,
  isResourceTextEditable,
} from "@/lib/resourceEdit";

const EmbeddedTerminal = lazy(() =>
  import("@/components/EmbeddedTerminal").then((module) => ({
    default: module.EmbeddedTerminal,
  })),
);

const TREE_WIDTH_KEY = "pi-app.resourceTreeWidth";
const TREE_WIDTH_DEFAULT = 220;
const TREE_WIDTH_MIN = 140;
const TREE_WIDTH_MAX = 420;

function loadTreeWidth(): number {
  try {
    const n = Number(localStorage.getItem(TREE_WIDTH_KEY));
    if (Number.isFinite(n) && n >= TREE_WIDTH_MIN && n <= TREE_WIDTH_MAX) {
      return Math.round(n);
    }
  } catch {
    /* ignore */
  }
  return TREE_WIDTH_DEFAULT;
}

function clampTreeWidth(w: number, containerWidth: number): number {
  const maxByContainer = Math.max(
    TREE_WIDTH_MIN,
    Math.floor(containerWidth * 0.55),
  );
  const max = Math.min(TREE_WIDTH_MAX, maxByContainer);
  if (!Number.isFinite(w)) return TREE_WIDTH_DEFAULT;
  return Math.min(max, Math.max(TREE_WIDTH_MIN, Math.round(w)));
}

/** Request from chat (or elsewhere) to open a path/URL in this pane. */
export type ResourceOpenTarget =
  | { type: "file"; path: string; title?: string }
  | { type: "url"; url: string; title?: string }
  /** Open the Rules side panel (project AGENTS.md / .pi rules). */
  | { type: "rules" };

export interface ResourceViewerProps {
  projectId?: string | null;
  sessionId?: string | null;
  projectPath: string | null;
  projectName: string | null;
  /** Remote workspaces do not use the host's local checkpoint store. */
  remoteRuntime?: boolean;
  locale: Locale;
  onClose?: () => void;
  /** When set, open the file/url then call onOpenRequestConsumed. */
  openRequest?: ResourceOpenTarget | null;
  onOpenRequestConsumed?: () => void;
  /**
   * Whether the right pane is currently shown.
   * When it becomes false, the file tree collapses and is not remembered.
   */
  paneActive?: boolean;
  /**
   * Files written/edited by agent tools in the active session (Changes panel).
   */
  sessionChanges?: SessionFileChange[];
  /**
   * Active session messages (optional; used by some side-pane helpers).
   * Accepted for forward-compat with App; not required for core file/plan UI.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionMessages?: any[];
  /**
   * Live plan snapshot for Plan review mode (exit_plan_mode / progress).
   */
  plan?: PlanReviewState | null;
  /** Increment / change to force switch into Plan mode (details / auto-open). */
  planFocusKey?: number | null;
  onApprovePlan?: () => void;
  onRequestPlanChanges?: () => void;
  onDismissPlan?: () => void;
}

type SideMode = "files" | "changes" | "plan" | "rules";

/** Full-pane panels that open as browser-like tabs (Cursor-style). */
type PanelTabKind =
  | "changes"
  | "browser-home"
  | "terminal"
  | "files"
  | "rules"
  | "plan";

const PANEL_TAB_IDS: Record<PanelTabKind, string> = {
  changes: "panel:changes",
  "browser-home": "panel:browser",
  terminal: "panel:terminal",
  files: "panel:files",
  rules: "panel:rules",
  plan: "panel:plan",
};

function isPanelTabKind(
  k: string | null | undefined,
): k is PanelTabKind {
  return (
    k === "changes" ||
    k === "browser-home" ||
    k === "terminal" ||
    k === "files" ||
    k === "rules" ||
    k === "plan"
  );
}

type DiffViewState = {
  path: string;
  name: string;
  loading: boolean;
  /** Unified diff text when available. */
  unified: string | null;
  /** Fallback: full after content only. */
  afterOnly: string | null;
  error: string | null;
  source: "payload" | "git" | "head" | "after" | null;
};

type ChangeSelectionSource = "session" | "workspace";

interface TreeNode {
  name: string;
  relativePath: string;
  isDir: boolean;
  size: number;
  ext: string;
  children?: TreeNode[];
  loaded?: boolean;
}

interface FileTab {
  id: string;
  relativePath: string;
  name: string;
  absolutePath: string;
  preview: api.FsReadResult | null;
  mediaSrc: string | null;
  error: string | null;
  loading: boolean;
  /** External URL tab (web page). */
  url?: string;
  /** file/url content tabs, or full-pane panel tabs (Changes / Browser / …). */
  tabKind?: "file" | "url" | PanelTabKind;
  /** Editable buffer (text kinds only). */
  draftText?: string | null;
  /** Last loaded/saved text — dirty = draft !== baseline. */
  baselineText?: string | null;
  mtimeMs?: number | null;
  /** true = textarea editor; false = preview (markdown default). */
  editMode?: boolean;
  saving?: boolean;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function baseName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

function guessOfficeKind(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx") || lower.endsWith(".docm")) return "docx";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return "xlsx";
  if (lower.endsWith(".pptx") || lower.endsWith(".pptm")) return "pptx";
  if (lower.endsWith(".pdf")) return "pdf";
  return "docx";
}

/** Lightweight file-kind chip for tree rows */
function FileKindMark({ name, isDir }: { name: string; isDir: boolean }) {
  if (isDir) {
    return (
      <span className="rp-kind rp-kind--dir" aria-hidden>
        <IconFolder size={14} />
      </span>
    );
  }
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
  if (ext === "md" || ext === "mdx") {
    return <span className="rp-kind rp-kind--md" aria-hidden>M</span>;
  }
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
    return <span className="rp-kind rp-kind--code" aria-hidden>{"{}"}</span>;
  }
  if (ext === "json" || ext === "toml" || ext === "yaml" || ext === "yml") {
    return <span className="rp-kind rp-kind--data" aria-hidden>{"{ }"}</span>;
  }
  if (ext === "gitignore" || lower === ".gitignore") {
    return <span className="rp-kind rp-kind--git" aria-hidden>◆</span>;
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    return <span className="rp-kind rp-kind--img" aria-hidden>▣</span>;
  }
  return (
    <span className="rp-kind rp-kind--file" aria-hidden>
      <IconFiles size={13} />
    </span>
  );
}

/** Speed-dial shortcuts for the in-pane browser home (all dev-relevant). */
const BROWSER_DIALS: { name: string; url: string; mark: string }[] = [
  { name: "GitHub", url: "https://github.com", mark: "G" },
  { name: "MDN", url: "https://developer.mozilla.org", mark: "M" },
  { name: "Stack Overflow", url: "https://stackoverflow.com", mark: "S" },
  { name: "Can I Use", url: "https://caniuse.com", mark: "C" },
];

/** Coerce free-form address-bar input into a loadable absolute URL. */
function normalizeBrowserUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) return t;
  return `https://${t.replace(/^\/+/, "")}`;
}

export function ResourceViewer({
  projectId = null,
  sessionId = null,
  projectPath,
  projectName,
  remoteRuntime = false,
  locale,
  onClose,
  openRequest,
  onOpenRequestConsumed,
  paneActive = true,
  sessionChanges = [],
  plan = null,
  planFocusKey = null,
  onApprovePlan,
  onRequestPlanChanges,
  onDismissPlan,
}: ResourceViewerProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const checkpointDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );
  const [root, setRoot] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    "": true,
  });
  const [tabs, setTabs] = useState<FileTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Default closed; session-only — not persisted; reset when pane hides.
  const [treeVisible, setTreeVisible] = useState(false);
  /** In-pane browser home (address bar + speed-dial) vs the launcher grid. */
  const [browserHome, setBrowserHome] = useState(false);
  const [browserUrlInput, setBrowserUrlInput] = useState("");
  /** "+" tab-bar tool menu (Codex-style): pick a pane / open any file or URL. */
  const [toolMenu, setToolMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  /** Clamped screen position so the popover never overflows the viewport. */
  const [toolMenuPos, setToolMenuPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [toolQuery, setToolQuery] = useState("");
  const toolMenuRef = useRef<HTMLDivElement>(null);

  // Clamp the popover inside the viewport after it measures itself (the "+"
  // sits at the top-right, so a naive left=clickX pushes it off-screen).
  useLayoutEffect(() => {
    if (!toolMenu) {
      setToolMenuPos(null);
      return;
    }
    const el = toolMenuRef.current;
    if (!el) return;
    const margin = 10;
    const g = globalThis as { innerWidth?: number; innerHeight?: number };
    const vw = typeof g.innerWidth === "number" ? g.innerWidth : 1024;
    const vh = typeof g.innerHeight === "number" ? g.innerHeight : 768;
    // offsetWidth/Height ignore the entry animation's transform (scale), which
    // would otherwise make getBoundingClientRect report a shrunken box and let
    // the popover overshoot the viewport once the animation settles.
    const w = el.offsetWidth || 268;
    const h = el.offsetHeight || 200;
    let left = toolMenu.x;
    let top = toolMenu.y;
    if (left + w > vw - margin) left = vw - margin - w;
    if (left < margin) left = margin;
    if (top + h > vh - margin) top = toolMenu.y - h - 8;
    if (top < margin) top = margin;
    setToolMenuPos({ left, top });
  }, [toolMenu]);

  // Close the tool menu on outside click / Escape.
  useEffect(() => {
    if (!toolMenu) return;
    const onDown = (e: MouseEvent) => {
      if (toolMenuRef.current?.contains(e.target as Node)) return;
      setToolMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setToolMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [toolMenu]);

  /** Point the active browser tab at a new URL (re-creates the webview). */
  const navigateActiveTab = useCallback(
    (nextUrl: string) => {
      if (!activeId) return;
      let name = nextUrl;
      try {
        name = new URL(nextUrl).hostname || nextUrl;
      } catch {
        /* keep */
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeId ? { ...t, url: nextUrl, name } : t,
        ),
      );
    },
    [activeId],
  );
  const [sideMode, setSideMode] = useState<SideMode>("files");
  const lastPlanFocusKey = useRef<number | null>(null);
  const [treeWidth, setTreeWidth] = useState(loadTreeWidth);
  const [resizingTree, setResizingTree] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const [selectedChangePath, setSelectedChangePath] = useState<string | null>(
    null,
  );
  /** Tab id waiting for conflict resolve (reload vs overwrite). */
  const [conflictTabId, setConflictTabId] = useState<string | null>(null);
  /** Close tab while dirty — confirm discard. */
  const [discardTabId, setDiscardTabId] = useState<string | null>(null);
  const [selectedChangeSource, setSelectedChangeSource] =
    useState<ChangeSelectionSource | null>(null);
  const [diffView, setDiffView] = useState<DiffViewState | null>(null);
  const diffLoadSeq = useRef(0);
  const workspaceLoadSeq = useRef(0);
  /** Workspace git status (project-wide), independent of session tool edits. */
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceGitFile[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceAvailable, setWorkspaceAvailable] = useState(false);
  const [workspaceReason, setWorkspaceReason] = useState<string | null>(null);
  const [workspaceBranch, setWorkspaceBranch] = useState<string | null>(null);
  const [numstatMap, setNumstatMap] = useState<
    Map<string, { added: number; removed: number }>
  >(() => new Map());
  const [numstatTotals, setNumstatTotals] = useState({
    added: 0,
    removed: 0,
  });
  const numstatLoadSeq = useRef(0);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  /** Open a PR after a successful push (requires the gh CLI). */
  const [openPrAfterPush, setOpenPrAfterPush] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitPhase, setCommitPhase] = useState<"idle" | "commit" | "push" | "pr">(
    "idle",
  );
  const [commitError, setCommitError] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<WorkspaceGitFile | null>(
    null,
  );
  const [discardBusy, setDiscardBusy] = useState(false);
  const [gitBusyPath, setGitBusyPath] = useState<string | null>(null);
  const [turnCheckpoints, setTurnCheckpoints] = useState<api.TurnCheckpoint[]>(
    [],
  );
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const [revertPreview, setRevertPreview] =
    useState<api.CheckpointRevertPreview | null>(null);
  const [pathCopyFlash, setPathCopyFlash] = useState(false);
  /** Project rule files (AGENTS.md / CLAUDE.md / .pi rules). */
  const [projectRules, setProjectRules] = useState<any[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesHasAgents, setRulesHasAgents] = useState(false);
  const [rulesHint, setRulesHint] = useState<string | null>(null);
  const rulesLoadSeq = useRef(0);
  const [repositoryTrust, setRepositoryTrust] =
    useState<api.RepositoryTrustReview | null>(null);
  const [repositoryTrustLoading, setRepositoryTrustLoading] = useState(false);
  const [repositoryTrustBusy, setRepositoryTrustBusy] = useState(false);
  const [repositoryTrustError, setRepositoryTrustError] = useState<
    string | null
  >(null);
  const repositoryTrustLoadSeq = useRef(0);
  /** Open-with target for the location button (finder / editor id). */
  const [openWithTarget, setOpenWithTarget] = useState(() => {
    try {
      return localStorage.getItem("pi-app.openTarget") || "finder";
    } catch {
      return "finder";
    }
  });

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const changeCount = sessionChanges.length;
  const workspaceCount = workspaceFiles.length;
  const totalChangeBadge = changeCount + workspaceCount;
  const filteredChanges = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessionChanges;
    return sessionChanges.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.path.toLowerCase().includes(q) ||
        (c.toolKind || "").toLowerCase().includes(q),
    );
  }, [sessionChanges, query]);
  const filteredWorkspace = useMemo(
    () => filterWorkspaceGitEntries(workspaceFiles, query),
    [workspaceFiles, query],
  );
  const workspaceStatusMap = useMemo(
    () => buildWorkspaceStatusMap(workspaceFiles),
    [workspaceFiles],
  );
  const stagedCount = useMemo(
    () => workspaceFiles.filter((w) => isWorkspaceStaged(w)).length,
    [workspaceFiles],
  );

  // Closing the right pane always collapses the tree (not remembered).
  useEffect(() => {
    if (!paneActive) setTreeVisible(false);
  }, [paneActive]);

  const refreshNumstat = useCallback(async () => {
    if (!projectPath || !api.isTauri()) {
      setNumstatMap(new Map());
      setNumstatTotals({ added: 0, removed: 0 });
      return;
    }
    const seq = ++numstatLoadSeq.current;
    try {
      const res = await api.gitNumstat(projectPath);
      if (seq !== numstatLoadSeq.current) return;
      if (!res.available) {
        setNumstatMap(new Map());
        setNumstatTotals({ added: 0, removed: 0 });
        return;
      }
      const m = new Map<string, { added: number; removed: number }>();
      for (const e of res.entries ?? []) {
        const k = normalizePath(e.path || "").toLowerCase();
        if (!k) continue;
        m.set(k, {
          added: Number(e.added) || 0,
          removed: Number(e.removed) || 0,
        });
      }
      setNumstatMap(m);
      setNumstatTotals({
        added: Number(res.totalAdded) || 0,
        removed: Number(res.totalRemoved) || 0,
      });
    } catch {
      if (seq !== numstatLoadSeq.current) return;
      setNumstatMap(new Map());
      setNumstatTotals({ added: 0, removed: 0 });
    }
  }, [projectPath]);

  const refreshWorkspaceStatus = useCallback(async () => {
    if (!projectPath || !api.isTauri()) {
      setWorkspaceFiles([]);
      setWorkspaceAvailable(false);
      setWorkspaceBranch(null);
      setWorkspaceReason(null);
      setWorkspaceLoading(false);
      setNumstatMap(new Map());
      setNumstatTotals({ added: 0, removed: 0 });
      return;
    }
    const seq = ++workspaceLoadSeq.current;
    setWorkspaceLoading(true);
    try {
      const res = await api.gitStatus(projectPath);
      if (seq !== workspaceLoadSeq.current) return;
      if (!res.available) {
        setWorkspaceFiles([]);
        setWorkspaceAvailable(false);
        setWorkspaceBranch(res.branch ?? null);
        setWorkspaceReason(res.reason ?? "unavailable");
        setNumstatMap(new Map());
        setNumstatTotals({ added: 0, removed: 0 });
      } else {
        setWorkspaceFiles(
          normalizeWorkspaceGitEntries(res.files ?? [], projectPath),
        );
        setWorkspaceAvailable(true);
        setWorkspaceBranch(res.branch ?? null);
        setWorkspaceReason(null);
        void refreshNumstat();
      }
    } catch (e) {
      if (seq !== workspaceLoadSeq.current) return;
      setWorkspaceFiles([]);
      setWorkspaceAvailable(false);
      setWorkspaceBranch(null);
      setWorkspaceReason(String(e));
      setNumstatMap(new Map());
      setNumstatTotals({ added: 0, removed: 0 });
    } finally {
      if (seq === workspaceLoadSeq.current) setWorkspaceLoading(false);
    }
  }, [projectPath, refreshNumstat]);

  // Prefetch workspace git status for badge + Changes panel (soft; project change).
  useEffect(() => {
    void refreshWorkspaceStatus();
  }, [projectPath, refreshWorkspaceStatus]);

  const refreshCheckpoints = useCallback(async () => {
    if (remoteRuntime || !projectId || !sessionId || !api.isTauri()) {
      setTurnCheckpoints([]);
      setCheckpointsLoading(false);
      setCheckpointError(null);
      return;
    }
    setCheckpointsLoading((current) => current || turnCheckpoints.length === 0);
    try {
      const records = await api.checkpointsList({
        projectId,
        sessionId,
        limit: 20,
      });
      setTurnCheckpoints(records);
      setCheckpointError(null);
    } catch (error) {
      setCheckpointError(String(error));
    } finally {
      setCheckpointsLoading(false);
    }
  }, [projectId, remoteRuntime, sessionId, turnCheckpoints.length]);

  useEffect(() => {
    if (sideMode !== "changes") return;
    void refreshCheckpoints();
    const timer = window.setInterval(() => {
      void refreshCheckpoints();
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [sideMode, refreshCheckpoints]);

  const reviewCheckpointRevert = useCallback(
    async (checkpoint: api.TurnCheckpoint) => {
      if (checkpointBusy) return;
      setCheckpointBusy(true);
      setCheckpointError(null);
      try {
        const preview = await api.checkpointRevertPreview(checkpoint.id);
        if (!preview.clean) {
          setCheckpointError(
            preview.conflictSummary || tr("changes.checkpoints.conflict"),
          );
          return;
        }
        setRevertPreview(preview);
      } catch (error) {
        setCheckpointError(String(error));
      } finally {
        setCheckpointBusy(false);
      }
    },
    [checkpointBusy, tr],
  );

  const applyCheckpointRevert = useCallback(async () => {
    if (!revertPreview || checkpointBusy) return;
    setCheckpointBusy(true);
    setCheckpointError(null);
    try {
      const operationId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `checkpoint-revert-${Date.now()}-${Math.random()
              .toString(16)
              .slice(2)}`;
      const result = await api.checkpointRevertApply({
        checkpointId: revertPreview.checkpointId,
        expectedWorktreeDigest: revertPreview.currentWorktreeDigest,
        operationId,
      });
      setRevertPreview(null);
      if (result.status === "uncertain") {
        setCheckpointError(
          result.recoverableError || tr("changes.checkpoints.uncertain"),
        );
      }
      await Promise.all([refreshCheckpoints(), refreshWorkspaceStatus()]);
    } catch (error) {
      setCheckpointError(String(error));
    } finally {
      setCheckpointBusy(false);
    }
  }, [
    checkpointBusy,
    refreshCheckpoints,
    refreshWorkspaceStatus,
    revertPreview,
    tr,
  ]);

  const refreshProjectRules = useCallback(async () => {
    if (!projectPath || !api.isTauri()) {
      setProjectRules([]);
      setRulesHasAgents(false);
      setRulesLoading(false);
      return;
    }
    const seq = ++rulesLoadSeq.current;
    setRulesLoading(true);
    try {
      const res = (await api.projectRulesList(projectPath)) as any;
      if (seq !== rulesLoadSeq.current) return;
      setProjectRules(res?.rules ?? (Array.isArray(res) ? res : []) ?? []);
      setRulesHasAgents(Boolean(res?.hasAgentsMd));
    } catch (e) {
      if (seq !== rulesLoadSeq.current) return;
      setProjectRules([]);
      setRulesHasAgents(false);
      setError(String(e));
    } finally {
      if (seq === rulesLoadSeq.current) setRulesLoading(false);
    }
  }, [projectPath]);

  const refreshRepositoryTrust = useCallback(async () => {
    if (!projectId || !api.isTauri()) {
      setRepositoryTrust(null);
      setRepositoryTrustLoading(false);
      setRepositoryTrustError(null);
      return;
    }
    const seq = ++repositoryTrustLoadSeq.current;
    setRepositoryTrustLoading(true);
    try {
      const review = await api.repositoryTrustReview(projectId);
      if (seq !== repositoryTrustLoadSeq.current) return;
      setRepositoryTrust(review);
      setRepositoryTrustError(null);
    } catch {
      if (seq !== repositoryTrustLoadSeq.current) return;
      setRepositoryTrust(null);
      setRepositoryTrustError(tr("repositoryTrust.loadFailed"));
    } finally {
      if (seq === repositoryTrustLoadSeq.current) {
        setRepositoryTrustLoading(false);
      }
    }
  }, [projectId, tr]);

  // Load rules when project changes or Rules panel is shown.
  useEffect(() => {
    void Promise.all([refreshProjectRules(), refreshRepositoryTrust()]);
  }, [
    projectPath,
    refreshProjectRules,
    refreshRepositoryTrust,
  ]);

  useEffect(() => {
    if (sideMode === "rules") {
      void Promise.all([refreshProjectRules(), refreshRepositoryTrust()]);
    }
  }, [
    sideMode,
    refreshProjectRules,
    refreshRepositoryTrust,
  ]);

  const changeRepositoryTrust = useCallback(
    async (action: "once" | "digest" | "reject" | "revoke") => {
      if (!projectId || repositoryTrustBusy) return;
      const digest = repositoryTrust?.digest;
      if (action !== "revoke" && !digest) return;
      setRepositoryTrustBusy(true);
      setRepositoryTrustError(null);
      try {
        const operationId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `repository-trust-${Date.now()}-${Math.random()
                .toString(16)
                .slice(2)}`;
        let review: api.RepositoryTrustReview;
        if (action === "once") {
          review = await api.repositoryTrustApprove({
            projectId,
            expectedDigest: digest!,
            mode: "once",
          });
        } else if (action === "digest") {
          review = await api.repositoryTrustApprove({
            projectId,
            expectedDigest: digest!,
            mode: "digest",
            operationId,
          });
        } else if (action === "reject") {
          review = await api.repositoryTrustReject({
            projectId,
            expectedDigest: digest!,
            operationId,
          });
        } else {
          review = await api.repositoryTrustRevoke({
            projectId,
            operationId,
          });
        }
        setRepositoryTrust(review);
        setRulesHint(
          action === "revoke"
            ? tr("repositoryTrust.revoked")
            : action === "reject"
              ? tr("repositoryTrust.rejected")
              : tr("repositoryTrust.approved"),
        );
      } catch {
        setRepositoryTrustError(tr("repositoryTrust.actionFailed"));
        await refreshRepositoryTrust();
      } finally {
        setRepositoryTrustBusy(false);
      }
    },
    [
      projectId,
      refreshRepositoryTrust,
      repositoryTrust,
      repositoryTrustBusy,
      tr,
    ],
  );

  // Drop selection if neither session nor workspace still lists the path.
  useEffect(() => {
    if (!selectedChangePath) return;
    const n = normalizePath(selectedChangePath);
    const inSession = sessionChanges.some(
      (c) => normalizePath(c.path) === n,
    );
    const inWorkspace = workspaceFiles.some(
      (c) =>
        normalizePath(c.path) === n ||
        normalizePath(c.absolutePath) === n,
    );
    if (!inSession && !inWorkspace) {
      setSelectedChangePath(null);
      setSelectedChangeSource(null);
      setDiffView(null);
    }
  }, [sessionChanges, workspaceFiles, selectedChangePath]);

  const loadChangeDiff = useCallback(
    async (change: SessionFileChange) => {
      const path = normalizePath(change.path);
      if (!path) return;
      const seq = ++diffLoadSeq.current;
      setSelectedChangePath(path);
      setSelectedChangeSource("session");
      setDiffView({
        path,
        name: change.name || pathBaseName(path),
        loading: true,
        unified: null,
        afterOnly: null,
        error: null,
        source: null,
      });

      const relName =
        pathRelativeToProject(path, projectPath) || change.name || pathBaseName(path);

      // 1) Tool payload before/after → local unified diff
      if (
        typeof change.before === "string" &&
        typeof change.after === "string"
      ) {
        const unified = buildUnifiedDiff(relName, change.before, change.after);
        if (seq !== diffLoadSeq.current) return;
        setDiffView({
          path,
          name: change.name || pathBaseName(path),
          loading: false,
          unified,
          afterOnly: null,
          error: null,
          source: "payload",
        });
        return;
      }

      // 2) Optional git diff under project
      if (projectPath && api.isTauri()) {
        try {
          const g = await api.gitFileDiff(projectPath, path);
          if (seq !== diffLoadSeq.current) return;
          if (g.available && g.diff?.trim()) {
            setDiffView({
              path,
              name: change.name || pathBaseName(path),
              loading: false,
              unified: g.diff,
              afterOnly: null,
              error: null,
              source: "git",
            });
            return;
          }
        } catch {
          /* soft-fail; try after content */
        }
      }

      // 3) Payload after-only, or read current file
      let afterText =
        typeof change.after === "string" && change.after.length > 0
          ? change.after
          : null;
      if (!afterText && api.isTauri()) {
        try {
          const r = await api.fsOpenPath(path, projectPath);
          if (r.text) afterText = r.text;
        } catch {
          /* ignore */
        }
      }

      // 3b) HEAD content via git_show_file + after → local unified diff
      if (
        afterText != null &&
        typeof change.before !== "string" &&
        projectPath &&
        api.isTauri()
      ) {
        try {
          const head = await api.gitShowFile(projectPath, path);
          if (seq !== diffLoadSeq.current) return;
          if (head.available && typeof head.content === "string") {
            const unified = buildUnifiedDiff(relName, head.content, afterText);
            setDiffView({
              path,
              name: change.name || pathBaseName(path),
              loading: false,
              unified,
              afterOnly: null,
              error: null,
              source: "head",
            });
            return;
          }
        } catch {
          /* soft-fail */
        }
      }

      if (seq !== diffLoadSeq.current) return;

      if (
        typeof change.before === "string" &&
        afterText != null
      ) {
        const unified = buildUnifiedDiff(relName, change.before, afterText);
        setDiffView({
          path,
          name: change.name || pathBaseName(path),
          loading: false,
          unified,
          afterOnly: null,
          error: null,
          source: "payload",
        });
        return;
      }

      if (afterText != null) {
        setDiffView({
          path,
          name: change.name || pathBaseName(path),
          loading: false,
          unified: null,
          afterOnly: afterText,
          error: null,
          source: "after",
        });
        return;
      }

      setDiffView({
        path,
        name: change.name || pathBaseName(path),
        loading: false,
        unified: null,
        afterOnly: null,
        error: null,
        source: null,
      });
    },
    [projectPath],
  );

  const loadWorkspaceDiff = useCallback(
    async (entry: WorkspaceGitFile) => {
      const abs =
        normalizePath(entry.absolutePath) ||
        resolveWorkspaceAbsolutePath(projectPath, entry.path);
      const path = abs || normalizePath(entry.path);
      if (!path) return;
      const seq = ++diffLoadSeq.current;
      setSelectedChangePath(path);
      setSelectedChangeSource("workspace");
      setDiffView({
        path,
        name: entry.name || pathBaseName(path),
        loading: true,
        unified: null,
        afterOnly: null,
        error: null,
        source: null,
      });

      const relName = entry.path || pathBaseName(path);

      // Prefer git unified diff for workspace rows
      if (projectPath && api.isTauri()) {
        try {
          const g = await api.gitFileDiff(projectPath, path);
          if (seq !== diffLoadSeq.current) return;
          if (g.available && g.diff?.trim()) {
            setDiffView({
              path,
              name: entry.name || pathBaseName(path),
              loading: false,
              unified: g.diff,
              afterOnly: null,
              error: null,
              source: "git",
            });
            return;
          }
        } catch {
          /* soft-fail */
        }

        // HEAD + working tree for local unified when porcelain has no unified text
        try {
          const [head, cur] = await Promise.all([
            api.gitShowFile(projectPath, path).catch(() => null),
            api.fsOpenPath(path, projectPath).catch(() => null),
          ]);
          if (seq !== diffLoadSeq.current) return;
          const afterText = cur?.text ?? null;
          if (head?.available && typeof head.content === "string" && afterText != null) {
            const unified = buildUnifiedDiff(relName, head.content, afterText);
            setDiffView({
              path,
              name: entry.name || pathBaseName(path),
              loading: false,
              unified,
              afterOnly: null,
              error: null,
              source: "head",
            });
            return;
          }
          if (afterText != null) {
            // Untracked / new: show full file as after-only
            setDiffView({
              path,
              name: entry.name || pathBaseName(path),
              loading: false,
              unified:
                entry.kind === "untracked" || entry.kind === "added"
                  ? buildUnifiedDiff(relName, "", afterText)
                  : null,
              afterOnly:
                entry.kind === "untracked" || entry.kind === "added"
                  ? null
                  : afterText,
              error: null,
              source:
                entry.kind === "untracked" || entry.kind === "added"
                  ? "git"
                  : "after",
            });
            return;
          }
        } catch {
          /* soft-fail */
        }
      }

      if (seq !== diffLoadSeq.current) return;
      setDiffView({
        path,
        name: entry.name || pathBaseName(path),
        loading: false,
        unified: null,
        afterOnly: null,
        error: null,
        source: null,
      });
    },
    [projectPath],
  );

  const openChangeInEditor = useCallback(async (path: string) => {
    if (!path || !api.isTauri()) return;
    try {
      await api.openInEditor({ path });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const revealChangePath = useCallback(async (path: string) => {
    if (!path || !api.isTauri()) return;
    try {
      await api.pathReveal(path);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const copyChangePath = useCallback(async (path: string) => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setPathCopyFlash(true);
      window.setTimeout(() => setPathCopyFlash(false), 1200);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const workspaceKindLabel = useCallback(
    (kind: string) =>
      tr(workspaceGitKindMessageKey(kind) as MessageKey),
    [tr],
  );

  const workspaceUnavailableLabel = useCallback(() => {
    const r = (workspaceReason || "").toLowerCase();
    if (r.includes("not a git") || r.includes("not a git repository")) {
      return tr("changes.workspace.noRepo");
    }
    if (r.includes("git not available") || r.includes("not available")) {
      return tr("changes.workspace.noGit");
    }
    return tr("changes.workspace.unavailable");
  }, [tr, workspaceReason]);

  const gitOpFailMessage = useCallback(
    (res: api.GitOpResult | null | undefined, fallback?: string) => {
      const reason = (res?.reason || res?.output || "").trim();
      if (reason) return reason;
      return fallback || tr("changes.opFailed");
    },
    [tr],
  );

  const toggleWorkspaceStage = useCallback(
    async (entry: WorkspaceGitFile) => {
      if (!projectPath || !api.isTauri() || gitBusyPath) return;
      setGitBusyPath(entry.path);
      try {
        const staged = isWorkspaceStaged(entry);
        const res = staged
          ? await api.gitUnstage(projectPath, [entry.path])
          : await api.gitStage(projectPath, [entry.path]);
        if (!res.ok) {
          setError(gitOpFailMessage(res));
          return;
        }
        await refreshWorkspaceStatus();
      } catch (e) {
        setError(String(e) || tr("changes.opFailed"));
      } finally {
        setGitBusyPath(null);
      }
    },
    [projectPath, gitBusyPath, gitOpFailMessage, refreshWorkspaceStatus, tr],
  );

  const applyWorkspaceDiscard = useCallback(async () => {
    if (!projectPath || !api.isTauri() || !discardTarget || discardBusy) return;
    setDiscardBusy(true);
    try {
      const split = splitDiscardPaths(discardTarget);
      const res = await api.gitDiscard(
        projectPath,
        split.tracked,
        split.untracked,
      );
      if (!res.ok) {
        setError(gitOpFailMessage(res));
        return;
      }
      setDiscardTarget(null);
      await refreshWorkspaceStatus();
      if (
        selectedChangeSource === "workspace" &&
        selectedChangePath &&
        (normalizePath(selectedChangePath) ===
          normalizePath(discardTarget.absolutePath) ||
          normalizePath(selectedChangePath) ===
            normalizePath(discardTarget.path))
      ) {
        setSelectedChangePath(null);
        setSelectedChangeSource(null);
        setDiffView(null);
      }
    } catch (e) {
      setError(String(e) || tr("changes.opFailed"));
    } finally {
      setDiscardBusy(false);
    }
  }, [
    projectPath,
    discardTarget,
    discardBusy,
    gitOpFailMessage,
    refreshWorkspaceStatus,
    selectedChangeSource,
    selectedChangePath,
    tr,
  ]);

  const runCommitAndPush = useCallback(async () => {
    if (!projectPath || !api.isTauri() || commitBusy) return;
    const message = commitMsg.trim();
    if (!message) {
      setCommitError(tr("changes.commitEmpty"));
      return;
    }
    if (stagedCount === 0) {
      setCommitError(tr("changes.nothingToCommit"));
      return;
    }
    setCommitBusy(true);
    setCommitError(null);
    setCommitPhase("commit");
    try {
      const c = await api.gitCommit(projectPath, message);
      if (!c.ok) {
        setCommitError(gitOpFailMessage(c));
        return;
      }
      setCommitPhase("push");
      const p = await api.gitPush(projectPath);
      if (!p.ok) {
        setCommitError(gitOpFailMessage(p));
        await refreshWorkspaceStatus();
        return;
      }
      if (openPrAfterPush) {
        setCommitPhase("pr");
        const { title, body } = splitPrTitleAndBody(message);
        const pr = await api.ghPrCreate({
          projectPath,
          title,
          body,
          draft: false,
        });
        if (!pr.ok) {
          // The commit and push already landed — surface the PR failure
          // without pretending the whole operation was rolled back.
          setCommitError(pr.reason || tr("changes.prFailed"));
          await refreshWorkspaceStatus();
          return;
        }
        const url = pr.output.split(/\s+/).find((t) => t.startsWith("http"));
        setPrUrl(url ?? null);
      }
      setCommitOpen(false);
      setCommitMsg("");
      setCommitPhase("idle");
      await refreshWorkspaceStatus();
    } catch (e) {
      setCommitError(String(e) || tr("changes.opFailed"));
    } finally {
      setCommitBusy(false);
      setCommitPhase("idle");
    }
  }, [
    projectPath,
    commitBusy,
    commitMsg,
    stagedCount,
    openPrAfterPush,
    gitOpFailMessage,
    refreshWorkspaceStatus,
    tr,
  ]);

  const panelTabLabel = useCallback(
    (kind: PanelTabKind): string => {
      if (kind === "changes") return tr("rp.launcher.changes");
      if (kind === "browser-home") return tr("rp.launcher.browser");
      if (kind === "terminal") return tr("rp.launcher.terminal");
      if (kind === "files") return tr("resources.files");
      if (kind === "rules") return tr("rules.title");
      return tr("resources.plan");
    },
    [tr],
  );

  /**
   * Open or focus a full-pane panel tab (Cursor-style: each action is a tab).
   */
  const openPanelTab = useCallback(
    (kind: PanelTabKind) => {
      setBrowserHome(false);
      setTreeVisible(false);
      const id = PANEL_TAB_IDS[kind];
      if (kind === "plan") setSideMode("plan");
      else if (kind === "changes") setSideMode("changes");
      else if (kind === "rules") setSideMode("rules");
      else setSideMode("files");

      setTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        const tab: FileTab = {
          id,
          relativePath: "",
          name: panelTabLabel(kind),
          absolutePath: "",
          preview: null,
          mediaSrc: null,
          error: null,
          loading: false,
          tabKind: kind,
        };
        return [...prev, tab];
      });
      setActiveId(id);
      if (kind === "changes") void refreshWorkspaceStatus();
      if (kind === "browser-home") setBrowserHome(true);
    },
    [panelTabLabel, refreshWorkspaceStatus],
  );

  /** @deprecated path — routes to panel tabs for Cursor-like UX. */
  const showSidePanel = (mode: SideMode) => {
    if (mode === "plan") {
      openPanelTab("plan");
      return;
    }
    openPanelTab(mode);
  };

  /**
   * Empty-pane home: no open tabs → 2×2 launcher grid (Changes / Browser /
   * Terminal / File), matching the IDE reference.
   */
  const launcherHome = tabs.length === 0 && !activeTab;
  const activePanelKind: PanelTabKind | null = isPanelTabKind(
    activeTab?.tabKind,
  )
    ? activeTab!.tabKind
    : null;
  const changesPanelActive = activePanelKind === "changes";
  const browserHomeView =
    activePanelKind === "browser-home" || (!activeTab && browserHome);
  const filesPanelActive = activePanelKind === "files";
  const terminalPanelActive = activePanelKind === "terminal";
  const rulesPanelActive = activePanelKind === "rules";
  const planPanelActive = activePanelKind === "plan";

  // External “open plan in resources” (details / auto-open on review).
  useEffect(() => {
    if (planFocusKey == null) return;
    if (lastPlanFocusKey.current === planFocusKey) return;
    lastPlanFocusKey.current = planFocusKey;
    openPanelTab("plan");
  }, [planFocusKey, openPanelTab]);

  // Plan dismissed while viewing plan tab → close that tab.
  useEffect(() => {
    if (!plan || plan.visible) return;
    setTabs((prev) => {
      if (!prev.some((t) => t.id === PANEL_TAB_IDS.plan)) return prev;
      const next = prev.filter((t) => t.id !== PANEL_TAB_IDS.plan);
      if (activeId === PANEL_TAB_IDS.plan) {
        setActiveId(next[next.length - 1]?.id ?? null);
      }
      return next;
    });
    if (sideMode === "plan") setSideMode("files");
  }, [plan, activeId, sideMode]);

  // Drag-resize preview | file-tree split
  useEffect(() => {
    if (!resizingTree) return;
    const onMove = (e: PointerEvent) => {
      const box = splitRef.current?.getBoundingClientRect();
      if (!box) return;
      // Tree is on the right → width from pointer to container right edge
      const next = clampTreeWidth(box.right - e.clientX, box.width);
      setTreeWidth(next);
    };
    const onUp = () => {
      setResizingTree(false);
      setTreeWidth((w) => {
        try {
          localStorage.setItem(TREE_WIDTH_KEY, String(w));
        } catch {
          /* ignore */
        }
        return w;
      });
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizingTree]);

  const loadDir = useCallback(
    async (relative: string): Promise<TreeNode[]> => {
      if (!projectPath) return [];
      if (!api.isTauri()) throw new Error("Tauri required");
      const entries = await api.fsListDir(projectPath, relative);
      return entries.map((e) => ({
        name: e.name,
        relativePath: e.relativePath,
        isDir: e.isDir,
        size: e.size,
        ext: e.ext,
        children: e.isDir ? [] : undefined,
        loaded: !e.isDir,
      }));
    },
    [projectPath],
  );

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setRoot([]);
      return;
    }
    setLoadingTree(true);
    setError(null);
    try {
      setRoot(await loadDir(""));
    } catch (e) {
      setError(String(e));
      setRoot([]);
    } finally {
      setLoadingTree(false);
    }
  }, [loadDir, projectPath]);

  useEffect(() => {
    void refresh();
    setTabs([]);
    setActiveId(null);
    setExpanded({ "": true });
    setQuery("");
  }, [projectPath, refresh]);

  const toggleDir = async (node: TreeNode) => {
    const key = node.relativePath;
    const willOpen = !expanded[key];
    setExpanded((ex) => ({ ...ex, [key]: willOpen }));
    if (willOpen && !node.loaded) {
      try {
        const children = await loadDir(node.relativePath);
        const patch = (list: TreeNode[]): TreeNode[] =>
          list.map((n) => {
            if (n.relativePath === key) return { ...n, children, loaded: true };
            if (n.children) return { ...n, children: patch(n.children) };
            return n;
          });
        setRoot((r) => patch(r));
      } catch (e) {
        setError(String(e));
      }
    }
  };

  const applyReadResult = (
    id: string,
    r: api.FsReadResult,
    src: string | null,
    relativePath: string,
  ) => {
    const editable = isResourceTextEditable({
      kind: r.kind,
      text: r.text,
      truncated: r.truncated,
      error: r.error,
    });
    const text = r.text ?? null;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              preview: r,
              mediaSrc: src,
              absolutePath: r.absolutePath || "",
              relativePath: relativePath || r.relativePath || t.relativePath,
              name: r.name || baseName(relativePath || r.absolutePath || "file"),
              loading: false,
              tabKind: "file" as const,
              draftText: editable ? text : null,
              baselineText: editable ? text : null,
              mtimeMs: typeof r.mtimeMs === "number" ? r.mtimeMs : null,
              editMode: editable ? defaultResourceEditMode(r.kind) : false,
              saving: false,
            }
          : t,
      ),
    );
  };

  const activeTabDirty = useMemo(() => {
    if (!activeTab || activeTab.tabKind === "url") return false;
    if (isPanelTabKind(activeTab.tabKind)) return false;
    return isResourceDraftDirty(activeTab.draftText, activeTab.baselineText);
  }, [activeTab]);

  const activeTabEditable = useMemo(() => {
    if (!activeTab?.preview || activeTab.tabKind === "url") return false;
    if (isPanelTabKind(activeTab.tabKind)) return false;
    return isResourceTextEditable({
      kind: activeTab.preview.kind,
      text: activeTab.baselineText ?? activeTab.preview.text,
      truncated: activeTab.preview.truncated,
      error: activeTab.preview.error,
    });
  }, [activeTab]);

  const updateActiveDraft = useCallback((text: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeId ? { ...t, draftText: text } : t,
      ),
    );
  }, [activeId]);

  const revertActiveDraft = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeId && t.baselineText != null
          ? { ...t, draftText: t.baselineText }
          : t,
      ),
    );
  }, [activeId]);

  const reloadActiveFile = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab || tab.tabKind === "url" || !api.isTauri()) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tab.id ? { ...t, loading: true, error: null } : t,
      ),
    );
    try {
      let r: api.FsReadResult;
      if (projectPath && tab.relativePath && !tab.relativePath.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(tab.relativePath)) {
        r = await api.fsReadFile(projectPath, tab.relativePath);
      } else if (tab.absolutePath) {
        r = await api.fsReadAbsolute(tab.absolutePath);
      } else {
        r = await api.fsOpenPath(tab.relativePath, projectPath);
      }
      const src = await resolvePreviewSrc(r);
      applyReadResult(tab.id, r, src, tab.relativePath);
    } catch (e) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                loading: false,
                error: `${tr("resources.openFailed")}: ${String(e)}`,
              }
            : t,
        ),
      );
    }
  }, [activeId, projectPath, tabs, tr]);

  const saveActiveFile = useCallback(
    async (opts?: { force?: boolean }) => {
      const tab = tabs.find((t) => t.id === activeId);
      if (!tab || tab.tabKind === "url" || tab.draftText == null) return;
      if (!api.isTauri()) {
        setError(tr("resources.saveFailed"));
        return;
      }
      if (!isResourceDraftDirty(tab.draftText, tab.baselineText) && !opts?.force) {
        return;
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id ? { ...t, saving: true, error: null } : t,
        ),
      );
      setError(null);
      try {
        const expected = opts?.force ? null : tab.mtimeMs ?? null;
        const underProject =
          !!projectPath &&
          tab.relativePath &&
          !tab.relativePath.startsWith("/") &&
          !/^[A-Za-z]:[\\/]/.test(tab.relativePath) &&
          (tab.absolutePath
            ? normalizePath(tab.absolutePath).startsWith(
                normalizePath(projectPath) + "/",
              ) ||
              normalizePath(tab.absolutePath) === normalizePath(projectPath)
            : true);

        let w: api.FsWriteResult;
        if (underProject && projectPath) {
          w = await api.fsWriteFile(
            projectPath,
            tab.relativePath,
            tab.draftText,
            expected,
          );
        } else if (tab.absolutePath) {
          w = await api.fsWriteAbsolute(
            tab.absolutePath,
            tab.draftText,
            expected,
          );
        } else {
          throw new Error(tr("resources.saveNoPath"));
        }

        const savedText = tab.draftText ?? "";
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  saving: false,
                  baselineText: savedText,
                  draftText: savedText,
                  mtimeMs: w.mtimeMs,
                  absolutePath: w.absolutePath || t.absolutePath,
                  preview: t.preview
                    ? {
                        ...t.preview,
                        text: savedText,
                        size: w.size,
                        mtimeMs: w.mtimeMs,
                        truncated: false,
                      }
                    : t.preview,
                }
              : t,
          ),
        );
      } catch (e) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id ? { ...t, saving: false } : t,
          ),
        );
        if (isFsWriteConflict(e)) {
          setConflictTabId(tab.id);
        } else {
          setError(String(e) || tr("resources.saveFailed"));
        }
      }
    },
    [activeId, projectPath, tabs, tr],
  );

  const openFile = async (relativePath: string) => {
    if (!projectPath) {
      setError(tr("main.noProject"));
      return;
    }
    if (!api.isTauri()) {
      setError(tr("resources.openFailed"));
      return;
    }
    const existing = tabs.find(
      (t) => t.tabKind !== "url" && t.relativePath === relativePath,
    );
    if (existing) {
      setTabs((prev) => {
        const hit = prev.find((t) => t.id === existing.id);
        if (!hit) return prev;
        return [hit, ...prev.filter((t) => t.id !== existing.id)];
      });
      setActiveId(existing.id);
      return;
    }
    const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const tab: FileTab = {
      id,
      relativePath,
      name: baseName(relativePath),
      absolutePath: "",
      preview: null,
      mediaSrc: null,
      error: null,
      loading: true,
      tabKind: "file",
    };
    // Newest tab on the left
    setTabs((prev) => [tab, ...prev]);
    setActiveId(id);
    try {
      const r = await api.fsReadFile(projectPath, relativePath);
      const src = await resolvePreviewSrc(r);
      applyReadResult(id, r, src, relativePath);
    } catch (e) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                loading: false,
                error: `${tr("resources.openFailed")}: ${String(e)}`,
              }
            : t,
        ),
      );
    }
  };

  /**
   * Open path from chat cards. Uses smart host resolver:
   * absolute → project-relative → suffix search under project root
   * (handles monorepo: agent writes `05-handoff/next.md` under a subfolder).
   */
  const openAbsoluteFile = useCallback(
    async (absolutePath: string, title?: string) => {
      if (!api.isTauri()) {
        setError(tr("resources.openFailed"));
        return;
      }
      const norm = absolutePath.trim();
      if (!norm) return;
      const existing = tabs.find(
        (t) =>
          t.tabKind !== "url" &&
          (t.absolutePath === norm || t.relativePath === norm),
      );
      if (existing) {
        // Move existing to front + activate (Chrome-like focus)
        setTabs((prev) => {
          const hit = prev.find((t) => t.id === existing.id);
          if (!hit) return prev;
          return [hit, ...prev.filter((t) => t.id !== existing.id)];
        });
        setActiveId(existing.id);
        return;
      }
      const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const tab: FileTab = {
        id,
        relativePath: norm,
        name: title || baseName(norm),
        absolutePath: norm,
        preview: null,
        mediaSrc: null,
        error: null,
        loading: true,
        tabKind: "file",
      };
      setTabs((prev) => [tab, ...prev]);
      setActiveId(id);
      try {
        const r = await api.fsOpenPath(norm, projectPath);
        const src = await resolvePreviewSrc(r);
        // Prefer project-relative tab key when file is under project
        let relKey = r.relativePath || baseName(norm);
        if (projectPath && r.absolutePath) {
          const root = projectPath.replace(/[/\\]+$/, "").replace(/\\/g, "/");
          const absN = r.absolutePath.replace(/\\/g, "/");
          if (absN.startsWith(root + "/")) {
            relKey = absN.slice(root.length + 1);
          }
        }
        applyReadResult(id, r, src, relKey);
      } catch (e) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  loading: false,
                  error: `${tr("resources.openFailed")}: ${String(e)}`,
                }
              : t,
          ),
        );
      }
    },
    [projectPath, tabs, tr],
  );

  const openUrl = useCallback(
    (url: string, title?: string) => {
      const u = url.trim();
      if (!u) return;
      const existing = tabs.find((t) => t.tabKind === "url" && t.url === u);
      if (existing) {
        setActiveId(existing.id);
        return;
      }
      const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      let name = title || u;
      try {
        name = title || new URL(u).hostname || u;
      } catch {
        /* keep */
      }
      const tab: FileTab = {
        id,
        relativePath: u,
        name,
        absolutePath: "",
        preview: null,
        mediaSrc: null,
        error: null,
        loading: false,
        url: u,
        tabKind: "url",
      };
      setTabs((prev) => [tab, ...prev]);
      setActiveId(id);
    },
    [tabs],
  );

  /** Resolve the tool-menu omnibox: URL → browser tab, else open as file. */
  const commitToolQuery = useCallback(() => {
    const t = toolQuery.trim();
    if (!t) return;
    setToolMenu(null);
    setToolQuery("");
    if (
      /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t) ||
      /\.[a-z]{2,}(\/|$)/i.test(t)
    ) {
      const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)
        ? t
        : `https://${t.replace(/^\/+/, "")}`;
      openUrl(url);
      return;
    }
    void openAbsoluteFile(t);
  }, [toolQuery, openUrl, openAbsoluteFile]);

  // External open requests (from chat file/url cards, project rules menu)
  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.type === "file") {
      void openAbsoluteFile(openRequest.path, openRequest.title);
    } else if (openRequest.type === "url") {
      openUrl(openRequest.url, openRequest.title);
    } else if (openRequest.type === "rules") {
      setSideMode("rules");
      setTreeVisible(true);
      void refreshProjectRules();
    }
    onOpenRequestConsumed?.();
  }, [
    openRequest,
    openAbsoluteFile,
    openUrl,
    onOpenRequestConsumed,
    refreshProjectRules,
  ]);

  const openRuleFile = useCallback(
    async (rule: any) => {
      if (!rule) return;
      const rel = (rule.relativePath || "").trim();
      if (projectPath && rel && !rel.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(rel)) {
        await openFile(rel);
        return;
      }
      const abs = (rule.absolutePath || "").trim();
      if (abs) {
        await openAbsoluteFile(abs, rule.name);
        return;
      }
      setError(tr("rules.openFailed"));
    },
    [openAbsoluteFile, openFile, projectPath, tr],
  );

  const ensureAgentsTemplate = useCallback(async () => {
    if (!projectPath || !api.isTauri()) {
      setError(tr("rules.needProject"));
      return;
    }
    setRulesHint(null);
    try {
      const res = await api.projectRulesEnsureTemplate(projectPath);
      await refreshProjectRules();
      if (res.created) {
        setRulesHint(tr("rules.created"));
      } else {
        setRulesHint(tr("rules.exists"));
      }
      const rel = res.relativePath || "AGENTS.md";
      await openFile(rel);
    } catch (e) {
      setError(String(e) || tr("rules.actionError"));
    }
  }, [openFile, projectPath, refreshProjectRules, tr]);

  const ruleKindLabel = useCallback(
    (kind: string) => {
      const k = (kind || "").trim();
      if (k === "agents_md") return tr("rules.kind.agents_md");
      if (k === "claude_md") return tr("rules.kind.claude_md");
      if (k === "pi_rules") return tr("rules.kind.pi_rules");
      if (k === "nested_agents") return tr("rules.kind.nested_agents");
      return k || tr("rules.title");
    },
    [tr],
  );

  const repositoryTrustStatusLabel = useCallback(
    (status: string) => {
      if (status === "trusted") return tr("repositoryTrust.status.trusted");
      if (status === "trusted-once") {
        return tr("repositoryTrust.status.trustedOnce");
      }
      if (status === "changed") return tr("repositoryTrust.status.changed");
      if (status === "rejected") return tr("repositoryTrust.status.rejected");
      if (status === "project-untrusted") {
        return tr("repositoryTrust.status.projectUntrusted");
      }
      if (status === "invalid") return tr("repositoryTrust.status.invalid");
      if (status === "missing") return tr("repositoryTrust.status.missing");
      return tr("repositoryTrust.status.untrusted");
    },
    [tr],
  );

  const repositoryContributionKindLabel = useCallback(
    (kind: string) => {
      if (kind === "mcp") return tr("repositoryTrust.kind.mcp");
      if (kind === "skill") return tr("repositoryTrust.kind.skill");
      if (kind === "script") return tr("repositoryTrust.kind.script");
      return kind;
    },
    [tr],
  );

  const filteredRules = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projectRules;
    return projectRules.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.relativePath.toLowerCase().includes(q) ||
        (r.kind || "").toLowerCase().includes(q),
    );
  }, [projectRules, query]);

  /**
   * Last tab gone → stay open on the launcher grid (Cursor-style). The user
   * closes the whole aside with the chrome close control.
   */
  const closePaneIfNoTabs = useCallback((_remaining: number) => {
    setBrowserHome(false);
    setTreeVisible(false);
    setSideMode("files");
  }, []);

  const closeTabForced = useCallback(
    (id: string) => {
      let remaining = -1;
      if (id === PANEL_TAB_IDS["browser-home"]) setBrowserHome(false);
      if (id === PANEL_TAB_IDS.changes) {
        setDiffView(null);
        setSelectedChangePath(null);
        setSelectedChangeSource(null);
      }
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) {
          remaining = prev.length;
          return prev;
        }
        const next = prev.filter((t) => t.id !== id);
        remaining = next.length;
        if (activeId === id) {
          // Prefer neighbor on the left (newer), else right
          const neighbor = next[Math.max(0, idx - 1)] ?? next[0] ?? null;
          setActiveId(neighbor?.id ?? null);
        }
        return next;
      });
      if (remaining === 0) closePaneIfNoTabs(0);
    },
    [activeId, closePaneIfNoTabs],
  );

  const closeTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (tab && isResourceDraftDirty(tab.draftText, tab.baselineText)) {
        setDiscardTabId(id);
        return;
      }
      closeTabForced(id);
    },
    [closeTabForced, tabs],
  );

  /** Chrome-style: close every tab except `id`. */
  const closeOtherTabs = useCallback(
    (id: string) => {
      setTabs((prev) => prev.filter((t) => t.id === id));
      setActiveId(id);
    },
    [],
  );

  /** Close tabs visually to the right of `id` (higher index; older tabs). */
  const closeTabsToRight = useCallback(
    (id: string) => {
      let remaining = -1;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) {
          remaining = prev.length;
          return prev;
        }
        const next = prev.slice(0, idx + 1);
        remaining = next.length;
        if (activeId && !next.some((t) => t.id === activeId)) {
          setActiveId(id);
        }
        return next;
      });
      if (remaining === 0) closePaneIfNoTabs(0);
    },
    [activeId, closePaneIfNoTabs],
  );

  /** Close tabs visually to the left of `id` (lower index; newer tabs). */
  const closeTabsToLeft = useCallback(
    (id: string) => {
      let remaining = -1;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx < 0) {
          remaining = prev.length;
          return prev;
        }
        const next = prev.slice(idx);
        remaining = next.length;
        if (activeId && !next.some((t) => t.id === activeId)) {
          setActiveId(id);
        }
        return next;
      });
      if (remaining === 0) closePaneIfNoTabs(0);
    },
    [activeId, closePaneIfNoTabs],
  );

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveId(null);
    closePaneIfNoTabs(0);
  }, [closePaneIfNoTabs]);

  const [tabMenu, setTabMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  const absPath =
    (diffView && changesPanelActive ? diffView.path : "") ||
    (activeTab && !isPanelTabKind(activeTab.tabKind)
      ? activeTab.absolutePath
      : "") ||
    "";

  const filterMatch = useCallback(
    (name: string, path: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return name.toLowerCase().includes(q) || path.toLowerCase().includes(q);
    },
    [query],
  );

  const renderTree = (nodes: TreeNode[], depth: number): ReactNode =>
    nodes
      .filter((n) => filterMatch(n.name, n.relativePath) || n.isDir)
      .map((n) => {
        const isOpen = !!expanded[n.relativePath];
        const active = activeTab?.relativePath === n.relativePath;
        const gitKind = !n.isDir
          ? workspaceStatusMap.get(normalizePath(n.relativePath).toLowerCase())
          : undefined;
        return (
          <div key={n.relativePath || n.name}>
            <Tip label={n.relativePath}>
              <button
                type="button"
                className={
                  "rp-tree__row" +
                  (active ? " is-active" : "") +
                  (n.isDir ? " is-dir" : "")
                }
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={(e) => {
                  e.preventDefault();
                  if (n.isDir) void toggleDir(n);
                  else void openFile(n.relativePath);
                }}
              >
                <span className="rp-tree__chev">
                  {n.isDir ? (
                    isOpen ? (
                      <IconChevronDown size={12} />
                    ) : (
                      <IconChevronRight size={12} />
                    )
                  ) : (
                    <span className="rp-tree__gap" />
                  )}
                </span>
                <FileKindMark name={n.name} isDir={n.isDir} />
                <span className="rp-tree__name">{n.name}</span>
                {gitKind ? (
                  <span
                    className={
                      "rp-tree__git-badge rp-changes-badge rp-changes-badge--" +
                      gitKind
                    }
                    title={workspaceKindLabel(gitKind)}
                    aria-label={workspaceKindLabel(gitKind)}
                  >
                    {workspaceGitKindBadge(gitKind)}
                  </span>
                ) : null}
              </button>
            </Tip>
            {n.isDir && isOpen && n.children && n.children.length > 0 && (
              <div className="rp-tree__kids">
                {renderTree(n.children, depth + 1)}
              </div>
            )}
          </div>
        );
      });

  const changeStatusLabel = useCallback(
    (status: string) => {
      const s = (status || "").toLowerCase();
      if (s === "completed") return tr("changes.status.completed");
      if (s === "failed" || s === "error") return tr("changes.status.failed");
      if (s === "in_progress" || s === "running")
        return tr("changes.status.in_progress");
      if (s === "pending") return tr("changes.status.pending");
      return status || "";
    },
    [tr],
  );

  const checkpointStatusLabel = useCallback(
    (status: api.CheckpointStatus) => {
      if (status === "ready") return tr("changes.checkpoints.status.ready");
      if (status === "capturing")
        return tr("changes.checkpoints.status.capturing");
      if (status === "partial")
        return tr("changes.checkpoints.status.partial");
      if (status === "reverted")
        return tr("changes.checkpoints.status.reverted");
      return tr("changes.checkpoints.status.failed");
    },
    [tr],
  );

  const previewBodyInner = useMemo(() => {
    // Session change diff takes over the preview when selected in Changes mode.
    if (sideMode === "changes" && diffView) {
      if (diffView.loading) {
        return (
          <div className="rp-preview__msg">{tr("changes.loadingDiff")}</div>
        );
      }
      if (diffView.unified) {
        const srcLabel =
          diffView.source === "git"
            ? tr("changes.sourceGit")
            : diffView.source === "head"
              ? tr("changes.sourceHead")
              : diffView.source === "payload"
                ? tr("changes.sourcePayload")
                : null;
        return (
          <CodePreview
            code={diffView.unified}
            fileName={`${diffView.name}.diff`}
            language="diff"
            footer={srcLabel}
          />
        );
      }
      if (diffView.afterOnly) {
        return (
          <CodePreview
            code={diffView.afterOnly}
            fileName={diffView.name}
            footer={tr("changes.afterOnly")}
          />
        );
      }
      return (
        <div className="rp-changes-empty">
          <div className="rp-changes-empty__title">{tr("changes.noDiff")}</div>
          <div className="rp-changes-empty__hint">{tr("changes.noDiffHint")}</div>
          <div className="rp-changes-empty__actions">
            <button
              type="button"
              className="rp-tool-btn"
              onClick={() => void openChangeInEditor(diffView.path)}
            >
              <IconExternalLink size={14} />
              <span className="rp-tool-btn__label">
                {tr("changes.openInEditor")}
              </span>
            </button>
            <button
              type="button"
              className="rp-tool-btn"
              onClick={() => void revealChangePath(diffView.path)}
            >
              <IconFolder size={14} />
              <span className="rp-tool-btn__label">{tr("changes.reveal")}</span>
            </button>
            <button
              type="button"
              className="rp-tool-btn"
              onClick={() => void copyChangePath(diffView.path)}
            >
              <IconCopy size={14} />
              <span className="rp-tool-btn__label">
                {pathCopyFlash
                  ? tr("changes.pathCopied")
                  : tr("changes.copyPath")}
              </span>
            </button>
          </div>
        </div>
      );
    }

    // URL tabs render via EmbeddedBrowser below (native Webview host).
    // Keep other kinds here so useMemo deps stay correct.
    if (activeTab?.tabKind === "url" && activeTab.url) {
      return null;
    }
    const preview = activeTab?.preview;
    if (!preview) {
      if (activeTab?.error) {
        return <div className="rp-preview__msg">{activeTab.error}</div>;
      }
      return null;
    }
    if (preview.error && !preview.text && !preview.base64 && !preview.stream) {
      return <div className="rp-preview__msg">{preview.error}</div>;
    }
    const mediaSrc = activeTab?.mediaSrc ?? null;
    const dataUrl =
      preview.base64 && preview.mime
        ? `data:${preview.mime};base64,${preview.base64}`
        : null;
    const src = mediaSrc || dataUrl;

    // Text edit mode (Save writes disk; conflict if mtime changed).
    const canEdit = isResourceTextEditable({
      kind: preview.kind,
      text: activeTab?.baselineText ?? preview.text,
      truncated: preview.truncated,
      error: preview.error,
    });
    const showEditor =
      canEdit &&
      !!activeTab &&
      (activeTab.editMode || preview.kind !== "markdown");
    if (showEditor && activeTab.draftText != null) {
      return (
        <div className="rp-editor">
          {preview.truncated ? (
            <div className="rp-editor__banner" role="status">
              {tr("resources.truncated")}
            </div>
          ) : null}
          <textarea
            className="rp-editor__textarea"
            value={activeTab.draftText}
            spellCheck={preview.kind === "markdown" || preview.kind === "text"}
            disabled={!!activeTab.saving}
            aria-label={tr("resources.editorAria", { name: preview.name })}
            onChange={(e) => updateActiveDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                void saveActiveFile();
              }
            }}
          />
          {isResourceDraftDirty(activeTab.draftText, activeTab.baselineText) ? (
            <div className="rp-editor__status" role="status">
              {tr("resources.unsaved")}
            </div>
          ) : null}
        </div>
      );
    }

    // Word / Excel / PDF rich preview
    if (
      isOfficeKind(preview.kind) &&
      preview.absolutePath &&
      preview.kind !== "image"
    ) {
      return (
        <OfficeDocumentPreview
          kind={preview.kind === "office" ? guessOfficeKind(preview.name) : preview.kind}
          absolutePath={preview.absolutePath}
          name={preview.name}
          locale={locale}
          textFallback={preview.text}
          base64={preview.base64}
          errorFromHost={preview.error}
          embedded
        />
      );
    }

    switch (preview.kind) {
      case "image":
        if (
          preview.text &&
          (preview.mime.includes("svg") || preview.name.endsWith(".svg"))
        ) {
          return (
            <div
              className="rp-preview__svg"
              dangerouslySetInnerHTML={{ __html: preview.text }}
            />
          );
        }
        return src ? (
          <ImageUi
            layout="pane"
            className="rp-preview__img"
            src={src}
            alt={preview.name}
            path={preview.absolutePath || undefined}
            labels={{
              viewImage: tr("image.view"),
              copyImage: tr("image.copy"),
              reveal: tr("attach.reveal"),
              copyPath: tr("attach.copyPath"),
            }}
          />
        ) : (
          <div className="rp-preview__msg">{tr("resources.binary")}</div>
        );
      case "pdf":
        // Handled above via OfficeDocumentPreview; keep iframe fallback
        return src ? (
          <iframe
            className="rp-preview__frame"
            title={preview.name}
            src={src}
          />
        ) : (
          <div className="rp-preview__msg">{tr("resources.binary")}</div>
        );
      case "audio":
      case "video":
        return src ? (
          <FileMediaPlayer
            kind={preview.kind}
            src={src}
            mime={preview.mime}
            title={preview.name}
            absolutePath={preview.absolutePath || undefined}
            labels={{
              loadError: tr("media.loadError"),
              openExternal: tr("media.openExternal"),
              loading: tr("resources.loading"),
            }}
          />
        ) : (
          <div className="rp-preview__msg">{tr("resources.binary")}</div>
        );
      case "markdown":
        return (
          <div className="rp-preview__md">
            <MarkdownBody>
              {activeTab?.draftText ?? preview.text ?? ""}
            </MarkdownBody>
          </div>
        );
      case "html":
        // Do not use file:// in iframe — WKWebView/Tauri blocks it (blank page).
        // HtmlBrowser uses srcDoc (host text) or asset fetch; scripts work, full-bleed.
        return (
          <HtmlBrowser
            title={preview.name}
            absolutePath={preview.absolutePath || null}
            html={preview.text}
          />
        );
      case "json": {
        let body = preview.text ?? "";
        try {
          body = JSON.stringify(JSON.parse(body), null, 2);
        } catch {
          /* keep raw */
        }
        return (
          <CodePreview
            code={body}
            fileName={preview.name.endsWith(".json") ? preview.name : "data.json"}
            language="json"
            footer={
              preview.truncated ? tr("resources.truncated") : null
            }
          />
        );
      }
      default:
        if (preview.text) {
          return (
            <CodePreview
              code={preview.text}
              fileName={preview.name}
              footer={
                preview.truncated ? tr("resources.truncated") : null
              }
            />
          );
        }
        return (
          <div className="rp-preview__msg">
            {preview.error || tr("resources.binary")}
            <div className="rp-preview__meta">
              {preview.name} · {formatSize(preview.size)}
            </div>
          </div>
        );
    }
  }, [
    activeTab,
    tr,
    locale,
    sideMode,
    diffView,
    openChangeInEditor,
    revealChangePath,
    copyChangePath,
    pathCopyFlash,
    updateActiveDraft,
    saveActiveFile,
  ]);

  /**
   * One boundary for every previewer.
   *
   * They are lazy, and `previewBody` renders in six different containers —
   * wrapping at the source means none of those sites can forget it and crash
   * the pane when a file first opens.
   */
  const previewBody = (
    <Suspense
      fallback={<div className="rp__empty-state">{tr("common.loading")}</div>}
    >
      {previewBodyInner}
    </Suspense>
  );

  // Empty pane (no open tabs) falls through to the main render below, where
  // `launcherHome` shows the 2×2 launcher grid — with or without a project,
  // matching the IDE reference. Absolute / url tabs still render without one.

  /**
   * Single chrome row (Pi desktop / Codex):
   *   [ file tabs … ] [ open location ] [ tree ] [ close ]
   * No breadcrumb title row — basename lives only in the tab.
   * Nested path is available via tab title attribute.
   */
  return (
    <div
      className="rp"
      data-testid="resource-viewer"
      aria-label={projectName ?? tr("resources.title")}
    >
      <div className="rp-chrome">
        <div className="rp-tabs" role="tablist" aria-label={tr("resources.title")}>
          <div className="rp-tabs__scroll">
            {tabs.map((t) => {
              const active = t.id === activeId;
              const panel = isPanelTabKind(t.tabKind);
              const label = panel
                ? panelTabLabel(t.tabKind as PanelTabKind)
                : isResourceDraftDirty(t.draftText, t.baselineText)
                  ? `• ${t.name}`
                  : t.name;
              const tip = panel
                ? label
                : t.relativePath || t.name;
              return (
                <Tip key={t.id} label={tip}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={tip}
                    className={
                      "rp-tab" +
                      (active ? " is-active" : " is-inactive") +
                      (panel ? " rp-tab--panel" : "") +
                      (t.tabKind === "url" ? " rp-tab--url" : "") +
                      (t.tabKind === "changes" ? " rp-tab--changes" : "")
                    }
                    onClick={() => {
                      setActiveId(t.id);
                      if (t.tabKind === "browser-home") setBrowserHome(true);
                      if (t.tabKind === "changes") {
                        setSideMode("changes");
                        void refreshWorkspaceStatus();
                      }
                      if (t.tabKind === "files") setSideMode("files");
                      if (t.tabKind === "rules") setSideMode("rules");
                      if (t.tabKind === "plan") setSideMode("plan");
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (panel) return;
                      setTabMenu({
                        x: e.clientX,
                        y: e.clientY,
                        tabId: t.id,
                      });
                    }}
                  >
                    {t.tabKind === "changes" ? (
                      <IconFileDiff size={14} />
                    ) : t.tabKind === "browser-home" || t.tabKind === "url" ? (
                      <IconWorld size={14} />
                    ) : t.tabKind === "files" ? (
                      <IconFiles size={14} />
                    ) : t.tabKind === "rules" ? (
                      <IconFileText size={14} />
                    ) : t.tabKind === "plan" ? (
                      <IconPlan size={14} />
                    ) : (
                      <FileKindMark name={t.name} isDir={false} />
                    )}
                    <span className="rp-tab__name">{label}</span>
                    {active || panel ? (
                      <span
                        className="rp-tab__x"
                        role="button"
                        tabIndex={0}
                        title={tr("resources.tabClose")}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            closeTab(t.id);
                          }
                        }}
                      >
                        ×
                      </span>
                    ) : isResourceDraftDirty(t.draftText, t.baselineText) ? (
                      <span className="rp-tab__dirty" aria-hidden>
                        •
                      </span>
                    ) : null}
                  </button>
                </Tip>
              );
            })}
          </div>
          <Tip label={tr("rp.tab.add")}>
            <button
              type="button"
              className="rp-tab-add"
              aria-label={tr("rp.tab.add")}
              aria-haspopup="menu"
              aria-expanded={!!toolMenu}
              onClick={(e) => {
                setToolQuery("");
                setToolMenu({ x: e.clientX, y: e.clientY + 6 });
              }}
            >
              <IconPlus size={15} />
            </button>
          </Tip>
        </div>
        <div className="rp-chrome__actions">
          {activeTabEditable && activeTab ? (
            <>
              {activeTab.preview?.kind === "markdown" ? (
                <div className="rp-seg" role="tablist" aria-label={tr("rp.preview")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!activeTab.editMode}
                    className={
                      "rp-seg__btn" + (!activeTab.editMode ? " is-on" : "")
                    }
                    disabled={!!activeTab.saving}
                    onClick={() =>
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.id === activeTab.id ? { ...t, editMode: false } : t,
                        ),
                      )
                    }
                  >
                    {tr("rp.preview")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!!activeTab.editMode}
                    className={
                      "rp-seg__btn" + (activeTab.editMode ? " is-on" : "")
                    }
                    disabled={!!activeTab.saving}
                    onClick={() =>
                      setTabs((prev) =>
                        prev.map((t) =>
                          t.id === activeTab.id ? { ...t, editMode: true } : t,
                        ),
                      )
                    }
                  >
                    {tr("rp.source")}
                  </button>
                </div>
              ) : null}
              {activeTabDirty ? (
                <Tip label={tr("resources.revert")}>
                  <button
                    type="button"
                    className="chrome-btn"
                    disabled={!!activeTab.saving}
                    onClick={() => revertActiveDraft()}
                  >
                    {tr("resources.revert")}
                  </button>
                </Tip>
              ) : null}
              <Tip label={tr("resources.save")}>
                <button
                  type="button"
                  className={
                    "chrome-btn chrome-btn--save" +
                    (activeTabDirty ? " is-dirty" : "")
                  }
                  disabled={!!activeTab.saving || !activeTabDirty}
                  onClick={() => void saveActiveFile()}
                >
                  {activeTab.saving
                    ? tr("resources.saving")
                    : tr("resources.save")}
                </button>
              </Tip>
            </>
          ) : null}
          {absPath ? (
            <OpenLocationButton
              path={absPath}
              target={openWithTarget}
              onTargetChange={(t) => {
                setOpenWithTarget(t);
                try {
                  localStorage.setItem("pi-app.openTarget", t);
                } catch {
                  /* ignore */
                }
              }}
              onOpenError={(e) => setError(e)}
              compact
              labels={{
                openLocation: tr("main.openLocation"),
                openHint: tr("main.openLocationHint"),
                openMenu: tr("main.openLocationMenu"),
                finder: tr("resources.revealFolder"),
                systemDefault: tr("resources.openDefault"),
                copyPath: tr("attach.copyPath"),
              }}
            />
          ) : null}
          {plan?.visible ? (
            <Tip label={tr("resources.plan")}>
              <button
                type="button"
                className={
                  "chrome-btn main__pane-toggle rp-chrome__plan-btn" +
                  (planPanelActive ? " is-on" : "")
                }
                onClick={() => openPanelTab("plan")}
                aria-label={tr("resources.plan")}
              >
                <IconPlan size={16} />
              </button>
            </Tip>
          ) : null}
          {onClose && (
            <Tip label={tr("common.close")}>
              <button
                type="button"
                className="chrome-btn"
                aria-label={tr("common.close")}
                onClick={onClose}
              >
                <IconClose size={14} />
              </button>
            </Tip>
          )}
        </div>
      </div>

      {error && (
        <div className="rp__error" role="alert">
          {error}
          <Tip label={tr("common.dismiss")}>
            <button
              type="button"
              className="chrome-btn"
              aria-label={tr("common.dismiss")}
              onClick={() => setError(null)}
            >
              <IconClose size={12} />
            </button>
          </Tip>
        </div>
      )}
      {activeTab?.error && (
        <div className="rp__error" role="alert">
          {activeTab.error}
        </div>
      )}

      {toolMenu ? (
        <div
          ref={toolMenuRef}
          className="rp-toolmenu"
          role="menu"
          aria-label={tr("rp.tab.add")}
          style={{
            left: toolMenuPos?.left ?? toolMenu.x,
            top: toolMenuPos?.top ?? toolMenu.y,
          }}
        >
          <form
            className="rp-toolmenu__search"
            onSubmit={(e) => {
              e.preventDefault();
              commitToolQuery();
            }}
          >
            <IconSearch size={14} aria-hidden />
            <input
              className="rp-toolmenu__input"
              type="text"
              autoFocus
              value={toolQuery}
              onChange={(e) => setToolQuery(e.target.value)}
              placeholder={tr("rp.toolMenu.open")}
              aria-label={tr("rp.toolMenu.open")}
            />
          </form>
          <div className="rp-toolmenu__list">
            <button
              type="button"
              role="menuitem"
              className="rp-toolmenu__item"
              onClick={() => {
                setToolMenu(null);
                openPanelTab("terminal");
              }}
            >
              <span className="rp-toolmenu__ico" aria-hidden>
                <IconTerminal size={16} />
              </span>
              <span>{tr("rp.launcher.terminal")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="rp-toolmenu__item"
              onClick={() => {
                setToolMenu(null);
                openPanelTab("browser-home");
              }}
            >
              <span className="rp-toolmenu__ico" aria-hidden>
                <IconWorld size={16} />
              </span>
              <span>{tr("rp.launcher.browser")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="rp-toolmenu__item"
              onClick={() => {
                setToolMenu(null);
                openPanelTab("changes");
              }}
            >
              <span className="rp-toolmenu__ico" aria-hidden>
                <IconFileDiff size={16} />
              </span>
              <span>{tr("rp.launcher.changes")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="rp-toolmenu__item"
              onClick={() => {
                setToolMenu(null);
                openPanelTab("files");
              }}
            >
              <span className="rp-toolmenu__ico" aria-hidden>
                <IconFiles size={16} />
              </span>
              <span>{tr("resources.files")}</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Split: preview | resizer | tree (tree only when explicitly opened) */}
      <div
        ref={splitRef}
        className={
          "rp-split" +
          (treeVisible && !activePanelKind ? "" : " rp-split--solo") +
          (resizingTree ? " is-resizing" : "")
        }
      >
        <div className="rp-split__preview">
          {planPanelActive && plan?.visible ? (
            <PlanReviewPanel
              plan={plan}
              forceExpandKey={planFocusKey}
              labels={{
                ready: tr("plan.ready"),
                waiting: tr("plan.waiting"),
                progress: tr("planBar.progress"),
                done: tr("planBar.done"),
                empty: tr("plan.empty"),
                approve: tr("plan.approve"),
                changes: tr("plan.changes"),
                dismiss: tr("plan.dismiss"),
                steps: tr("plan.steps"),
                fraction: tr("planBar.fraction"),
                expandDetails: tr("plan.expandDetails"),
                collapseDetails: tr("plan.collapseDetails"),
                current: tr("planBar.current"),
              }}
              onApprove={onApprovePlan}
              onRequestChanges={onRequestPlanChanges}
              onDismiss={onDismissPlan}
            />
          ) : planPanelActive ? (
            <div className="rp__empty-state">
              <div className="rp__empty-title">{tr("resources.plan")}</div>
              <div className="rp__empty-desc">{tr("resources.planEmpty")}</div>
            </div>
          ) : changesPanelActive &&
            diffView &&
            (diffView.loading ||
              diffView.unified ||
              diffView.afterOnly ||
              diffView.error) ? (
            <div className="rp-panel-diff">
              <div className="rp-panel-diff__bar">
                <button
                  type="button"
                  className="chrome-btn"
                  onClick={() => {
                    setDiffView(null);
                    setSelectedChangePath(null);
                    setSelectedChangeSource(null);
                  }}
                >
                  ← {tr("changes.title")}
                </button>
                <span className="rp-panel-diff__name" title={diffView.path}>
                  {diffView.name}
                </span>
              </div>
              {diffView.loading ? (
                <div className="rp__empty-state">
                  <div className="rp__empty-desc">
                    {tr("changes.loadingDiff")}
                  </div>
                </div>
              ) : diffView.unified || diffView.afterOnly ? (
                <div className="rp-preview-code-host">{previewBody}</div>
              ) : (
                <div className="rp__empty-state">{previewBody}</div>
              )}
            </div>
          ) : changesPanelActive ? (
            <div className="rp-panel-changes" aria-label={tr("changes.title")}>
              <div className="rp-panel-changes__head">
                <div className="rp-panel-changes__title">
                  <IconFileDiff size={14} aria-hidden />
                  <span>{tr("changes.uncommitted")}</span>
                  {(numstatTotals.added > 0 || numstatTotals.removed > 0) && (
                    <span className="rp-panel-changes__numstat">
                      {numstatTotals.added > 0 ? (
                        <span className="rp-changes-numstat__add">
                          +{numstatTotals.added}
                        </span>
                      ) : null}
                      {numstatTotals.removed > 0 ? (
                        <span className="rp-changes-numstat__del">
                          −{numstatTotals.removed}
                        </span>
                      ) : null}
                    </span>
                  )}
                  {workspaceBranch ? (
                    <span className="rp-panel-changes__branch">
                      {workspaceBranch}
                    </span>
                  ) : null}
                </div>
                <div className="rp-panel-changes__actions">
                  <Tip label={tr("changes.workspace.refresh")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      disabled={workspaceLoading}
                      onClick={() => void refreshWorkspaceStatus()}
                    >
                      <IconRefresh size={14} />
                    </button>
                  </Tip>
                  {workspaceAvailable && workspaceCount > 0 ? (
                    <button
                      type="button"
                      className="rp-panel-changes__commit"
                      disabled={commitBusy || workspaceLoading}
                      onClick={() => {
                        setCommitError(null);
                        setCommitOpen(true);
                      }}
                    >
                      {tr("changes.commitPush")}
                    </button>
                  ) : null}
                </div>
              </div>
              <OverlayScroll className="rp-panel-changes__scroll">
                {workspaceLoading && workspaceFiles.length === 0 ? (
                  <div className="rp-changes-section__empty">
                    {tr("changes.workspace.loading")}
                  </div>
                ) : !workspaceAvailable ? (
                  <div className="rp-changes-section__empty">
                    {workspaceUnavailableLabel()}
                  </div>
                ) : filteredWorkspace.length === 0 ? (
                  <div className="rp-changes-section__empty">
                    {tr("changes.workspace.empty")}
                  </div>
                ) : (
                  <div className="rp-panel-changes__list" role="list">
                    {filteredWorkspace.map((w) => {
                      const abs =
                        normalizePath(w.absolutePath) ||
                        resolveWorkspaceAbsolutePath(projectPath, w.path);
                      const staged = isWorkspaceStaged(w);
                      const stats = numstatMap.get(
                        normalizePath(w.path).toLowerCase(),
                      );
                      const rowBusy = gitBusyPath === w.path;
                      const canDiscard = canDiscardWorkspaceEntry(w);
                      const kindPill =
                        w.kind === "untracked" || w.kind === "added"
                          ? tr("changes.kindNew")
                          : w.kind === "deleted"
                            ? tr("changes.kindDeleted")
                            : w.kind === "modified" || w.kind === "typechange"
                              ? tr("changes.kindModified")
                              : workspaceKindLabel(w.kind);
                      return (
                        <div
                          key={`ws:${w.path}`}
                          className={
                            "rp-panel-changes__row" +
                            (staged ? " is-staged" : "")
                          }
                          role="listitem"
                        >
                          <button
                            type="button"
                            className="rp-panel-changes__main"
                            title={abs || w.path}
                            onClick={() => void loadWorkspaceDiff(w)}
                          >
                            <FileKindMark name={w.name} isDir={false} />
                            <span className="rp-panel-changes__fname">
                              {w.path}
                            </span>
                            {stats &&
                            (stats.added > 0 || stats.removed > 0) ? (
                              <span className="rp-panel-changes__stats">
                                {stats.added > 0 ? (
                                  <span className="rp-changes-numstat__add">
                                    +{stats.added}
                                  </span>
                                ) : null}
                                {stats.removed > 0 ? (
                                  <span className="rp-changes-numstat__del">
                                    −{stats.removed}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                            <span
                              className={
                                "rp-panel-changes__pill rp-panel-changes__pill--" +
                                w.kind
                              }
                            >
                              {kindPill}
                            </span>
                          </button>
                          <div className="rp-panel-changes__row-actions">
                            {canDiscard ? (
                              <Tip label={tr("changes.revert")}>
                                <button
                                  type="button"
                                  className="chrome-btn"
                                  disabled={rowBusy || discardBusy}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDiscardTarget(w);
                                  }}
                                >
                                  <IconArrowBackUp size={14} />
                                </button>
                              </Tip>
                            ) : null}
                            <Tip
                              label={
                                staged
                                  ? tr("changes.unstage")
                                  : tr("changes.stage")
                              }
                            >
                              <button
                                type="button"
                                className={
                                  "rp-changes-stage" +
                                  (staged ? " is-checked" : "")
                                }
                                disabled={rowBusy}
                                aria-pressed={staged}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void toggleWorkspaceStage(w);
                                }}
                              >
                                {staged ? <IconCheck size={11} /> : null}
                              </button>
                            </Tip>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </OverlayScroll>
            </div>
          ) : terminalPanelActive ? (
            <Suspense
              fallback={
                <div className="rp__empty-state">
                  {tr("common.loading")}
                </div>
              }
            >
              <EmbeddedTerminal projectPath={projectPath} locale={locale} />
            </Suspense>
          ) : browserHomeView ? (
              <div className="rp-browser-home" aria-label={tr("rp.browser.home")}>
                <form
                  className="rp-browser-bar"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const u = normalizeBrowserUrl(browserUrlInput);
                    if (!u) return;
                    openUrl(u);
                    setBrowserUrlInput("");
                  }}
                >
                  <span className="rp-browser-bar__ico" aria-hidden>
                    <IconWorld size={16} />
                  </span>
                  <input
                    className="rp-browser-bar__input"
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    value={browserUrlInput}
                    onChange={(e) => setBrowserUrlInput(e.target.value)}
                    placeholder={tr("rp.browser.placeholder")}
                    aria-label={tr("rp.browser.placeholder")}
                  />
                  <button
                    type="submit"
                    className="rp-browser-bar__go"
                    disabled={!browserUrlInput.trim()}
                  >
                    {tr("rp.browser.go")}
                  </button>
                </form>
                <div className="rp-browser-dials" role="list">
                  {BROWSER_DIALS.map((d) => (
                    <button
                      key={d.url}
                      type="button"
                      role="listitem"
                      className="rp-browser-dial"
                      title={d.url}
                      onClick={() => openUrl(d.url)}
                    >
                      <span className="rp-browser-dial__mark" aria-hidden>
                        {d.mark}
                      </span>
                      <span className="rp-browser-dial__name">{d.name}</span>
                    </button>
                  ))}
                </div>
              </div>
          ) : filesPanelActive ? (
            <div className="rp-panel-files">
              <div className="rp-tree-search">
                <IconSearch size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("resources.filterPh")}
                  aria-label={tr("resources.filterPh")}
                />
              </div>
              <OverlayScroll className="rp-tree-scroll">
                {loadingTree ? (
                  <div className="rp__empty-state rp__empty-state--sm">
                    {tr("resources.loading")}
                  </div>
                ) : root.length === 0 ? (
                  <div className="rp__empty-state rp__empty-state--sm">
                    {tr("resources.empty")}
                  </div>
                ) : (
                  renderTree(root, 0)
                )}
              </OverlayScroll>
            </div>
          ) : rulesPanelActive ? (
            <div className="rp-panel-files">
              <div className="rp-tree-search">
                <IconSearch size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("resources.filterPh")}
                  aria-label={tr("resources.filterPh")}
                />
              </div>
              <OverlayScroll className="rp-tree-scroll">
                <div className="rp-changes-list rp-rules-list" role="list">
                  {/* rules list reused from side panel below via empty fallback note */}
                  {filteredRules.length === 0 ? (
                    <div className="rp-changes-section__empty">
                      {tr("rules.emptyHint")}
                    </div>
                  ) : (
                    filteredRules.map((r: any) => (
                      <div
                        key={r.relativePath || r.path || r.name}
                        className="rp-changes-row"
                        role="listitem"
                      >
                        <button
                          type="button"
                          className="rp-changes-row__main"
                          onClick={() =>
                            void openFile(
                              r.relativePath || r.path || "",
                            )
                          }
                        >
                          <IconFileText size={14} />
                          <span className="rp-changes-row__meta">
                            <span className="rp-changes-row__name">
                              {r.name || r.relativePath}
                            </span>
                            <span className="rp-changes-row__path">
                              {r.relativePath || r.path || ""}
                            </span>
                          </span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </OverlayScroll>
            </div>
          ) : launcherHome ? (
              <div
                className="rp-launcher"
                role="group"
                aria-label={tr("rp.launcher.hint")}
              >
                <div className="rp-launcher__grid">
                  <button
                    type="button"
                    className="rp-launcher__card"
                    onClick={() => openPanelTab("changes")}
                  >
                    <span className="rp-launcher__ico" aria-hidden>
                      <IconFileDiff size={22} />
                    </span>
                    <span className="rp-launcher__label">
                      {tr("rp.launcher.changes")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rp-launcher__card"
                    onClick={() => openPanelTab("browser-home")}
                  >
                    <span className="rp-launcher__ico" aria-hidden>
                      <IconWorld size={22} />
                    </span>
                    <span className="rp-launcher__label">
                      {tr("rp.launcher.browser")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rp-launcher__card"
                    aria-label={tr("rp.launcher.terminal")}
                    onClick={() => openPanelTab("terminal")}
                  >
                    <span className="rp-launcher__ico" aria-hidden>
                      <IconTerminal size={22} />
                    </span>
                    <span className="rp-launcher__label">
                      {tr("rp.launcher.terminal")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rp-launcher__card"
                    onClick={() => openPanelTab("files")}
                  >
                    <span className="rp-launcher__ico" aria-hidden>
                      <IconFiles size={22} />
                    </span>
                    <span className="rp-launcher__label">
                      {tr("resources.files")}
                    </span>
                  </button>
                </div>
              </div>
          ) : !activeTab ? (
              <div className="rp__empty-state">
                <div className="rp__empty-title">
                  {tr("resources.emptyPreview")}
                </div>
                <div className="rp__empty-desc">
                  {tr("resources.emptyPreviewHint")}
                </div>
              </div>
          ) : activeTab.loading ? (
            <div className="rp__empty-state">
              <div className="rp__empty-desc">{tr("resources.loading")}</div>
            </div>
          ) : activeTab.tabKind === "url" && activeTab.url ? (
            /* Native child Webview over host (GitHub etc. block iframe) */
            <div className="rp-preview-browser rp-preview-browser--url">
              <EmbeddedBrowser
                url={activeTab.url}
                title={activeTab.name}
                locale={locale}
                active
                onNavigate={navigateActiveTab}
                navLabels={{
                  back: tr("browser.back"),
                  forward: tr("browser.forward"),
                  reload: tr("resources.browserReload"),
                  openExternal: tr("resources.openExternal"),
                  address: tr("browser.address"),
                  soon: tr("browser.soon"),
                }}
              />
            </div>
          ) : activeTab.preview?.kind === "html" ? (
            <div className="rp-preview-browser">{previewBody}</div>
          ) : activeTab.preview &&
            isOfficeKind(activeTab.preview.kind) &&
            activeTab.preview.kind !== "image" ? (
            <div className="rp-preview-office">{previewBody}</div>
          ) : activeTab.preview?.text &&
            (activeTab.preview.kind === "json" ||
              activeTab.preview.kind === "text" ||
              activeTab.preview.kind === "code" ||
              // host may classify source as generic text
              (!["markdown", "html", "image", "audio", "video"].includes(
                activeTab.preview.kind,
              ) &&
                !!activeTab.preview.text)) ? (
            <div className="rp-preview-code-host">{previewBody}</div>
          ) : (
            <OverlayScroll className="rp-preview-scroll">
              <div className="rp-preview-body">{previewBody}</div>
            </OverlayScroll>
          )}
        </div>

        {treeVisible && (
          <>
            <div
              className="rp-split__resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label={tr("resources.resizeTree")}
              aria-valuenow={treeWidth}
              onPointerDown={(e) => {
                e.preventDefault();
                setResizingTree(true);
              }}
            />
            <div
              className="rp-split__tree"
              style={{
                width: treeWidth,
                flex: `0 0 ${treeWidth}px`,
                maxWidth: treeWidth,
                minWidth: TREE_WIDTH_MIN,
              }}
            >
              <div className="rp-side-modes" role="tablist" aria-label={tr("resources.title")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sideMode === "files"}
                  className={
                    "rp-side-modes__btn" + (sideMode === "files" ? " is-active" : "")
                  }
                  onClick={() => setSideMode("files")}
                >
                  {tr("changes.files")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sideMode === "rules"}
                  className={
                    "rp-side-modes__btn" +
                    (sideMode === "rules" ? " is-active" : "")
                  }
                  onClick={() => setSideMode("rules")}
                >
                  {tr("rules.title")}
                  {projectRules.length > 0 ? (
                    <span className="rp-side-modes__count">
                      {projectRules.length}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sideMode === "changes"}
                  className={
                    "rp-side-modes__btn" +
                    (sideMode === "changes" ? " is-active" : "")
                  }
                  onClick={() => setSideMode("changes")}
                >
                  {tr("changes.title")}
                  {totalChangeBadge > 0 ? (
                    <span className="rp-side-modes__count">
                      {totalChangeBadge}
                    </span>
                  ) : null}
                </button>
                {plan?.visible ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sideMode === "plan"}
                    className={
                      "rp-side-modes__btn" +
                      (sideMode === "plan" ? " is-active" : "")
                    }
                    onClick={() => showSidePanel("plan")}
                  >
                    {tr("resources.plan")}
                  </button>
                ) : null}
              </div>
              <div className="rp-tree-search">
                <IconSearch size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("resources.filterPh")}
                  aria-label={tr("resources.filterPh")}
                />
                {sideMode === "files" ? (
                  <Tip label={tr("resources.refresh")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={() => void refresh()}
                    >
                      <IconRefresh size={14} />
                    </button>
                  </Tip>
                ) : sideMode === "rules" ? (
                  <Tip label={tr("rules.refresh")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={() =>
                        void Promise.all([
                          refreshProjectRules(),
                          refreshRepositoryTrust(),
                        ])
                      }
                      disabled={rulesLoading || repositoryTrustLoading}
                    >
                      <IconRefresh size={14} />
                    </button>
                  </Tip>
                ) : (
                  <Tip label={tr("changes.workspace.refresh")}>
                    <button
                      type="button"
                      className="chrome-btn"
                      onClick={() => void refreshWorkspaceStatus()}
                      disabled={workspaceLoading}
                    >
                      <IconRefresh size={14} />
                    </button>
                  </Tip>
                )}
              </div>
              <OverlayScroll className="rp-tree-scroll">
                {sideMode === "rules" ? (
                  <div className="rp-changes-list rp-rules-list" role="list">
                    <div className="rp-changes-section rp-repository-trust">
                      <div className="rp-changes-section__head">
                        <span className="rp-changes-section__title">
                          {tr("repositoryTrust.title")}
                        </span>
                        {repositoryTrust ? (
                          <span className="rp-repository-trust__status">
                            {repositoryTrustStatusLabel(
                              repositoryTrust.status,
                            )}
                          </span>
                        ) : null}
                      </div>
                      {repositoryTrustLoading && !repositoryTrust ? (
                        <div className="rp-changes-section__empty">
                          {tr("repositoryTrust.loading")}
                        </div>
                      ) : repositoryTrust ? (
                        <>
                          <div className="rp-repository-trust__meta">
                            <button
                              type="button"
                              className="rp-repository-trust__path"
                              disabled={repositoryTrust.status === "missing"}
                              onClick={() =>
                                void openFile(".pi/project.json")
                              }
                            >
                              .pi/project.json
                            </button>
                            {repositoryTrust.shortDigest ? (
                              <button
                                type="button"
                                className="rp-repository-trust__digest"
                                title={tr("repositoryTrust.copyDigest")}
                                aria-label={tr(
                                  "repositoryTrust.copyDigest",
                                )}
                                onClick={() => {
                                  if (!repositoryTrust.digest) return;
                                  void navigator.clipboard
                                    .writeText(repositoryTrust.digest)
                                    .then(() =>
                                      setRulesHint(
                                        tr(
                                          "repositoryTrust.digestCopied",
                                        ),
                                      ),
                                    );
                                }}
                              >
                                {repositoryTrust.shortDigest}
                              </button>
                            ) : null}
                          </div>
                          <div className="rp-repository-trust__summary">
                            {repositoryTrustStatusLabel(
                              repositoryTrust.status,
                            )}
                          </div>
                          {repositoryTrust.status === "invalid" ? (
                            <div
                              className="rp-repository-trust__error"
                              role="alert"
                            >
                              {tr("repositoryTrust.invalidHint")}
                            </div>
                          ) : null}
                          {repositoryTrustError ? (
                            <div
                              className="rp-repository-trust__error"
                              role="alert"
                            >
                              {repositoryTrustError}
                            </div>
                          ) : null}
                          {repositoryTrust.contributions.length > 0 ? (
                            <div
                              className="rp-repository-trust__entries"
                              aria-label={tr(
                                "repositoryTrust.contributions",
                              )}
                            >
                              {repositoryTrust.contributions.map(
                                (entry) => (
                                  <div
                                    key={`${entry.kind}:${entry.id}`}
                                    className="rp-repository-trust__entry"
                                    role="listitem"
                                  >
                                    <div className="rp-repository-trust__entry-head">
                                      <strong>{entry.id}</strong>
                                      <span>
                                        {repositoryContributionKindLabel(
                                          entry.kind,
                                        )}
                                      </span>
                                    </div>
                                    {entry.executable ? (
                                      <div>
                                        <span>
                                          {tr(
                                            "repositoryTrust.executable",
                                          )}
                                        </span>
                                        <code>{entry.executable}</code>
                                      </div>
                                    ) : null}
                                    {entry.args.length > 0 ? (
                                      <div>
                                        <span>
                                          {tr("repositoryTrust.arguments")}
                                        </span>
                                        <code>
                                          {entry.args.join(" ")}
                                        </code>
                                      </div>
                                    ) : null}
                                    {entry.cwd ? (
                                      <div>
                                        <span>
                                          {tr("repositoryTrust.cwd")}
                                        </span>
                                        <code>{entry.cwd}</code>
                                      </div>
                                    ) : null}
                                    {entry.envNames.length > 0 ? (
                                      <div>
                                        <span>
                                          {tr(
                                            "repositoryTrust.environment",
                                          )}
                                        </span>
                                        <code>
                                          {entry.envNames.join(", ")}
                                        </code>
                                      </div>
                                    ) : null}
                                    {entry.networkHosts.length > 0 ? (
                                      <div>
                                        <span>
                                          {tr("repositoryTrust.network")}
                                        </span>
                                        <code>
                                          {entry.networkHosts.join(", ")}
                                        </code>
                                      </div>
                                    ) : null}
                                    {entry.files.length > 0 ? (
                                      <div>
                                        <span>
                                          {tr("repositoryTrust.files")}
                                        </span>
                                        <code>
                                          {entry.files.join(", ")}
                                        </code>
                                      </div>
                                    ) : null}
                                  </div>
                                ),
                              )}
                            </div>
                          ) : null}
                          {repositoryTrust.canApprove &&
                          repositoryTrust.digest &&
                          ![
                            "trusted",
                            "trusted-once",
                            "invalid",
                            "missing",
                          ].includes(repositoryTrust.status) ? (
                            <div className="rp-repository-trust__actions">
                              <button
                                type="button"
                                className="rp-repository-trust__action"
                                disabled={repositoryTrustBusy}
                                onClick={() =>
                                  void changeRepositoryTrust("once")
                                }
                              >
                                {tr("repositoryTrust.trustOnce")}
                              </button>
                              <button
                                type="button"
                                className="rp-repository-trust__action"
                                disabled={repositoryTrustBusy}
                                onClick={() =>
                                  void changeRepositoryTrust("digest")
                                }
                              >
                                {tr("repositoryTrust.trustDigest")}
                              </button>
                              {repositoryTrust.status !== "rejected" ? (
                                <button
                                  type="button"
                                  className="rp-repository-trust__action rp-repository-trust__action--reject"
                                  disabled={repositoryTrustBusy}
                                  onClick={() =>
                                    void changeRepositoryTrust("reject")
                                  }
                                >
                                  {tr("repositoryTrust.reject")}
                                </button>
                              ) : null}
                            </div>
                          ) : ["trusted", "trusted-once"].includes(
                              repositoryTrust.status,
                            ) ? (
                            <div className="rp-repository-trust__actions">
                              <button
                                type="button"
                                className="rp-repository-trust__action rp-repository-trust__action--reject"
                                disabled={repositoryTrustBusy}
                                onClick={() =>
                                  void changeRepositoryTrust("revoke")
                                }
                              >
                                {tr("repositoryTrust.revoke")}
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : repositoryTrustError ? (
                        <div
                          className="rp-repository-trust__error"
                          role="alert"
                        >
                          {repositoryTrustError}
                        </div>
                      ) : null}
                    </div>
                    <div className="rp-changes-section">
                      <div className="rp-changes-section__head">
                        <span className="rp-changes-section__title">
                          {tr("rules.title")}
                        </span>
                        {projectRules.length > 0 ? (
                          <span className="rp-changes-section__count">
                            {projectRules.length}
                          </span>
                        ) : null}
                      </div>
                      <div className="rp-rules-actions">
                        <button
                          type="button"
                          className="btn btn--ghost rp-rules-actions__btn"
                          onClick={() => void ensureAgentsTemplate()}
                          disabled={!projectPath || rulesLoading}
                        >
                          <IconPlus size={14} />
                          <span>{tr("rules.createTemplate")}</span>
                        </button>
                      </div>
                      {rulesHint ? (
                        <div className="rp-rules-hint" role="status">
                          {rulesHint}
                        </div>
                      ) : null}
                      {rulesLoading && projectRules.length === 0 ? (
                        <div className="rp-changes-section__empty">
                          {tr("rules.loading")}
                        </div>
                      ) : filteredRules.length === 0 ? (
                        <div className="rp-changes-section__empty">
                          <div>{tr("rules.empty")}</div>
                          <div className="rp-rules-empty-hint">
                            {tr("rules.emptyHint")}
                          </div>
                        </div>
                      ) : (
                        filteredRules.map((r) => {
                          const active =
                            activeTab?.tabKind !== "url" &&
                            (activeTab?.relativePath === r.relativePath ||
                              activeTab?.absolutePath === r.absolutePath);
                          return (
                            <div
                              key={r.relativePath}
                              className={
                                "rp-changes-row" + (active ? " is-active" : "")
                              }
                              role="listitem"
                            >
                              <button
                                type="button"
                                className="rp-changes-row__main"
                                title={r.absolutePath || r.relativePath}
                                onClick={() => void openRuleFile(r)}
                              >
                                <FileKindMark name={r.name} isDir={false} />
                                <span className="rp-changes-row__meta">
                                  <span className="rp-changes-row__name">
                                    {r.name}
                                  </span>
                                  <span className="rp-changes-row__path">
                                    {r.relativePath}
                                  </span>
                                  <span className="rp-changes-row__kind">
                                    {ruleKindLabel(r.kind)}
                                  </span>
                                </span>
                              </button>
                              <div className="rp-changes-row__actions">
                                <Tip label={tr("rules.reveal")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void revealChangePath(
                                        r.absolutePath || r.relativePath,
                                      );
                                    }}
                                  >
                                    <IconFolder size={13} />
                                  </button>
                                </Tip>
                              </div>
                            </div>
                          );
                        })
                      )}
                      {!rulesHasAgents && projectRules.length > 0 ? (
                        <div className="rp-rules-empty-hint rp-rules-empty-hint--footer">
                          {tr("rules.noAgentsHint")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : sideMode === "changes" ? (
                  <div className="rp-changes-list" role="list">
                    <div className="rp-changes-section rp-checkpoints">
                      <div className="rp-changes-section__head">
                        <span className="rp-changes-section__title">
                          {tr("changes.checkpoints.title")}
                        </span>
                        {turnCheckpoints.length > 0 ? (
                          <span className="rp-changes-section__count">
                            {turnCheckpoints.length}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="rp-checkpoints__refresh"
                          disabled={remoteRuntime || checkpointsLoading || checkpointBusy}
                          onClick={() => void refreshCheckpoints()}
                        >
                          {tr("common.refresh")}
                        </button>
                      </div>
                      {checkpointError ? (
                        <div className="rp-checkpoints__error" role="alert">
                          {checkpointError}
                        </div>
                      ) : null}
                      {checkpointsLoading && turnCheckpoints.length === 0 ? (
                        <div className="rp-changes-section__empty">
                          {tr("common.loading")}
                        </div>
                      ) : turnCheckpoints.length === 0 ? (
                        <div className="rp-changes-section__empty">
                          {remoteRuntime
                            ? tr("changes.checkpoints.remoteUnavailable")
                            : tr("changes.checkpoints.empty")}
                        </div>
                      ) : (
                        turnCheckpoints.slice(0, 8).map((checkpoint) => (
                          <div
                            className="rp-checkpoint-row"
                            key={checkpoint.id}
                            role="listitem"
                          >
                            <div className="rp-checkpoint-row__copy">
                              <strong>
                                {checkpointDateFormatter.format(
                                  new Date(checkpoint.updatedAt),
                                )}
                              </strong>
                              <span>
                                {checkpointStatusLabel(checkpoint.status)}
                                {" · "}
                                {tr("changes.checkpoints.files", {
                                  n: String(checkpoint.changedPaths.length),
                                })}
                              </span>
                            </div>
                            {checkpoint.status === "ready" &&
                            checkpoint.changedPaths.length > 0 ? (
                              <button
                                type="button"
                                className="rp-checkpoint-row__review"
                                disabled={checkpointBusy}
                                onClick={() =>
                                  void reviewCheckpointRevert(checkpoint)
                                }
                              >
                                {checkpointBusy
                                  ? tr("changes.checkpoints.previewing")
                                  : tr("changes.checkpoints.review")}
                              </button>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>

                    {/* ── Session (agent tool edits) ── */}
                    <div className="rp-changes-section">
                      <div className="rp-changes-section__head">
                        <span className="rp-changes-section__title">
                          {tr("changes.section.session")}
                        </span>
                        {changeCount > 0 ? (
                          <span className="rp-changes-section__count">
                            {changeCount}
                          </span>
                        ) : null}
                      </div>
                      {filteredChanges.length === 0 ? (
                        <div className="rp-changes-section__empty">
                          {tr("changes.empty")}
                        </div>
                      ) : (
                        filteredChanges.map((c) => {
                          const active =
                            selectedChangeSource === "session" &&
                            selectedChangePath != null &&
                            normalizePath(c.path) ===
                              normalizePath(selectedChangePath);
                          const rel =
                            pathRelativeToProject(c.path, projectPath) ||
                            c.path;
                          return (
                            <div
                              key={`session:${c.path}`}
                              className={
                                "rp-changes-row" +
                                (active ? " is-active" : "")
                              }
                              role="listitem"
                            >
                              <button
                                type="button"
                                className="rp-changes-row__main"
                                title={c.path}
                                onClick={() => void loadChangeDiff(c)}
                              >
                                <FileKindMark name={c.name} isDir={false} />
                                <span className="rp-changes-row__meta">
                                  <span className="rp-changes-row__name">
                                    {c.name}
                                  </span>
                                  <span className="rp-changes-row__path">
                                    {rel}
                                  </span>
                                  <span className="rp-changes-row__kind">
                                    {c.toolKind}
                                    {c.status
                                      ? ` · ${changeStatusLabel(c.status)}`
                                      : ""}
                                  </span>
                                </span>
                              </button>
                              <div className="rp-changes-row__actions">
                                <Tip label={tr("changes.openInEditor")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void openChangeInEditor(c.path);
                                    }}
                                  >
                                    <IconExternalLink size={13} />
                                  </button>
                                </Tip>
                                <Tip label={tr("changes.reveal")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void revealChangePath(c.path);
                                    }}
                                  >
                                    <IconFolder size={13} />
                                  </button>
                                </Tip>
                                <Tip label={tr("changes.copyPath")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void copyChangePath(c.path);
                                    }}
                                  >
                                    <IconCopy size={13} />
                                  </button>
                                </Tip>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* ── Workspace (git status) ── */}
                    <div className="rp-changes-section">
                      <div className="rp-changes-section__head">
                        <span className="rp-changes-section__title">
                          {tr("changes.section.workspace")}
                        </span>
                        {workspaceCount > 0 ? (
                          <span className="rp-changes-section__count">
                            {workspaceCount}
                          </span>
                        ) : null}
                        {numstatTotals.added > 0 ||
                        numstatTotals.removed > 0 ? (
                          <span className="rp-changes-section__numstat">
                            {numstatTotals.added > 0 ? (
                              <span className="rp-changes-numstat__add">
                                +{numstatTotals.added}
                              </span>
                            ) : null}
                            {numstatTotals.removed > 0 ? (
                              <span className="rp-changes-numstat__del">
                                −{numstatTotals.removed}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                        {workspaceBranch ? (
                          <span
                            className="rp-changes-section__branch"
                            title={tr("changes.workspace.branch", {
                              branch: workspaceBranch,
                            })}
                          >
                            {workspaceBranch}
                          </span>
                        ) : null}
                        {workspaceAvailable && workspaceCount > 0 ? (
                          <button
                            type="button"
                            className="rp-changes-commit-btn"
                            disabled={commitBusy || workspaceLoading}
                            onClick={() => {
                              setCommitError(null);
                              setCommitOpen(true);
                            }}
                          >
                            <IconUpload size={12} />
                            <span>{tr("changes.commitPush")}</span>
                          </button>
                        ) : null}
                      </div>
                      {workspaceLoading && workspaceFiles.length === 0 ? (
                        <div className="rp-changes-section__empty">
                          {tr("changes.workspace.loading")}
                        </div>
                      ) : !workspaceAvailable ? (
                        <div className="rp-changes-section__empty">
                          {workspaceUnavailableLabel()}
                        </div>
                      ) : filteredWorkspace.length === 0 ? (
                        <div className="rp-changes-section__empty">
                          {tr("changes.workspace.empty")}
                        </div>
                      ) : (
                        filteredWorkspace.map((w) => {
                          const abs =
                            normalizePath(w.absolutePath) ||
                            resolveWorkspaceAbsolutePath(
                              projectPath,
                              w.path,
                            );
                          const active =
                            selectedChangeSource === "workspace" &&
                            selectedChangePath != null &&
                            (normalizePath(selectedChangePath) === abs ||
                              normalizePath(selectedChangePath) ===
                                normalizePath(w.path));
                          const staged = isWorkspaceStaged(w);
                          const stats = numstatMap.get(
                            normalizePath(w.path).toLowerCase(),
                          );
                          const rowBusy = gitBusyPath === w.path;
                          const canDiscard = canDiscardWorkspaceEntry(w);
                          return (
                            <div
                              key={`ws:${w.path}`}
                              className={
                                "rp-changes-row" +
                                (active ? " is-active" : "") +
                                (staged ? " is-staged" : "")
                              }
                              role="listitem"
                            >
                              <button
                                type="button"
                                className="rp-changes-row__main"
                                title={abs || w.path}
                                onClick={() => void loadWorkspaceDiff(w)}
                              >
                                <span
                                  className={
                                    "rp-changes-badge rp-changes-badge--" +
                                    w.kind
                                  }
                                  aria-hidden
                                >
                                  {workspaceGitKindBadge(w.kind)}
                                </span>
                                <span className="rp-changes-row__meta">
                                  <span className="rp-changes-row__name">
                                    {w.name}
                                  </span>
                                  <span className="rp-changes-row__path">
                                    {w.path}
                                  </span>
                                  <span className="rp-changes-row__kind">
                                    {workspaceKindLabel(w.kind)}
                                    {w.status.trim()
                                      ? ` · ${w.status}`
                                      : ""}
                                  </span>
                                </span>
                                {stats &&
                                (stats.added > 0 || stats.removed > 0) ? (
                                  <span className="rp-changes-row__numstat">
                                    {stats.added > 0 ? (
                                      <span className="rp-changes-numstat__add">
                                        +{stats.added}
                                      </span>
                                    ) : null}
                                    {stats.removed > 0 ? (
                                      <span className="rp-changes-numstat__del">
                                        −{stats.removed}
                                      </span>
                                    ) : null}
                                  </span>
                                ) : null}
                              </button>
                              <div className="rp-changes-row__actions rp-changes-row__actions--git">
                                {canDiscard ? (
                                  <Tip label={tr("changes.revert")}>
                                    <button
                                      type="button"
                                      className="chrome-btn"
                                      disabled={rowBusy || discardBusy}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDiscardTarget(w);
                                      }}
                                    >
                                      <IconArrowBackUp size={13} />
                                    </button>
                                  </Tip>
                                ) : null}
                                <Tip
                                  label={
                                    staged
                                      ? tr("changes.unstage")
                                      : tr("changes.stage")
                                  }
                                >
                                  <button
                                    type="button"
                                    className={
                                      "rp-changes-stage" +
                                      (staged ? " is-checked" : "")
                                    }
                                    disabled={rowBusy}
                                    aria-pressed={staged}
                                    aria-label={
                                      staged
                                        ? tr("changes.unstage")
                                        : tr("changes.stage")
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void toggleWorkspaceStage(w);
                                    }}
                                  >
                                    {staged ? (
                                      <IconCheck size={11} />
                                    ) : null}
                                  </button>
                                </Tip>
                                <Tip label={tr("changes.openInEditor")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void openChangeInEditor(abs || w.path);
                                    }}
                                  >
                                    <IconExternalLink size={13} />
                                  </button>
                                </Tip>
                                <Tip label={tr("changes.reveal")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void revealChangePath(abs || w.path);
                                    }}
                                  >
                                    <IconFolder size={13} />
                                  </button>
                                </Tip>
                                <Tip label={tr("changes.copyPath")}>
                                  <button
                                    type="button"
                                    className="chrome-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void copyChangePath(abs || w.path);
                                    }}
                                  >
                                    <IconCopy size={13} />
                                  </button>
                                </Tip>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : loadingTree ? (
                  <div className="rp__empty-state rp__empty-state--sm">
                    {tr("resources.loading")}
                  </div>
                ) : root.length === 0 ? (
                  <div className="rp__empty-state rp__empty-state--sm">
                    {tr("resources.empty")}
                  </div>
                ) : (
                  renderTree(root, 0)
                )}
              </OverlayScroll>
            </div>
          </>
        )}
      </div>

      {/* Chrome-style tab context menu */}
      {(() => {
        const idx = tabMenu
          ? tabs.findIndex((t) => t.id === tabMenu.tabId)
          : -1;
        const hasLeft = idx > 0;
        const hasRight = idx >= 0 && idx < tabs.length - 1;
        const hasOthers = tabs.length > 1;
        const tabId = tabMenu?.tabId ?? "";
        const items: ContextMenuItem[] = [
          {
            id: "close",
            label: tr("resources.tabClose"),
            onClick: () => closeTab(tabId),
          },
          {
            id: "close-others",
            label: tr("resources.tabCloseOthers"),
            disabled: !hasOthers,
            onClick: () => closeOtherTabs(tabId),
          },
          {
            id: "close-right",
            label: tr("resources.tabCloseRight"),
            disabled: !hasRight,
            onClick: () => closeTabsToRight(tabId),
          },
          {
            id: "close-left",
            label: tr("resources.tabCloseLeft"),
            disabled: !hasLeft,
            onClick: () => closeTabsToLeft(tabId),
          },
          {
            id: "close-all",
            label: tr("resources.tabCloseAll"),
            onClick: () => closeAllTabs(),
          },
        ];
        return (
          <ContextMenu
            open={!!tabMenu}
            x={tabMenu?.x ?? 0}
            y={tabMenu?.y ?? 0}
            onClose={() => setTabMenu(null)}
            items={items}
            className="rp-tab-menu"
          />
        );
      })()}

      <GlassModal
        open={commitOpen}
        onClose={() => {
          if (!commitBusy) {
            setCommitOpen(false);
            setCommitError(null);
          }
        }}
        title={tr("changes.commitTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!commitBusy}
        showClose={!commitBusy}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={commitBusy}
              onClick={() => {
                setCommitOpen(false);
                setCommitError(null);
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={commitBusy || !commitMsg.trim()}
              onClick={() => void runCommitAndPush()}
            >
              {commitBusy
                ? commitPhase === "pr"
                  ? tr("changes.openingPr")
                  : commitPhase === "push"
                    ? tr("changes.pushing")
                    : tr("changes.committing")
                : openPrAfterPush
                  ? tr("changes.commitPushPr")
                  : tr("changes.commitPush")}
            </button>
          </>
        }
      >
        <div className="rp-commit-modal">
          <label className="rp-commit-modal__label" htmlFor="rp-commit-msg">
            {tr("changes.commitPlaceholder")}
          </label>
          <textarea
            id="rp-commit-msg"
            className="rp-commit-modal__input"
            rows={4}
            value={commitMsg}
            disabled={commitBusy}
            placeholder={tr("changes.commitPlaceholder")}
            onChange={(e) => {
              setCommitMsg(e.target.value);
              if (commitError) setCommitError(null);
            }}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void runCommitAndPush();
              }
            }}
          />
          <p className="rp-commit-modal__meta">
            {stagedCount > 0
              ? tr("changes.count", { n: String(stagedCount) })
              : tr("changes.nothingToCommit")}
          </p>
          <label className="rp-commit-modal__check">
            <input
              type="checkbox"
              checked={openPrAfterPush}
              disabled={commitBusy}
              onChange={(e) => setOpenPrAfterPush(e.target.checked)}
            />
            <span>{tr("changes.openPr")}</span>
          </label>
          {prUrl ? (
            <p className="rp-commit-modal__meta">
              <a href={prUrl} target="_blank" rel="noreferrer">
                {prUrl}
              </a>
            </p>
          ) : null}
          {commitError ? (
            <p className="rp-commit-modal__error">{commitError}</p>
          ) : null}
        </div>
      </GlassModal>

      <GlassModal
        open={!!discardTarget}
        onClose={() => {
          if (!discardBusy) setDiscardTarget(null);
        }}
        title={tr("changes.discardTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!discardBusy}
        showClose={!discardBusy}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={discardBusy}
              onClick={() => setDiscardTarget(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={discardBusy || !discardTarget}
              onClick={() => void applyWorkspaceDiscard()}
            >
              {discardBusy
                ? tr("changes.discarding")
                : tr("changes.discardConfirm")}
            </button>
          </>
        }
      >
        <div className="rp-checkpoint-confirm">
          <p>
            {tr("changes.discardBody", {
              path: discardTarget?.path || "",
            })}
          </p>
        </div>
      </GlassModal>

      <GlassModal
        open={!!revertPreview}
        onClose={() => {
          if (!checkpointBusy) setRevertPreview(null);
        }}
        title={tr("changes.checkpoints.revertTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!checkpointBusy}
        showClose={!checkpointBusy}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={checkpointBusy}
              onClick={() => setRevertPreview(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={checkpointBusy || !revertPreview?.clean}
              onClick={() => void applyCheckpointRevert()}
            >
              {checkpointBusy
                ? tr("changes.checkpoints.applying")
                : tr("changes.checkpoints.revertConfirm")}
            </button>
          </>
        }
      >
        <div className="rp-checkpoint-confirm">
          <p>{tr("changes.checkpoints.revertBody")}</p>
          <p className="rp-checkpoint-confirm__safety">
            {tr("changes.checkpoints.safety")}
          </p>
          {revertPreview?.changedPaths.length ? (
            <ul>
              {revertPreview.changedPaths.slice(0, 12).map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          ) : null}
          {(revertPreview?.changedPaths.length ?? 0) > 12 ? (
            <p>
              {tr("changes.checkpoints.moreFiles", {
                n: String((revertPreview?.changedPaths.length ?? 0) - 12),
              })}
            </p>
          ) : null}
        </div>
      </GlassModal>

      <GlassModal
        open={!!conflictTabId}
        onClose={() => setConflictTabId(null)}
        title={tr("resources.conflictTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setConflictTabId(null);
                void reloadActiveFile();
              }}
            >
              {tr("resources.conflictReload")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                setConflictTabId(null);
                void saveActiveFile({ force: true });
              }}
            >
              {tr("resources.conflictOverwrite")}
            </button>
          </>
        }
      >
        <p className="rp-modal-copy">{tr("resources.conflictBody")}</p>
      </GlassModal>

      <GlassModal
        open={!!discardTabId}
        onClose={() => setDiscardTabId(null)}
        title={tr("resources.discardTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDiscardTabId(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => {
                const id = discardTabId;
                setDiscardTabId(null);
                if (id) closeTabForced(id);
              }}
            >
              {tr("resources.discardConfirm")}
            </button>
          </>
        }
      >
        <p className="rp-modal-copy">{tr("resources.discardBody")}</p>
      </GlassModal>
    </div>
  );
}
