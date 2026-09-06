import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useFloatingMenu } from "@/lib/floatingMenu";
import {
  toggleTheme,
} from "@/lib/theme";
import {
  isThemeSkinId,
} from "@/lib/themeSkin";
import {
  DEFAULT_LAYOUT,
  NARROW_WORKBENCH_QUERY,
  clampAsideWidth,
  fitWorkbenchToViewport,
  loadLayout,
  openWorkbenchPane,
  saveLayout,
} from "@/lib/layout";
import {
  hitDragZoneFromRects,
  querySidebarEl,
  toClientDragPoint,
} from "@/lib/dragZone";
import {
  applyContextCompact,
  applyGeneratedImage,
  applyStreamChunk,
  applyToolEvent,
  applyTurnError,
  applyTurnMarker,
  canSend,
  canStop,
  canType,
  isSessionBusy,
  isSessionLiveStreaming,
  presentErrorBanner,
  type ErrorBannerView,
  IDLE_SNAPSHOT,
  type AskUserPayload,
  type ChatMessage,
  type GeneratedImagePayload,
  type PermissionPayload,
  type SessionSnapshot,
  type StreamPayload,
  type TurnErrorPayload,
} from "@/lib/session";
import {
  INITIAL_CONTEXT_USAGE,
  reduceContextUsage,
  resolveContextUsageDisplay,
  type ContextUsageState,
} from "@/lib/contextUsage";
import { ContextUsageChip } from "@/components/ContextUsageChip";
import { PromptCostPreview } from "@/components/PromptCostPreview";
import {
  closedSessionPlan,
  emptySessionPlan,
  mergePlanFromEvent,
  type SessionPlanState,
} from "@/lib/planSession";
import { AgentTasksPanel } from "@/components/AgentTasksPanel";
import { ComparisonView, type ComparisonEntry } from "@/components/ComparisonView";
import { RunningTasksDock } from "@/components/RunningTasksDock";
import { ActivityCenter } from "@/components/ActivityCenter";
import type { ActivityItem } from "@/lib/activity";
import { useActivityCenter } from "@/hooks/useActivityCenter";
import { useContentSearch } from "@/hooks/useContentSearch";
import { useModelHealth } from "@/hooks/useModelHealth";
import { PiExtensionWidgets } from "@/components/PiExtensionSurface";
import * as api from "@/lib/api";
import {
  EMPTY_PI_EXTENSION_UI,
  piExtensionWidgetsAt,
  reducePiExtensionUi,
  type PiExtensionSessionUi,
  type PiExtensionUiPayload,
} from "@/lib/piExtensionUi";
import {
  collectSessionTasks,
  countRunningTasks,
} from "@/lib/sessionTasks";
import { createT, resolveLocale, type Locale } from "@/i18n";
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  PI_FALLBACK_MODELS,
  PERMISSION_POLICIES,
  findModel,
  isValidEffort,
  isValidModelId,
  isValidPolicy,
  isValidPrefsScope,
  pickDefaultEffort,
  pickDefaultModelId,
  type ComposerPrefsScope,
  type EffortOption,
  type ModelOption,
  type PermissionPolicyId,
} from "@/lib/agentCatalog";
import {
  automaticPermissionButton,
  formatPermissionSummary,
  mapPermissionButtons,
} from "@/lib/permissionOptions";
import { AskUserModal } from "@/components/AskUserModal";
import { DoctorModal } from "@/components/DoctorModal";
import {
  filterSessionSearch,
  mergeSessionSearchHits,
} from "@/lib/sessionSearch";
import {
  sessionExportFilename,
  sessionToMarkdown,
} from "@/lib/sessionExport";
import {
  findChatMatches,
  stepChatFindIndex,
  type ChatFindMatch,
} from "@/lib/chatFind";
import { shortcutsForPlatform } from "@/lib/shortcuts";
import {
  ensureNotifyPermission,
  showDesktopNotification,
} from "@/lib/desktopNotify";
import { GlassModal } from "@/components/GlassModal";
import { ChatFindBar } from "@/components/ChatFindBar";
import {
  applyResolvedSessionMedia,
  collectSessionRelativeMediaRefs,
  isImagePath,
  mergeAttachments,
  parseAttachmentsFromContent,
  type Attachment,
} from "@/lib/attachments";
import {
  applySkillAtSlash,
  isDraftEmpty,
  hydrateDisplayContent,
  detectSlashQueryFromEditor,
  detectAtQueryFromEditor,
  parseStoredContent,
  serializeForAgent,
} from "@/lib/draftDoc";
import {
  collectUserPromptHistory,
  shouldHandlePromptHistoryKey,
  stepPromptHistory,
} from "@/lib/composerPromptHistory";
import {
  queuePreviewText,
  shouldEnqueueSend,
} from "@/lib/sendQueue";
import { useComposer, type FallbackTurn } from "@/hooks/useComposer";
import { useInlineEdit } from "@/hooks/useInlineEdit";
import { useLocalDictation } from "@/hooks/useLocalDictation";
import { appendTranscript } from "@/lib/localDictation";
import {
  buildSlashCatalog,
  flattenFilteredCatalog,
  type SlashItem,
  type SkillInfo,
} from "@/lib/slashCatalog";
import type { MessageKey } from "@/i18n";
import { AttachmentCard } from "@/components/AttachmentCard";
import { ImageViewerProvider } from "@/components/ImageViewer";
import { OverlayScroll } from "@/components/OverlayScroll";
import { VirtualList } from "@/components/VirtualList";
import {
  SIDEBAR_SESSION_ROW_GAP,
  SIDEBAR_SESSION_ROW_HEIGHT,
} from "@/lib/virtualList";
import { PiLogo } from "@/components/PiLogo";
import { SetupWizard, type SetupCliInfo } from "@/components/SetupWizard";
import {
  ComposerEditor,
} from "@/components/ComposerEditor";
import { ComposerProjectMenu } from "@/components/ComposerProjectMenu";
import {
  pathsEqual,
} from "@/lib/gitWorktree";
import { isProjectPathMissing } from "@/lib/projectPath";
import {
  ComposerPlusPanel,
  buildComposerPlusEntries,
  uploadMatchesQuery,
} from "@/components/ComposerPlusPanel";
import { ComposerAtPanel, type AtItem } from "@/components/ComposerAtPanel";
import { StatusModal } from "@/components/StatusModal";
import {
  IconChevronDown,
  IconChevronRight,
  IconMore,
  IconPlus,
  IconSearch,
  IconAttach,
  IconSend,
  IconQueue,
  IconStop,
  IconFolder,
  IconFolderPlus,
  IconClock,
  IconClose,
  IconNewChat as IconSquarePen,
  IconNewChat,
  IconImagine,
  IconScheduled,
  IconPanel,
  IconPanelRight,
  IconArchive,
  IconPin,
  IconPinOff,
  IconRename,
  IconCopy,
  IconTrash,
  IconExternalLink,
  IconFork,
  IconRewind,
  IconCheck,
  IconList,
  IconMic,
} from "@/components/icons";
import { AutomationsPage } from "@/components/AutomationsPage";
import { OpenLocationButton } from "@/components/OpenLocationButton";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import {
  aiCreateSeedPrompt,
  parseScheduledUserContent,
} from "@/lib/automations";
import {
  extractAutomationPayload,
} from "@/lib/automationSetup";
import {
  ComposerApprovalsMenu,
  ComposerModelMenu,
} from "@/components/ComposerModelMenu";
import {
  ResourceViewer,
  type ResourceOpenTarget,
} from "@/components/ResourceViewer";
import {
  mergeSessionChange,
  type SessionFileChange,
} from "@/lib/sessionChanges";
import { ConversationThread } from "@/components/lobe-chat";
import {
  preferPermissionFocus,
  trapTabKey,
} from "@/lib/a11yFocus";
import { Spinner } from "@/components/ui/spinner";
import { UserMenu } from "@/components/UserMenu";
import { WorkspaceSwitcher } from "@/components/WorkspaceSwitcher";
import { PrTree } from "@/components/PrTree";
import { CacheChip } from "@/components/CacheChip";
import { cacheNote, cacheNoteKey, type UsagePayload } from "@/lib/cacheUsage";
import {
  usePrWorkspace,
  type PrWorkspaceDeps,
} from "@/hooks/usePrWorkspace";
import { useTaskBatch, type TaskBatchDeps } from "@/hooks/useTaskBatch";
import {
  useWorktreeDialogs,
  type WorktreeDialogsDeps,
} from "@/hooks/useWorktreeDialogs";
import { useAppearance } from "@/hooks/useAppearance";
import { useAutomationRunner } from "@/hooks/useAutomationRunner";
import { useRewindDialogs } from "@/hooks/useRewindDialogs";
import { useSessionActions } from "@/hooks/useSessionActions";
import { useSessionLifecycle } from "@/hooks/useSessionLifecycle";
import { usePrActions } from "@/hooks/usePrActions";
import {
  parseTaskBatch,
  type ParallelTask,
} from "@/lib/parallelTasks";
import { isTransientFallbackError } from "@/lib/fallback";
import {
  loadWorkspace,
  saveWorkspace,
  isComingSoon,
  WORKSPACE_IDS,
  loadPrReviewModel,
  savePrReviewModel,
  workspaceSkin,
  type WorkspaceId,
} from "@/lib/workspace";
import type { SettingsSectionId } from "@/components/SettingsPage";
import { buildSettingsLabels } from "@/lib/settingsLabels";
import { Tip } from "@/components/ui/tooltip";
import {
  WindowControls,
  toggleMaximizeFromTitlebar,
} from "@/components/WindowControls";

const SettingsPage = lazy(() =>
  import("@/components/SettingsPage").then((module) => ({
    default: module.SettingsPage,
  })),
);

function joinAtPath(root: string, rel: string): string {
  if (!root) return rel;
  const r = root.replace(/[/\\]+$/, "");
  const relClean = rel.replace(/^[/\\]+/, "");
  return relClean ? `${r}/${relClean}` : r;
}

interface Project {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
  pathOk: boolean;
  pinned?: boolean;
  /** Project-level permission tier (L10). Null/undefined → app default. */
  permissionPolicy?: string | null;
  planModelId?: string | null;
  reviewModelId?: string | null;
}

interface SessionRow {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
  remoteCwd?: string | null;
  archived?: boolean;
  /** Pinned chats float to the top of the sidebar */
  pinned?: boolean;
  /** Shell scheduled-automation run */
  scheduled?: boolean;
  modelId?: string | null;
}

type ContextMenuState =
  | { kind: "project"; id: string; x: number; y: number }
  | { kind: "project-policy"; id: string; x: number; y: number }
  | { kind: "session"; id: string; x: number; y: number }
  | null;

/** In-app dialogs — window.prompt/confirm are unreliable in Tauri WebView. */
type AppDialog =
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel?: string;
      danger?: boolean;
      onConfirm: () => void | Promise<void>;
    }
  | {
      kind: "prompt";
      title: string;
      initial: string;
      /** Optional secondary copy above the input (e.g. compact confirm). */
      message?: string;
      placeholder?: string;
      /** Primary submit button label (default: common.save). */
      submitLabel?: string;
      onSubmit: (value: string) => void | Promise<void>;
    }
  | null;

/** App-local plan chrome state (session-scoped via planBySessionRef). */
type PlanState = SessionPlanState;

export default function App() {
  const [userName, setUserName] = useState("");
  const [layout, setLayout] = useState(() => {
    const saved = loadLayout(localStorage);
    if (window.matchMedia(NARROW_WORKBENCH_QUERY).matches) {
      return {
        ...saved,
        sidebarCollapsed: true,
        asideCollapsed: true,
      };
    }
    return saved;
  });
  useEffect(() => {
    const media = window.matchMedia(NARROW_WORKBENCH_QUERY);
    const reconcile = () => {
      setLayout((current) =>
        fitWorkbenchToViewport(current, media.matches),
      );
    };
    media.addEventListener("change", reconcile);
    return () => media.removeEventListener("change", reconcile);
  }, []);
  const [session, setSession] = useState<SessionSnapshot>(IDLE_SNAPSHOT);
  /** Host live agent (may differ from the session currently viewed in the UI). */
  const [liveHost, setLiveHost] = useState<SessionSnapshot>(IDLE_SNAPSHOT);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** Context usage chip — known tokens from compact events + estimate fallback. */
  const [contextUsage, setContextUsage] = useState<ContextUsageState>(
    INITIAL_CONTEXT_USAGE,
  );
  /**
   * Files written/edited by agent tools per session (Changes / diff panel).
   * Live tool events may enrich entries with before/after snippets.
   */
  const [sessionChangesById, setSessionChangesById] = useState<
    Record<string, SessionFileChange[]>
  >({});
  /** Composer stored form (may include [[skill:name]] tokens). */
  const [draft, setDraft] = useState("");
  /**
   * CLI-like prompt history browse index (0 = newest user msg).
   * null = not browsing; only engaged when draft empty (or already browsing).
   * Ref tracks live index for key-repeat before React re-renders.
   */
  const [promptHistoryIndex, setPromptHistoryIndex] = useState<number | null>(
    null,
  );
  const promptHistoryIndexRef = useRef<number | null>(null);
  promptHistoryIndexRef.current = promptHistoryIndex;
  const [goalMode, setGoalMode] = useState(false);
  /** Prevent overlapping executeSend / queue auto-flush races. */
  const sendInFlightRef = useRef(false);
  const fallbackTurnRef = useRef<FallbackTurn | null>(null);
  const fallbackRetryRef = useRef<
    (turn: FallbackTurn, payload: TurnErrorPayload) => Promise<boolean>
  >(async () => false);
  const retryInterruptedTurnRef = useRef<
    (message: ChatMessage) => Promise<void>
  >(async () => {});
  const [slashQuery, setSlashQuery] = useState<{
    start: number;
    query: string;
    end: number;
  } | null>(null);
  /**
   * Live slash token from contenteditable.innerText (rAF poll).
   * Independent of React draft so IME / <br> / missed onChange cannot desync.
   * `present` is true for bare `/` as well as `/query`.
   */
  const [liveSlash, setLiveSlash] = useState<{
    present: boolean;
    query: string;
    start: number;
    end: number;
  }>({ present: false, query: "", start: 0, end: 0 });
  const liveSlashRef = useRef(liveSlash);
  liveSlashRef.current = liveSlash;
  /** After Escape, suppress re-open until the `/token` text changes. */
  const slashDismissedSigRef = useRef<string | null>(null);
  /** Live `@` reference token (mirrors liveSlash for the object picker). */
  const [liveAt, setLiveAt] = useState<{
    present: boolean;
    query: string;
    start: number;
    end: number;
  }>({ present: false, query: "", start: 0, end: 0 });
  const liveAtRef = useRef(liveAt);
  liveAtRef.current = liveAt;
  const atDismissedSigRef = useRef<string | null>(null);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [atFiles, setAtFiles] = useState<api.FsEntry[]>([]);
  const [atLoading, setAtLoading] = useState(false);
  const composerAtPanelRef = useRef<HTMLDivElement>(null);
  const showComposerPlusRef = useRef(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showCompactModal, setShowCompactModal] = useState(false);
  const [compactNote, setCompactNote] = useState("");
  const compactNoteRef = useRef<HTMLInputElement>(null);
  /** Last user message open in inline edit (not main composer). */
  const [editingUserMessageId, setEditingUserMessageId] = useState<
    string | null
  >(null);
  /** Attachments for the open inline edit (reloaded from the message, editable). */
  const [editAttachments, setEditAttachments] = useState<Attachment[]>([]);
  const editingUserMessageIdRef = useRef<string | null>(null);
  editingUserMessageIdRef.current = editingUserMessageId;
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [rewindBusy, setRewindBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [cacheStandings, setCacheStandings] = useState<Record<string, api.SessionCacheStanding>>({});
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  /** Skills discovered by Pi for the active project, used by the slash palette. */
  const [skillInfos, setSkillInfos] = useState<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const refreshSkills = useCallback(async () => {
    if (!api.isTauri()) {
      setSkillInfos([]);
      setSkillsLoading(false);
      return;
    }
    setSkillsLoading(true);
    try {
      const result = await api.skillsList(activeProject?.path ?? null);
      setSkillInfos(
        (result.skills ?? [])
          .filter((skill) => skill.enabled !== false)
          .map((skill) => ({
            name: skill.name,
            description: skill.description ?? "",
            source: skill.source,
            userInvocable: skill.userInvocable,
          })),
      );
    } catch {
      // A missing CLI should not remove built-in slash commands.
      setSkillInfos([]);
    } finally {
      setSkillsLoading(false);
    }
  }, [activeProject?.path]);
  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);
  /** Per-session message cache so switching away mid-turn does not drop the UI. */
  const messagesBySessionRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const viewingSessionIdRef = useRef<string | null>(null);
  const liveHostRef = useRef<SessionSnapshot>(IDLE_SNAPSHOT);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null);
  const [appDialog, setAppDialog] = useState<AppDialog>(null);
  const [dialogInput, setDialogInput] = useState("");
  const dialogInputRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  /** Latest dialog for Enter/Escape handlers (avoids stale chained confirms). */
  const appDialogRef = useRef<AppDialog>(null);
  appDialogRef.current = appDialog;
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchModelFilter, setSearchModelFilter] = useState("");
  const [searchProjectFilter, setSearchProjectFilter] = useState("");
  const [showComposerPlus, setShowComposerPlus] = useState(false);
  showComposerPlusRef.current = showComposerPlus;
  const composerPlusTriggerRef = useRef<HTMLButtonElement>(null);
  const composerPlusPanelRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLDivElement>(null);
  /** Actual input card (.composer) — command panel anchors here. */
  const composerShellRef = useRef<HTMLDivElement>(null);
  /** Floating composer shell — height drives chat bottom padding. */
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const [composerFloatPad, setComposerFloatPad] = useState(168);
  /** Set by newChat; applied after chat pane + textarea mount. */
  const pendingComposerFocus = useRef(false);
  const [sessionDataMode, setSessionDataMode] = useState("independent");
  const [defaultOpenTarget, setDefaultOpenTarget] = useState("finder");
  const [showUserMenu, setShowUserMenu] = useState(false);
  /** Hash route: workbench | settings/:section | automations */
  const [appView, setAppView] = useState<"workbench" | "settings">("workbench");
  /** Inside workbench: chat thread vs scheduled tasks list. */
  const [mainPane, setMainPane] = useState<"chat" | "automations">("chat");
  /** Top-level context: what the sidebar lists and what "new chat" means. */
  const [workspace, setWorkspace] = useState<WorkspaceId>(() =>
    loadWorkspace(localStorage),
  );

  /** Real token usage from the host; null until a turn has been billed. */
  const [sessionUsage, setSessionUsage] = useState<UsagePayload | null>(null);
  const [cacheBreakHint, setCacheBreakHint] = useState<string | null>(null);
  const previousUsageRef = useRef<UsagePayload | null>(null);
  const compactWaiterRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSessionUsage(null);
    setCacheBreakHint(null);
    previousUsageRef.current = null;
  }, [session.sessionId]);

  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>("general");
  /** Conversation is guiding the user to create a scheduled task. */
  const automationSetupDraftRef = useRef(false);
  /** Composer is drafting a parallel task batch (set by /parallel). */
  const taskBatchDraftRef = useRef(false);
  const taskBatchAppliedRef = useRef<Set<string>>(new Set());
  /** Set below; a ref because the stream hook is declared before the runner. */
  const runTaskBatchRef = useRef<((tasks: ParallelTask[]) => void) | null>(null);
  const automationSetupSessionsRef = useRef<Set<string>>(new Set());
  const automationAppliedRef = useRef<Set<string>>(new Set());
  /** While openSession loads, do not let session.sessionId effect clobber viewing id. */
  const openingSessionIdRef = useRef<string | null>(null);

  // ContextMenu handles outside click + Escape for sidebar menus.

  useEffect(() => {
    if (!appDialog) return;
    if (appDialog.kind === "prompt") {
      setDialogInput(appDialog.initial);
      const t = window.setTimeout(() => {
        dialogInputRef.current?.focus();
        dialogInputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(t);
    }
    // Confirm: focus primary action so keyboard users land on Confirm.
    // Enter is also handled globally below so it still confirms if focus
    // sits on Cancel / close (needed for multi-step YOLO Enter spam).
    if (appDialog.kind === "confirm") {
      const t = window.setTimeout(() => {
        confirmBtnRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(t);
    }
  }, [appDialog]);

  useEffect(() => {
    if (!appDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setAppDialog(null);
        return;
      }
      // Confirm dialogs: Enter always accepts (including chained YOLO steps).
      // Capture phase + preventDefault so we don't double-fire with a focused
      // submit button's native activation.
      if (e.key !== "Enter" && e.key !== "NumpadEnter") return;
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
      const dialog = appDialogRef.current;
      if (!dialog || dialog.kind !== "confirm") return;
      e.preventDefault();
      e.stopPropagation();
      const run = dialog.onConfirm;
      setAppDialog(null);
      void run();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [appDialog]);

  useEffect(() => {
    if (!showSearch) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSearch(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showSearch]);

  const { contentSearchHits, contentSearchLoading } = useContentSearch({
    showSearch,
    searchQuery,
  });

  // Global shortcuts: search, find-in-chat, help, doctor, new chat, settings, voice.
  // Handlers go through refs so we don't re-bind every render.
  const shortcutHandlersRef = useRef({
    newChat: () => {},
    openSettings: () => {},
    openChatFind: () => {},
    openModelMenu: () => {},
    switchPinned: (_index: number) => {},
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // Esc cancels in-progress dictation (steal before other Esc handlers).
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing =
        tag === "input" ||
        tag === "textarea" ||
        !!target?.isContentEditable;
      const key = e.key.toLowerCase();
      if (key >= "1" && key <= "9" && !e.shiftKey && !typing) {
        e.preventDefault();
        shortcutHandlersRef.current.switchPinned(Number(key) - 1);
        return;
      }
      if (key === "m" && e.shiftKey) {
        e.preventDefault();
        shortcutHandlersRef.current.openModelMenu();
        return;
      }
      // In-chat find — open even while typing in the composer.
      if (key === "f" && !e.shiftKey) {
        e.preventDefault();
        shortcutHandlersRef.current.openChatFind();
        return;
      }
      if (key === "k") {
        e.preventDefault();
        setShowSearch(true);
        return;
      }
      if (key === "/") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      if (key === "," && !typing) {
        e.preventDefault();
        shortcutHandlersRef.current.openSettings();
        return;
      }
      if (key === "n" && !typing) {
        e.preventDefault();
        shortcutHandlersRef.current.newChat();
        return;
      }
      if (key === "d" && e.shiftKey) {
        e.preventDefault();
        setShowDoctor(true);
        return;
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  /** First-run gate: loading → setup wizard → ready (home). */
  const [appGate, setAppGate] = useState<"loading" | "setup" | "ready">(
    "loading",
  );
  // Ask once for notification permission after first ready.
  useEffect(() => {
    if (appGate !== "ready") return;
    void ensureNotifyPermission();
  }, [appGate]);
  const [setupCliSeed, setSetupCliSeed] = useState<SetupCliInfo | null>(null);
  const [showDoctor, setShowDoctor] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** In-conversation find (Cmd/Ctrl+F) — not the palette/session search. */
  const [showChatFind, setShowChatFind] = useState(false);
  const [chatFindQuery, setChatFindQuery] = useState("");
  const [chatFindIndex, setChatFindIndex] = useState(0);
  const [perm, setPerm] = useState<PermissionPayload | null>(null);
  const permBarRef = useRef<HTMLDivElement | null>(null);
  const [askUser, setAskUser] = useState<AskUserPayload | null>(null);
  /** Polite SR announce for stream start/stop (not every token). */
  const [streamA11yNote, setStreamA11yNote] = useState("");
  const wasStreamingRef = useRef(false);
  const [plan, setPlan] = useState<PlanState>(() => emptySessionPlan());
  /** Latest plan for the viewed session (mirrors `plan` for switch/cache). */
  const planRef = useRef(plan);
  planRef.current = plan;
  /**
   * Plan UI is session-scoped: switching chats restores that session's plan
   * (or hides the bar when the target has none / was hard-dismissed).
   * Live events for background sessions update this map without stealing the bar.
   * Hard-dismiss sets `userClosed` so reopen stays empty until a new plan cycle.
   */
  const planBySessionRef = useRef(new Map<string, PlanState>());
  const [locale, setLocale] = useState<Locale>("en");
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const tr = useMemo(() => createT(locale), [locale]);
  const trRef = useRef(tr);
  trRef.current = tr;
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [prReviewModel, setPrReviewModel] = useState<string | null>(() =>
    loadPrReviewModel(localStorage),
  );
  const [effort, setEffort] = useState(DEFAULT_EFFORT);
  const [mode, setMode] = useState("agent");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [policy, setPolicy] = useState("ask");
  /** Live selectable models from Host, including configured custom providers. */
  const [availableModels, setAvailableModels] =
    useState<ModelOption[]>(PI_FALLBACK_MODELS);
  const modelHealth = useModelHealth(api.isTauri());
  const [modelRoles, setModelRoles] = useState<Record<string, string>>({});
  const [fallbackChains, setFallbackChains] = useState<Record<string, string[]>>({});
  const [budgetMonthlyByTier, setBudgetMonthlyByTier] = useState<Record<string, number>>({});
  const [budgetSessionByTier, setBudgetSessionByTier] = useState<Record<string, number>>({});
  const [compactionThresholdPercent, setCompactionThresholdPercent] = useState(85);

  /** Where model/permission chips are remembered. */
  const [prefsScope, setPrefsScope] =
    useState<ComposerPrefsScope>("global");
  /** Files/folders attached for next send (@path to agent). */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  /** Pair selected from the session menu for an ordinary, non-batch comparison. */
  const [comparisonPair, setComparisonPair] = useState<[string, string] | null>(null);
  const [comparisonSelection, setComparisonSelection] = useState<string | null>(null);
  const sessionsRef = useRef<SessionRow[]>([]);
  const projectsRef = useRef<Project[]>([]);
  sessionsRef.current = sessions;
  projectsRef.current = projects;
  /** Chat file/url card → open in right resource pane. */
  const [resourceOpenTarget, setResourceOpenTarget] =
    useState<ResourceOpenTarget | null>(null);
  /** Bump to force ResourceViewer into Plan review mode (details / auto-open). */
  const [planFocusKey, setPlanFocusKey] = useState(0);
  /** Live drag-drop target for zone overlays (null = not dragging). */
  const [dragZone, setDragZone] = useState<"sidebar" | "main" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Soft startup banner when GitHub has a newer signed release. */
  const [appUpdateOffer, setAppUpdateOffer] =
    useState<api.AppUpdateCheck | null>(null);
  const [appUpdateInstallPercent, setAppUpdateInstallPercent] = useState<
    number | null
  >(null);
  const [piExtensionUiBySession, setPiExtensionUiBySession] = useState<
    Record<string, PiExtensionSessionUi>
  >({});
  const dragPathsRef = useRef<string[]>([]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [, setSetup] = useState({ cli: false, auth: false, project: false });
  const [localError, setLocalError] = useState<string | null>(null);
  /** Expand technical dump under the compact error banner. */
  const [errorDetailOpen, setErrorDetailOpen] = useState(false);
  const [cliInfo, setCliInfo] = useState<{
    found: boolean;
    path: string | null;
    version: string | null;
    source: string;
    cliAuthPresent: boolean;
  }>({ found: false, path: null, version: null, source: "", cliAuthPresent: false });
  const [manualCliPath, setManualCliPath] = useState("");
  const [acpServerAddr, setAcpServerAddr] = useState("");
  const [remoteRuntime, setRemoteRuntime] = useState<api.RemoteRuntimeSettings>({
    enabled: false,
    verified: false,
    transport: "ssh",
    directUrl: "",
    directTokenConfigured: false,
    host: "",
    user: "",
    port: 22,
    identityFile: "",
    piPath: "pi",
    cwd: "~",
  });
  /** The selected remote worktree for the viewed chat; never stored as a local project. */
  const [remoteWorkspacePath, setRemoteWorkspacePath] = useState<string | null>(
    null,
  );
  const remoteRuntimeKey = [
    remoteRuntime.enabled ? "1" : "0",
    remoteRuntime.transport,
    remoteRuntime.host,
    remoteRuntime.user,
    String(remoteRuntime.port),
    remoteRuntime.directUrl,
    remoteRuntime.cwd,
  ].join("|");
  const remoteRuntimeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!remoteRuntime.enabled) {
      remoteRuntimeKeyRef.current = null;
      setRemoteWorkspacePath(null);
      return;
    }
    if (remoteRuntimeKeyRef.current === remoteRuntimeKey) return;
    remoteRuntimeKeyRef.current = remoteRuntimeKey;
    setRemoteWorkspacePath(remoteRuntime.cwd.trim() || null);
  }, [remoteRuntime.cwd, remoteRuntime.enabled, remoteRuntimeKey]);
  const [maxConcurrentAgents, setMaxConcurrentAgents] = useState(3);
  const [agentIdleMinutes, setAgentIdleMinutes] = useState(30);
  const [streamStallSeconds, setStreamStallSeconds] = useState(120);
  /** 0 = omit `--max-turns` (CLI default). */
  const [maxAgentTurns, setMaxAgentTurns] = useState(0);
  const [storeApiKeysInKeychain, setStoreApiKeysInKeychain] = useState(false);
  const [crashReportingEnabled, setCrashReportingEnabled] = useState(false);
  const [sandboxProfile, setSandboxProfile] = useState("off");
  /** Preferred CLI agent definition for spawn (`""` = CLI default). */
  const [preferredAgent, setPreferredAgent] = useState("");
  const [agentCatalog, setAgentCatalog] = useState<
    Array<{ name: string; source: string }>
  >([]);
  const [experimentalMemory, setExperimentalMemory] = useState(false);
  // The right resource pane speaks in workspace paths. In remote mode the
  // project list may still contain local metadata, so never hand that local
  // path to the remote filesystem/Git bridge.
  const resourceProjectPath = remoteRuntime.enabled
    ? remoteWorkspacePath?.trim() || remoteRuntime.cwd.trim() || null
    : activeProject?.path ?? null;
  const [subagentsEnabled, setSubagentsEnabled] = useState(true);
  const [planEnabled, setPlanEnabled] = useState(true);
  const [disableWebSearch, setDisableWebSearch] = useState(false);
  const [useLeader, setUseLeader] = useState(false);
  const [reopenLastSession, setReopenLastSession] = useState(true);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const [tasksPanelOpen, setTasksPanelOpen] = useState(false);
  const [gitWorktrees, setGitWorktrees] = useState<api.GitWorktreeEntry[]>([]);
  /** null = unknown/loading; true = git work tree; false = not a git repo. */
  const [gitWorktreesAvailable, setGitWorktreesAvailable] = useState<
    boolean | null
  >(null);
  const [gitWorktreesLoading, setGitWorktreesLoading] = useState(false);
  const [gitWorktreesReason, setGitWorktreesReason] = useState<string | null>(
    null,
  );
  /** Host stream-stall prompt (I06); null when dismissed or not stalled. */
  const [streamStall, setStreamStall] = useState<{
    sessionId?: string;
    stallSeconds: number;
  } | null>(null);
  const [connecting, setConnecting] = useState(false);
  /** Live provider retry progress (session://retry); cleared on success/stop/error. */
  const [retryStatus, setRetryStatus] = useState<{
    attempt: number;
    maxRetries: number;
    reason: string;
  } | null>(null);
  /** Epoch ms when the current agent turn became busy (for elapsed UI). */
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [resizingAside, setResizingAside] = useState(false);
  const [account] = useState<api.AccountStatus | null>(null);
  const [accountBusy] = useState(false);
  const platform = useMemo(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "mac" as const;
    if (ua.includes("win")) return "win" as const;
    return "other" as const;
  }, []);
  /** Self-drawn chrome when OS title bar is disabled (Windows release config). */
  const useCustomWindowChrome = platform === "win" || platform === "other";
  const [windowMaximized, setWindowMaximized] = useState(false);

  useEffect(() => {
    document.documentElement.classList.remove(
      "platform-mac",
      "platform-win",
      "platform-other",
    );
    if (platform === "mac") document.documentElement.classList.add("platform-mac");
    if (platform === "win") document.documentElement.classList.add("platform-win");
    if (platform === "other") document.documentElement.classList.add("platform-other");
  }, [platform]);

  useEffect(() => {
    if (!useCustomWindowChrome || !api.isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        const sync = async () => {
          try {
            setWindowMaximized(await w.isMaximized());
          } catch {
            /* ignore */
          }
        };
        await sync();
        unlisten = await w.onResized(() => {
          void sync();
        });
        if (cancelled) unlisten?.();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [useCustomWindowChrome]);

  const applyComposerPrefs = useCallback(
    (prefs: api.ComposerPrefs, catalog: ModelOption[]) => {
      const models = catalog.length > 0 ? catalog : PI_FALLBACK_MODELS;
      let nextModelId: string;
      if (prefs.modelId && isValidModelId(prefs.modelId, models)) {
        nextModelId = prefs.modelId;
      } else {
        nextModelId = pickDefaultModelId(models);
      }
      setModelId(nextModelId);
      const model = findModel(nextModelId, models);
      setEffort(
        isValidEffort(prefs.effort, model)
          ? prefs.effort
          : pickDefaultEffort(model),
      );
      setMode(prefs.mode || "agent");
      setPolicy(
        isValidPolicy(prefs.permissionPolicy) ? prefs.permissionPolicy : "ask",
      );
      if (isValidPrefsScope(prefs.scope)) {
        setPrefsScope(prefs.scope);
      }
    },
    [],
  );

  const refreshLists = useCallback(async () => {
    if (!api.isTauri()) {
      // Browser/Vite-only preview: skip Host gate.
      setAppGate("ready");
      setSetupCliSeed({
        found: true,
        path: null,
        version: "browser",
        source: "browser",
        cliAuthPresent: false,
      });
      return;
    }
    try {
      const [p, s, settings, cli, modelsRes] = await Promise.all([
        api.projectsList(),
        api.sessionsList(),
        api.settingsGet(),
        api.probeCli(),
        api.modelsListAvailable().catch(() => null),
      ]);
      setProjects(
        (p as Project[]).map((x) => ({
          ...x,
          pinned: !!(x as Project).pinned,
        })),
      );
      setSessions(
        (
          s as Array<
            SessionRow & {
              archived?: boolean;
              pinned?: boolean;
              scheduled?: boolean;
            }
          >
        ).map((x) => ({
          id: x.id,
          title: x.title,
          projectId: x.projectId,
          updatedAt: x.updatedAt,
          remoteCwd: x.remoteCwd ?? null,
          archived: !!x.archived,
          pinned: !!x.pinned,
          scheduled: !!x.scheduled,
          modelId: x.modelId ?? null,
        })),
      );
      void api.sessionCacheStandings().then((rows) => {
        setCacheStandings(Object.fromEntries(rows.map((row) => [row.sessionId, row])));
      }).catch(() => {});
      void api.trayRefresh();
      setLocale(resolveLocale(settings.locale));
      setUserName(settings.userName?.trim() || "");
      const catalog: ModelOption[] =
        modelsRes?.models?.length
          ? modelsRes.models.map((m) => {
              const efforts: EffortOption[] | undefined =
                m.reasoningEfforts?.length
                  ? m.reasoningEfforts.map((e) => ({
                      id: e.id,
                      value: e.value,
                      label: e.label,
                      description: e.description,
                      isDefault: e.isDefault,
                    }))
                  : undefined;
              return {
                id: m.id,
                label: m.label || m.id,
                source: m.source,
                contextWindow: m.contextWindow,
                blocked: m.blocked,
                isDefault: m.isDefault,
                reasoningEfforts: efforts,
              };
            })
          : PI_FALLBACK_MODELS;
      setAvailableModels(catalog);
      setModelRoles(settings.modelRoles ?? {});
      setFallbackChains(settings.fallbackChains ?? {});
      setBudgetMonthlyByTier(settings.budgetMonthlyByTier ?? {});
      setBudgetSessionByTier(settings.budgetSessionByTier ?? {});
      setCompactionThresholdPercent(settings.compactionThresholdPercent ?? 85);
      if (
        settings.composerPrefsScope &&
        isValidPrefsScope(settings.composerPrefsScope)
      ) {
        setPrefsScope(settings.composerPrefsScope);
      }
      // Bootstrap: global-effective prefs (context re-resolved when project/session changes).
      const prefs = await api
        .composerPrefsResolve({ projectId: null, sessionId: null })
        .catch(() => null);
      if (prefs) {
        applyComposerPrefs(prefs, catalog);
      } else {
        setPolicy(
          isValidPolicy(settings.permissionPolicy || "")
            ? settings.permissionPolicy
            : "ask",
        );
        {
          const mid =
            settings.modelId && isValidModelId(settings.modelId, catalog)
              ? settings.modelId
              : pickDefaultModelId(catalog);
          const model = findModel(mid, catalog);
          setEffort(
            isValidEffort(settings.effort || "", model)
              ? settings.effort!
              : pickDefaultEffort(model),
          );
        }
        setMode(settings.mode || "agent");
        if (settings.modelId && isValidModelId(settings.modelId, catalog)) {
          setModelId(settings.modelId);
        } else {
          setModelId(
            modelsRes?.defaultModelId &&
              isValidModelId(modelsRes.defaultModelId, catalog)
              ? modelsRes.defaultModelId
              : pickDefaultModelId(catalog),
          );
        }
      }
      setSessionDataMode(settings.sessionDataMode || "independent");
      setDefaultOpenTarget(
        (settings as { defaultOpenTarget?: string }).defaultOpenTarget ||
          "finder",
      );
      setManualCliPath(settings.manualCliPath || cli.path || "");
      setAcpServerAddr(settings.acpServerAddr || "");
      setRemoteRuntime(
        settings.remoteRuntime || {
          enabled: false,
          verified: false,
          transport: "ssh",
          directUrl: "",
          directTokenConfigured: false,
          host: "",
          user: "",
          port: 22,
          identityFile: "",
          piPath: "pi",
          cwd: "~",
        },
      );
      setMaxConcurrentAgents(
        typeof settings.maxConcurrentAgents === "number" &&
          settings.maxConcurrentAgents >= 1
          ? Math.min(8, Math.round(settings.maxConcurrentAgents))
          : 3,
      );
      setAgentIdleMinutes(
        typeof settings.agentIdleMinutes === "number" &&
          settings.agentIdleMinutes >= 1
          ? Math.min(1440, Math.round(settings.agentIdleMinutes))
          : 30,
      );
      setStreamStallSeconds(
        typeof settings.streamStallSeconds === "number" &&
          settings.streamStallSeconds >= 15
          ? Math.min(900, Math.round(settings.streamStallSeconds))
          : 120,
      );
      {
        const raw = settings.maxAgentTurns;
        setMaxAgentTurns(
          typeof raw === "number" && raw > 0
            ? Math.min(200, Math.round(raw))
            : 0,
        );
      }
      setStoreApiKeysInKeychain(!!settings.storeApiKeysInKeychain);
      setCrashReportingEnabled(!!settings.crashReportingEnabled);
      {
        const sb = (settings.sandboxProfile || "off").trim().toLowerCase();
        const known = ["off", "workspace", "read-only", "strict", "devbox"];
        setSandboxProfile(known.includes(sb) ? sb : "off");
      }
      setPreferredAgent((settings.preferredAgent || "").trim());
      setExperimentalMemory(!!settings.experimentalMemory);
      setSubagentsEnabled(settings.subagentsEnabled !== false);
      setPlanEnabled(settings.planEnabled !== false);
      setDisableWebSearch(!!settings.disableWebSearch);
      setUseLeader(!!settings.useLeader);
      setReopenLastSession(settings.reopenLastSession !== false);
      setLastSessionId(
        typeof settings.lastSessionId === "string"
          ? settings.lastSessionId.trim() || null
          : null,
      );
      // Pi packages own optional agent workflows. The desktop shell does not
      // inspect a second, legacy agent catalog during startup.
      setAgentCatalog([]);
      setCliInfo({
        found: cli.found,
        path: cli.path,
        version: cli.version,
        source: cli.source || "",
        cliAuthPresent: !!cli.cliAuthPresent,
      });
      // Pi owns provider credentials and authentication. A usable Pi runtime
      // is sufficient for entering the workbench.
      const remoteReady =
        !!settings.remoteRuntime?.enabled &&
        !!settings.remoteRuntime?.verified;
      const runtimeReady = !!cli.found || remoteReady;
      const authOk = runtimeReady;
      setSetup({
        cli: runtimeReady,
        auth: authOk,
        project: p.some((x) => (x as Project).trusted) || p.length > 0,
      });

      // ── Setup gate: CLI is hard-required; account may be deferred ──
      const cliSeed: SetupCliInfo = {
        found: runtimeReady,
        path: cli.path,
        version: remoteReady
          ? settings.remoteRuntime?.transport === "direct"
            ? "Pi Direct RPC"
            : "Remote Pi over SSH"
          : cli.version,
        source: remoteReady ? "ssh" : cli.source || "",
        cliAuthPresent: !!cli.cliAuthPresent,
      };
      setSetupCliSeed(cliSeed);

      const wizardCompleted = !!settings.setupWizardCompleted;
      const legacyDone =
        !!settings.onboardingDone || !!settings.setupSkipped;

      if (runtimeReady && !wizardCompleted && legacyDone) {
        // Migrate older installs that already completed onboarding.
        try {
          await api.settingsSet({
            ...settings,
            setupWizardCompleted: true,
            authSetupDeferred: false,
          });
        } catch {
          /* ignore */
        }
        setAppGate("ready");
      } else if (!runtimeReady || !wizardCompleted) {
        // No CLI means setup is required. Pi handles provider configuration.
        setAppGate("setup");
      } else {
        setAppGate("ready");
      }

      // One-shot: corrupt store JSON was renamed aside on load (shared-mode safety).
      void api
        .storeTakeQuarantine()
        .then((path) => {
          if (!path) return;
          const msg = createT(resolveLocale(settings.locale))(
            "store.quarantineNotice",
            { path },
          );
          setToast(msg);
          window.setTimeout(() => setToast(null), 9000);
        })
        .catch(() => {});

      // Prefer first trusted project; keep selection if still present
      setActiveProject((prev) => {
        if (prev && (p as Project[]).some((x) => x.id === prev.id)) {
          return (p as Project[]).find((x) => x.id === prev.id) || prev;
        }
        return (
          (p as Project[]).find((x) => x.trusted) ||
          (p as Project[])[0] ||
          null
        );
      });
      setExpandedProjects((prev) => {
        const next = { ...prev };
        for (const proj of p as Project[]) {
          if (next[proj.id] === undefined) next[proj.id] = true;
        }
        return next;
      });
    } catch (e) {
      setLocalError(String(e));
      // Still surface setup if Tauri partially works
      setSetupCliSeed((prev) =>
        prev ?? {
          found: false,
          path: null,
          version: null,
          source: "error",
          cliAuthPresent: false,
        },
      );
      setAppGate((g) => (g === "loading" ? "setup" : g));
    }
  }, []);

  // Bootstrap lists once
  useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  // Soft app-update check shortly after open (GitHub Releases → AJSubrizi/Pi-App).
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .appCheckUpdate()
        .then((r) => {
          if (cancelled || !r.updateAvailable) return;
          try {
            const dismissed = localStorage.getItem("pi-app.dismissedUpdate");
            if (dismissed && dismissed === r.latestVersion) return;
          } catch {
            /* ignore */
          }
          setAppUpdateOffer(r);
        })
        .catch(() => {
          /* soft-fail: offline / rate limit */
        });
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Re-resolve model/permission when project or chat changes.
  // Permission always cascades project/session tiers (L10), even when model
  // memory scope is global — so project-level tiers apply after a switch.
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    void api
      .composerPrefsResolve({
        projectId: activeProject?.id ?? null,
        sessionId: session.sessionId ?? null,
      })
      .then((prefs) => {
        if (!cancelled) applyComposerPrefs(prefs, availableModels);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    activeProject?.id,
    session.sessionId,
    prefsScope,
    applyComposerPrefs,
    availableModels,
  ]);

  // Keep refs aligned for event handlers — but not while openSession is loading
  // (otherwise an intermediate null sessionId wipes viewing id and skips UI update).
  useEffect(() => {
    if (openingSessionIdRef.current) return;
    viewingSessionIdRef.current = session.sessionId;
  }, [session.sessionId]);

  // Prompt history is per viewed session — leave browse mode on switch / new chat.
  useEffect(() => {
    promptHistoryIndexRef.current = null;
    setPromptHistoryIndex(null);
  }, [session.sessionId]);

  useEffect(() => {
    liveHostRef.current = liveHost;
  }, [liveHost]);

  // Mirror viewed-session messages into the cache on every change.
  useEffect(() => {
    messagesRef.current = messages;
    const id = session.sessionId;
    if (!id) return;
    messagesBySessionRef.current.set(id, messages);
  }, [messages, session.sessionId]);

  /** Apply a message reducer to the viewed session or only to the cache. */
  const patchSessionMessages = useCallback(
    (
      targetSessionId: string | undefined | null,
      reduce: (prev: ChatMessage[]) => ChatMessage[],
    ) => {
      if (!targetSessionId) return;
      if (viewingSessionIdRef.current === targetSessionId) {
        setMessages((prev) => {
          const next = reduce(prev);
          messagesBySessionRef.current.set(targetSessionId, next);
          return next;
        });
      } else {
        const prev = messagesBySessionRef.current.get(targetSessionId) ?? [];
        messagesBySessionRef.current.set(targetSessionId, reduce(prev));
      }
    },
    [],
  );

  /**
   * After any turn, if the last assistant message contains a pi-automation
   * fence, strip it from the bubble and call automation_create.
   * Applies to all sessions (not only AI-created ones), so normal chat can schedule.
   * Deduped per assistant message id.
   */
  /**
   * Turn a finished batch reply into running tasks.
   *
   * Mirrors the automation hook: strip the fence from what the user sees, then
   * act on it exactly once per assistant message.
   */
  const tryApplyTaskBatchFromSession = useCallback(
    (sessionId: string) => {
      if (!sessionId) return;
      const msgs = messagesBySessionRef.current.get(sessionId) ?? [];
      const assistant = [...msgs]
        .reverse()
        .find((m) => m.role === "assistant" && !m.isError);
      if (!assistant || assistant.streaming) return;

      const applyKey = assistant.id || `${sessionId}:batch`;
      if (taskBatchAppliedRef.current.has(applyKey)) return;

      const { tasks, cleanText } = parseTaskBatch(
        assistant.content || "",
        availableModels.map((m) => m.id),
        modelRoles,
      );
      if (cleanText !== (assistant.content || "")) {
        const aid = assistant.id;
        patchSessionMessages(sessionId, (prev) =>
          prev.map((m) => (m.id === aid ? { ...m, content: cleanText } : m)),
        );
      }
      if (tasks.length === 0) return;
      taskBatchAppliedRef.current.add(applyKey);
      taskBatchDraftRef.current = false;
      runTaskBatchRef.current?.(tasks);
    },
    [availableModels, modelRoles, patchSessionMessages],
  );

  const tryApplyAutomationFromSession = useCallback(
    async (sessionId: string) => {
      if (!sessionId) return;

      const msgs = messagesBySessionRef.current.get(sessionId) ?? [];
      let lastAssistantIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === "assistant" && !msgs[i]?.isError) {
          lastAssistantIdx = i;
          break;
        }
      }
      if (lastAssistantIdx < 0) return;
      const assistant = msgs[lastAssistantIdx]!;
      if (assistant.streaming) return;

      const applyKey = assistant.id || `${sessionId}:last`;
      if (automationAppliedRef.current.has(applyKey)) return;

      const { cleanText, input, rawJson } = extractAutomationPayload(
        assistant.content || "",
      );
      // Always strip fence from UI when present (even if JSON incomplete).
      if (cleanText !== (assistant.content || "")) {
        const aid = assistant.id;
        patchSessionMessages(sessionId, (prev) =>
          prev.map((m) => (m.id === aid ? { ...m, content: cleanText } : m)),
        );
      }
      if (!input) return;

      // Also dedupe identical payloads in this session.
      const payloadKey = `${sessionId}:${rawJson ?? input.title}`;
      if (automationAppliedRef.current.has(payloadKey)) return;

      automationAppliedRef.current.add(applyKey);
      automationAppliedRef.current.add(payloadKey);
      try {
        const created = await api.automationCreate(input);
        automationSetupSessionsRef.current.delete(sessionId);
        setToast(
          tr("automations.createdToast", {
            title: created.title || input.title,
          }),
        );
        window.setTimeout(() => setToast(null), 4200);
      } catch {
        automationAppliedRef.current.delete(applyKey);
        automationAppliedRef.current.delete(payloadKey);
        setToast(tr("automations.createFailed"));
        window.setTimeout(() => setToast(null), 4200);
      }
    },
    [patchSessionMessages, tr],
  );

  // Event listeners: StrictMode-safe (cleanup cancels pending + live unsubs)
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];

    const track = async (p: Promise<() => void>) => {
      const un = await p;
      if (cancelled) {
        un();
      } else {
        cleanups.push(un);
      }
    };

    void (async () => {
      try {
        const snap = await api.sessionGetState();
        if (!cancelled) {
          setLiveHost(snap);
          liveHostRef.current = snap;
          // Only bind the viewed session when Host already has a live row.
          if (snap.sessionId) {
            setSession(snap);
            viewingSessionIdRef.current = snap.sessionId;
          }
        }

        await track(
          api.listen<SessionSnapshot>("session://state", (s) => {
            if (cancelled) return;
            setLiveHost(s);
            liveHostRef.current = s;
            // Only update the workbench session when the user is viewing it.
            // Otherwise switching sessions would yank selection back to the live agent.
            if (
              s.sessionId &&
              s.sessionId === viewingSessionIdRef.current
            ) {
              setSession(s);
              // Clear retry chip / turn timer / stall banner when turn ends or errors out
              if (s.state !== "streaming" && s.state !== "awaiting_permission") {
                setRetryStatus(null);
                setStreamStall(null);
                setTurnStartedAt(null);
                // Ensure no assistant is left with streaming=true after the turn
                // (missed done chunk) — otherwise the next send can bind to it.
                setMessages((prev) => {
                  if (!prev.some((m) => m.streaming)) return prev;
                  const next = prev.map((m) =>
                    m.streaming ? { ...m, streaming: false } : m,
                  );
                  if (s.sessionId) {
                    messagesBySessionRef.current.set(s.sessionId, next);
                  }
                  return next;
                });
                if (s.state === "ready") {
                  showDesktopNotification({
                    title: trRef.current("notify.turnDoneTitle"),
                    body: trRef.current("notify.turnDoneBody"),
                    tag: `turn-${s.sessionId || "x"}`,
                  });
                }
              } else if (
                (s.state === "streaming" || s.state === "awaiting_permission") &&
                s.sessionId === viewingSessionIdRef.current
              ) {
                setTurnStartedAt((prev) => prev ?? Date.now());
              }
              // After a turn, resolve `images/N.jpg` short paths into image cards
              if (s.state === "ready") {
                const sid = s.sessionId;
                setMessages((prev) => {
                  const rels = collectSessionRelativeMediaRefs(prev);
                  if (!rels.length) return prev;
                  void api
                    .sessionResolveRelativeMedia(sid, rels)
                    .then((list) => {
                      if (
                        cancelled ||
                        !list.length ||
                        viewingSessionIdRef.current !== sid
                      ) {
                        return;
                      }
                      const resolved = list.map((a) => ({
                        path: a.path,
                        name:
                          a.name ||
                          a.path.split(/[/\\]/).pop() ||
                          a.path,
                        isDir: !!a.isDir,
                      }));
                      setMessages((cur) =>
                        applyResolvedSessionMedia(cur, resolved),
                      );
                    })
                    .catch(() => {
                      /* ignore */
                    });
                  return prev;
                });
              }
            } else if (!isSessionBusy(s.state)) {
              if (viewingSessionIdRef.current === s.sessionId) {
                setRetryStatus(null);
              }
              // Backup apply path if stream `done` chunk was missed.
              if (s.sessionId) {
                void tryApplyAutomationFromSession(s.sessionId);
                tryApplyTaskBatchFromSession(s.sessionId);
                if (s.state === "ready" && s.sessionId !== viewingSessionIdRef.current) {
                  showDesktopNotification({
                    title: trRef.current("notify.backgroundDoneTitle"),
                    body: `${s.modelId || trRef.current("batch.defaultModel")} · ${s.title || trRef.current("notify.turnDoneBody")}`,
                    tag: `background-${s.sessionId}`,
                  });
                }
              }
            }
          }),
        );
        await track(
          api.listen<UsagePayload>("session://usage", (payload) => {
            // Keep only the viewed session's figures; a background task's
            // usage would otherwise overwrite the chip you are looking at.
            if (payload.sessionId !== viewingSessionIdRef.current) return;
            const note = cacheNote(previousUsageRef.current, payload);
            setCacheBreakHint(
              note ? trRef.current(cacheNoteKey(note) as MessageKey) : null,
            );
            previousUsageRef.current = payload;
            setSessionUsage(payload);
            // The provider just told us exactly how full the window was, so
            // the context chip can stop estimating from character counts.
            //
            // The *turn*, not the session total: occupancy is the size of the
            // last prompt. Summing every turn would climb forever and report a
            // window many times fuller than it is.
            const promptTokens = payload.turn.input + payload.turn.cacheRead;
            if (promptTokens > 0) {
              setContextUsage((prev) =>
                reduceContextUsage(prev, { type: "measured", promptTokens }),
              );
            }
          }),
        );
        await track(
          api.listen<StreamPayload>("session://stream", (chunk) => {
            if (cancelled) return;
            // Ignore empty terminal ticks that only flip done
            if (!chunk.text && !chunk.done) return;
            // Defense-in-depth: drop stream chunks that arrive while no live turn
            // is active (the host already gates this on FSM Streaming, but stale
            // or replayed chunks must never re-type history on session switch).
            if (
              chunk.text &&
              !isSessionLiveStreaming(liveHostRef.current.state)
            ) {
              return;
            }
            if (
              chunk.text &&
              chunk.sessionId === viewingSessionIdRef.current
            ) {
              setRetryStatus(null);
              // Progress clears stall banner (I06).
              setStreamStall(null);
            }
            patchSessionMessages(chunk.sessionId, (prev) => {
              const next = applyStreamChunk(prev, chunk);
              // Keep cache in sync immediately so post-turn apply sees final text.
              if (chunk.sessionId) {
                messagesBySessionRef.current.set(chunk.sessionId, next);
              }
              return next;
            });
            // After a completed assistant stream, try silent automation create.
            if (chunk.done && chunk.sessionId) {
              void tryApplyAutomationFromSession(chunk.sessionId);
              tryApplyTaskBatchFromSession(chunk.sessionId);
            }
          }),
        );
        await track(
          api.listen<GeneratedImagePayload>(
            "session://generated_image",
            (p) => {
              if (cancelled || !p?.path) return;
              patchSessionMessages(p.sessionId, (prev) =>
                applyGeneratedImage(prev, p),
              );
            },
          ),
        );
        await track(
          api.listen<{
            sessionId?: string;
            messageId?: string;
            trigger?: string;
            tokensBefore?: number;
            tokensAfter?: number;
            summaryPreview?: string;
            note?: string;
            content?: string;
          }>("session://context_compact", (p) => {
            if (cancelled || !p) return;
            const sid = p.sessionId;
            if (!sid) return;
            patchSessionMessages(sid, (prev) => applyContextCompact(prev, p));
            if (sid === viewingSessionIdRef.current) {
              compactWaiterRef.current?.();
              compactWaiterRef.current = null;
              setContextUsage((prev) =>
                reduceContextUsage(prev, {
                  type: "compact",
                  trigger: p.trigger,
                  tokensBefore: p.tokensBefore,
                  tokensAfter: p.tokensAfter,
                  summaryPreview: p.summaryPreview,
                  note: p.note,
                  messageId: p.messageId,
                }),
              );
              const auto = (p.trigger || "auto").toLowerCase() !== "manual";
              setToast(
                auto
                  ? tr("compact.toastAuto")
                  : tr("compact.toastManual"),
              );
              window.setTimeout(() => setToast(null), 3200);
            }
          }),
        );
        await track(
          api.listen<{
            sessionId?: string;
            toolCallId?: string;
            title?: string;
            kind?: string;
            status?: string;
            path?: string | null;
            detail?: string | null;
            before?: string | null;
            after?: string | null;
          }>("session://tool", (p) => {
            if (cancelled || !p?.toolCallId) return;
            const sid = p.sessionId || viewingSessionIdRef.current;
            if (!sid) return;
            patchSessionMessages(sid, (prev) => applyToolEvent(prev, p));
            // Track write/edit tools for the session Changes panel.
            setSessionChangesById((prev) => {
              const list = prev[sid] ?? [];
              const next = mergeSessionChange(list, {
                toolCallId: p.toolCallId,
                title: p.title,
                kind: p.kind,
                status: p.status,
                path: p.path,
                detail: p.detail,
                before: p.before,
                after: p.after,
              });
              if (next === list) return prev;
              return { ...prev, [sid]: next };
            });
            if (sid === viewingSessionIdRef.current) {
              setTurnStartedAt((t) => t ?? Date.now());
              // Tool activity counts as progress — clear stall banner (I06).
              setStreamStall(null);
            }
          }),
        );
        await track(
          api.listen<{
            sessionId?: string;
            messageId?: string;
            marker?: string;
            reason?: string;
            content?: string;
          }>("session://turn_marker", (p) => {
            if (cancelled || !p) return;
            const sid = p.sessionId;
            if (!sid) return;
            patchSessionMessages(sid, (prev) => applyTurnMarker(prev, p));
            if (sid === viewingSessionIdRef.current) {
              setTurnStartedAt(null);
              setStreamStall(null);
              if (p.marker === "turn_cancelled") {
                setToast(tr("activity.cancelledToast"));
                window.setTimeout(() => setToast(null), 2800);
              }
            }
          }),
        );
        await track(
          api.listen<{ sessionId?: string; reason?: string }>(
            "session://idle_recycled",
            (p) => {
              if (cancelled || !p) return;
              if (p.reason === "capacity") {
                setToast(tr("agent.processLimitToast"));
                window.setTimeout(() => setToast(null), 5200);
                return;
              }
              // Toast when the focused (or unknown) session was idle-recycled.
              if (
                !p.sessionId ||
                p.sessionId === viewingSessionIdRef.current
              ) {
                setToast(tr("agent.idleRecycledToast"));
                window.setTimeout(() => setToast(null), 4200);
              }
            },
          ),
        );
        await track(
          api.listen<{ reason?: string; killed?: number }>(
            "session://agents_recycled",
            (p) => {
              if (cancelled || !p) return;
              // session_data_mode flip (and any future full recycle).
              if (
                p.reason === "session_data_mode" ||
                (p.killed != null && p.killed > 0)
              ) {
                setToast(tr("agent.dataModeRecycledToast"));
                window.setTimeout(() => setToast(null), 4800);
              }
            },
          ),
        );
        await track(
          api.listen<{
            sessionId?: string;
            stopReason?: string;
            toolCount?: number;
          }>("session://turn_empty_run", (p) => {
            if (cancelled || !p) return;
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            setToast(tr("session.emptyRunToast"));
            window.setTimeout(() => setToast(null), 7200);
          }),
        );
        await track(
          api.listen<{
            sessionId?: string;
            code?: string;
            message?: string;
            maxConcurrentAgents?: number;
          }>("session://process_limit", (p) => {
            if (cancelled || !p) return;
            setToast(tr("agent.processLimitToast"));
            window.setTimeout(() => setToast(null), 5200);
            if (
              !p.sessionId ||
              p.sessionId === viewingSessionIdRef.current
            ) {
              setLocalError(
                p.message
                  ? `PROCESS_LIMIT: ${p.message}`
                  : "PROCESS_LIMIT",
              );
            }
          }),
        );
        await track(
          api.listen<{
            sessionId?: string;
            stallSeconds?: number;
            code?: string;
            message?: string;
          }>("session://stream_stall", (p) => {
            if (cancelled || !p) return;
            // Only prompt for the viewed session (or unknown id).
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            const secs =
              typeof p.stallSeconds === "number" && p.stallSeconds > 0
                ? Math.round(p.stallSeconds)
                : 120;
            setStreamStall({
              sessionId: p.sessionId,
              stallSeconds: secs,
            });
          }),
        );
        await track(
          api.listen<{
            attempt?: number;
            maxRetries?: number;
            reason?: string;
            aborting?: boolean;
            sessionId?: string;
          }>("session://retry", (p) => {
            if (cancelled) return;
            // Retry chip is only meaningful on the viewed live session.
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            if (
              liveHostRef.current.sessionId &&
              liveHostRef.current.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            const attempt = p.attempt ?? 0;
            const maxRetries = p.maxRetries ?? 5;
            const reason = (p.reason || "").trim();
            setRetryStatus({ attempt, maxRetries, reason });
          }),
        );
        await track(
          api.listen<TurnErrorPayload>("session://turn_error", (p) => {
            if (cancelled) return;
            if (p.sessionId === viewingSessionIdRef.current) {
              setRetryStatus(null);
            }
            const fallback = fallbackTurnRef.current;
            if (
              fallback &&
              fallback.sessionId === p.sessionId &&
              isTransientFallbackError(p.code, p.message || p.content || "")
            ) {
              fallbackTurnRef.current = null;
              void fallbackRetryRef.current(fallback, p);
            }
            patchSessionMessages(p.sessionId, (prev) =>
              applyTurnError(prev, p, localeRef.current),
            );
          }),
        );
        await track(
          api.listen<PermissionPayload>("session://permission", (p) => {
            if (cancelled) return;
            // Only surface the bar when viewing the session that needs it.
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              // Multi-session stream: another chat needs approval — nudge user.
              setToast(trRef.current("session.backgroundPermission"));
              window.setTimeout(() => setToast(null), 4200);
              showDesktopNotification({
                title: trRef.current("notify.permissionTitle"),
                body: trRef.current("session.backgroundPermission"),
                tag: `perm-bg-${p.rpcId}`,
                force: true,
              });
              return;
            }
            setPerm(p);
            showDesktopNotification({
              title: trRef.current("notify.permissionTitle"),
              body: trRef.current("notify.permissionBody"),
              tag: `perm-${p.rpcId}`,
              force: true,
            });
          }),
        );
        await track(
          api.listen<AskUserPayload>("session://ask_user", (p) => {
            if (cancelled) return;
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              return;
            }
            if (!p?.rpcId || !Array.isArray(p.questions) || !p.questions.length) {
              return;
            }
            setAskUser(p);
          }),
        );
        await track(
          api.listen<PiExtensionUiPayload>(
            "session://extension_ui",
            (p) => {
              if (cancelled || !p?.sessionId || !p.method) return;
              const sid = p.sessionId;

              if (p.method === "notify") {
                const message =
                  typeof p.message === "string" ? p.message.trim() : "";
                if (
                  message &&
                  sid === viewingSessionIdRef.current
                ) {
                  setToast(message);
                  window.setTimeout(
                    () => setToast((current) => (current === message ? null : current)),
                    p.notifyType === "error" ? 7200 : 4200,
                  );
                }
                return;
              }

              if (p.method === "set_editor_text") {
                if (
                  sid === viewingSessionIdRef.current &&
                  typeof p.text === "string"
                ) {
                  setDraft(p.text.replace(/\u0000/g, "").slice(0, 100_000));
                }
                return;
              }

              setPiExtensionUiBySession((current) => ({
                ...current,
                [sid]: reducePiExtensionUi(
                  current[sid] ?? EMPTY_PI_EXTENSION_UI,
                  p,
                ),
              }));
            },
          ),
        );
        await track(
          api.listen<{
            entries?: unknown[];
            body?: string | null;
            sessionId?: string;
            rpcId?: number | null;
            toolCallId?: string | null;
            waiting?: boolean;
          }>("session://plan", (p) => {
            if (cancelled) return;
            const readyTitle = trRef.current("plan.ready");
            const composerMode = modeRef.current;
            const targetSid =
              (p.sessionId && p.sessionId.trim()) ||
              viewingSessionIdRef.current ||
              null;

            // Background session: keep plan cache warm without stealing the bar.
            if (
              p.sessionId &&
              p.sessionId !== viewingSessionIdRef.current
            ) {
              const prev =
                planBySessionRef.current.get(p.sessionId) ??
                emptySessionPlan(readyTitle);
              const next = mergePlanFromEvent(
                prev,
                p,
                readyTitle,
                composerMode,
              );
              planBySessionRef.current.set(p.sessionId, next);
              return;
            }

            setPlan((prev) => {
              const next = mergePlanFromEvent(
                prev,
                p,
                readyTitle,
                composerMode,
              );
              // Suppressed hard-dismiss: no UI thrash.
              if (prev.userClosed && next.userClosed) {
                return prev;
              }
              const becameReview =
                next.rpcId != null &&
                (prev.rpcId == null || !prev.visible);
              if (becameReview && next.visible && !next.userClosed) {
                // Auto-open resource Plan workbench when gate is ready.
                queueMicrotask(() => {
                  setLayout((l) => {
                    if (!l.asideCollapsed) return l;
                    const n = openWorkbenchPane(
                      l,
                      "aside",
                      window.matchMedia(NARROW_WORKBENCH_QUERY).matches,
                    );
                    saveLayout(localStorage, n);
                    return n;
                  });
                  setPlanFocusKey((k) => k + 1);
                });
              }
              if (targetSid) {
                planBySessionRef.current.set(targetSid, next);
              }
              return next;
            });
          }),
        );
        await track(
          api.listen<{ sessionId?: string; title?: string }>(
            "session://title",
            (p) => {
              if (cancelled || !p.sessionId || !p.title) return;
              setSessions((list) =>
                list.map((s) =>
                  s.id === p.sessionId ? { ...s, title: p.title! } : s,
                ),
              );
              setSession((prev) =>
                prev.sessionId === p.sessionId
                  ? { ...prev, title: p.title! }
                  : prev,
              );
              setLiveHost((prev) =>
                prev.sessionId === p.sessionId
                  ? { ...prev, title: p.title! }
                  : prev,
              );
            },
          ),
        );
        // Remote IM wrote sessions_index / messages.json — refresh sidebar +
        // reload journal if the user is currently viewing that session.
        await track(
          api.listen<{ sessionId?: string; source?: string }>(
            "session://index_changed",
            (p) => {
              if (cancelled) return;
              void (async () => {
                try {
                  const list = await api.sessionsList();
                  if (cancelled) return;
                  setSessions(
                    list.map((s) => ({
                      id: s.id,
                      title: s.title,
                      projectId: s.projectId,
                      updatedAt: s.updatedAt,
                      archived: !!s.archived,
                      pinned: !!s.pinned,
                      scheduled: !!s.scheduled,
                    })),
                  );
                  const sid = p?.sessionId;
                  if (
                    !sid ||
                    viewingSessionIdRef.current !== sid ||
                    openingSessionIdRef.current
                  ) {
                    return;
                  }
                  // Drop cache so preferSessionMessages cannot hide disk IM turns.
                  messagesBySessionRef.current.delete(sid);
                  const stored = await api.sessionMessages(sid);
                  if (cancelled || viewingSessionIdRef.current !== sid) return;
                  const mapped: ChatMessage[] = stored.map((m) => {
                    const parsed = parseAttachmentsFromContent(m.content);
                    const rawContent =
                      parsed.text ||
                      (parsed.attachments.length ? "" : m.content);
                    const content =
                      m.role === "user"
                        ? hydrateDisplayContent(rawContent)
                        : rawContent;
                    return {
                      id: m.id,
                      role: m.role as "user" | "assistant" | "tool",
                      content,
                      thought: m.thought ?? undefined,
                      isError: m.isError || undefined,
                      createdAt: m.createdAt || undefined,
                      streaming: false,
                    };
                  });
                  messagesBySessionRef.current.set(sid, mapped);
                  setMessages(mapped);
                } catch {
                  /* ignore */
                }
              })();
            },
          ),
        );
      } catch (e) {
        if (!cancelled) setLocalError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((u) => u());
    };
  }, [patchSessionMessages, tryApplyAutomationFromSession]);

  const navigateWorkbench = useCallback(() => {
    setAppView("workbench");
    setMainPane("chat");
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const navigateAutomations = useCallback(() => {
    setAppView("workbench");
    setMainPane("automations");
    setShowUserMenu(false);
    if (typeof window !== "undefined") {
      window.location.hash = "#/automations";
    }
  }, []);

  const persistOpenTarget = useCallback((target: string) => {
    setDefaultOpenTarget(target);
    try {
      localStorage.setItem("pi-app.openTarget", target);
    } catch {
      /* ignore */
    }
    void api.settingsGet().then((s) =>
      api.settingsSet({ ...s, defaultOpenTarget: target }),
    );
  }, []);

  const navigateSettings = useCallback((section: SettingsSectionId = "general") => {
    setSettingsSection(section);
    setAppView("settings");
    setShowUserMenu(false);
    if (typeof window !== "undefined") {
      window.location.hash = `#/settings/${section}`;
    }
  }, []);

  // Hash route: #/settings[/section] | #/automations | #/workbench
  useEffect(() => {
    const syncFromHash = () => {
      const raw = (window.location.hash || "").replace(/^#\/?/, "");
      if (raw.startsWith("settings")) {
        const part = raw.split("/")[1] as SettingsSectionId | undefined;
        const allowed: SettingsSectionId[] = [
          "general",
          "appearance",
          "context",
          "usage",
          "speech",
          "archived",
          "providers-models",
          "extensions",
          "skills",
          "runtime",
          "shortcuts",
          "about",
        ];
        setSettingsSection(
          part && allowed.includes(part) ? part : "general",
        );
        setAppView("settings");
      } else if (raw === "automations" || raw.startsWith("automations")) {
        setAppView("workbench");
        setMainPane("automations");
      } else if (raw === "" || raw === "workbench" || raw === "home") {
        setAppView("workbench");
        setMainPane("chat");
      }
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  /**
   * Focus composer after React commit. Retries until the textarea is mounted
   * (e.g. switching from automations → chat) or attempts run out.
   * Must be called after any await so state updates have been scheduled.
   */
  const requestComposerFocus = useCallback(() => {
    pendingComposerFocus.current = true;
    const tryFocus = (attemptsLeft: number) => {
      const el = composerInputRef.current;
      if (el && el.getAttribute("contenteditable") !== "false") {
        el.focus({ preventScroll: true });
        resizeComposer(el);
        try {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch {
          /* ignore */
        }
        if (document.activeElement === el) {
          pendingComposerFocus.current = false;
          return;
        }
      }
      if (attemptsLeft <= 0) {
        pendingComposerFocus.current = false;
        return;
      }
      requestAnimationFrame(() => tryFocus(attemptsLeft - 1));
    };
    // macOS: button click keeps focus on the button until the next tick.
    window.setTimeout(() => tryFocus(12), 0);
  }, []);

  /**
   * Draft new chat (Codex-style): clear UI only.
   * No store row / CLI until first successful send via ensureConnected.
   * Pass `null` for a project-less session (listed under “Other chats”).
   * Omit / pass undefined to use the active project (requires one).
   */
  const newChat = async (
    project?: Project | null,
    opts?: {
      seedDraft?: string;
      switchToChat?: boolean;
      /** Enter conversation-driven scheduled-task setup mode. */
      automationSetup?: boolean;
    },
  ) => {
    // Explicit null → orphan; undefined → fall back to active project.
    const wantOrphan = project === null;
    const proj = wantOrphan ? null : project || activeProject;
    if (!wantOrphan && !proj) {
      setLocalError(tr("project.addSelectFirst"));
      return;
    }
    if (proj && !remoteRuntime.enabled && !proj.trusted) {
      setLocalError(tr("project.trustFirst", { name: proj.name }));
      return;
    }
    if (proj && !remoteRuntime.enabled && isProjectPathMissing(proj.pathOk)) {
      setLocalError(tr("project.pathMissing", { name: proj.name }));
      return;
    }
    automationSetupDraftRef.current = !!opts?.automationSetup;
    if (opts?.switchToChat !== false) {
      setMainPane("chat");
      setAppView("workbench");
    }
    setActiveProject(proj);
    if (proj) {
      setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
    } else {
      setHistoryOpen(true);
    }
    // Preserve outgoing thread in cache before clearing the draft UI.
    const leavingId = viewingSessionIdRef.current;
    if (leavingId) {
      const cachedLeaving = messagesBySessionRef.current.get(leavingId);
      if (cachedLeaving) {
        messagesBySessionRef.current.set(leavingId, cachedLeaving);
      }
      planBySessionRef.current.set(leavingId, planRef.current);
    }
    viewingSessionIdRef.current = null;
    setMessages([]);
    setContextUsage(INITIAL_CONTEXT_USAGE);
    setDraft(opts?.seedDraft ?? "");
    setAttachments([]);
    sendQueue.clearDraftQueue();
    setPlan(emptySessionPlan(tr("plan.ready")));
    setPerm(null);
    setAskUser(null);
    setRetryStatus(null);
    setSession({
      ...IDLE_SNAPSHOT,
      sessionId: null,
      title: tr("session.new"),
      state: "idle",
      backend: "pi_rpc",
    });
    setLocalError(null);
    // Disconnect any live agent for previous session (best-effort).
    if (api.isTauri()) {
      try {
        await api.sessionDisconnect();
        const idle = { ...IDLE_SNAPSHOT };
        setLiveHost(idle);
        liveHostRef.current = idle;
      } catch {
        /* ignore */
      }
    }
    // Focus explicitly — do not rely only on useEffect: after await, effects may
    // already have run, and identical draft/sessionId can skip a re-render.
    requestComposerFocus();
  };

  const sessionsForProject = (projectId: string) =>
    sessions.filter((s) => s.projectId === projectId && !s.archived);

  const orphanSessions = sessions.filter(
    (s) =>
      (!s.projectId || !projects.some((p) => p.id === s.projectId)) &&
      !s.archived,
  );

  /** Archived chats grouped by project for Settings → Archived. */
  const archivedGroups = useMemo(() => {
    const archived = sessions
      .filter((s) => s.archived)
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    const byProject = new Map<string | null, SessionRow[]>();
    for (const s of archived) {
      const key =
        s.projectId && projects.some((p) => p.id === s.projectId)
          ? s.projectId
          : null;
      const list = byProject.get(key) ?? [];
      list.push(s);
      byProject.set(key, list);
    }
    const groups: Array<{
      id: string | null;
      name: string;
      sessions: SessionRow[];
    }> = [];
    // Stable order: pin projects list order, then orphan bucket.
    for (const p of projects) {
      const list = byProject.get(p.id);
      if (list?.length) {
        groups.push({ id: p.id, name: p.name, sessions: list });
      }
    }
    const orphan = byProject.get(null);
    if (orphan?.length) {
      groups.push({
        id: null,
        name: tr("settings.archived.orphan"),
        sessions: orphan,
      });
    }
    return groups;
  }, [sessions, projects, tr]);

  /**
   * Session id with an active turn (stream / permission) for sidebar spinner.
   * Deliberately excludes `connecting` — warm ACP connect should be silent
   * and must not flash loading on sidebar items.
   */
  const busySessionId =
    liveHost.sessionId && isSessionLiveStreaming(liveHost.state)
      ? liveHost.sessionId
      : null;

  const refreshSessions = useCallback(async () => {
    try {
      const list = await api.sessionsList();
      setSessions(
        list.map((s) => ({
          id: s.id,
          title: s.title,
          projectId: s.projectId,
          updatedAt: s.updatedAt,
          archived: !!s.archived,
          pinned: !!s.pinned,
          scheduled: !!s.scheduled,
        })),
      );
      void api.trayRefresh();
    } catch {
      /* ignore */
    }
  }, []);

  const refreshProjects = async () => {
    try {
      const list = await api.projectsList();
      const mapped = list.map((p) => ({
        ...p,
        pinned: !!p.pinned,
      })) as Project[];
      setProjects(mapped);
      // Keep active project pathOk/path in sync with Host re-check.
      setActiveProject((prev) => {
        if (!prev) return prev;
        return mapped.find((x) => x.id === prev.id) ?? prev;
      });
    } catch {
      /* ignore */
    }
  };

  const applySessionTitle = useCallback(
    (sessionId: string, title: string) => {
      setSessions((list) =>
        list.map((s) => (s.id === sessionId ? { ...s, title } : s)),
      );
      setSession((prev) =>
        prev.sessionId === sessionId ? { ...prev, title } : prev,
      );
      void api.trayRefresh();
    },
    [],
  );

  const { openSession, ensureConnected } = useSessionLifecycle({
    projects,
    sessions,
    activeProject,
    session,
    connecting,
    mode,
    remoteRuntime,
    resourceProjectPath,
    appGate,
    reopenLastSession,
    lastSessionId,
    tr,
    refreshSessions,
    tryApplyAutomationFromSession,
    messagesBySessionRef,
    messagesRef,
    viewingSessionIdRef,
    openingSessionIdRef,
    planBySessionRef,
    planRef,
    liveHostRef,
    setMainPane,
    setAppView,
    setMessages,
    setContextUsage,
    setSessionChangesById,
    setPlan,
    setEditingUserMessageId,
    setEditAttachments,
    setSessions,
    setActiveProject,
    setRemoteWorkspacePath,
    setAttachments,
    setSession,
    setLiveHost,
    setLocalError,
    setPerm,
    setAskUser,
    setRetryStatus,
    setLastSessionId,
    setConnecting,
    setExpandedProjects,
    setHistoryOpen,
  });

  const renameProject = (proj: Project) => {
    setCtxMenu(null);
    setAppDialog({
      kind: "prompt",
      title: tr("project.rename"),
      initial: proj.name,
      onSubmit: async (name) => {
        const next = name.trim();
        if (!next || next === proj.name) return;
        try {
          await api.projectRename(proj.id, next);
          await refreshProjects();
          void api.trayRefresh();
          if (activeProject?.id === proj.id) {
            setActiveProject((p) => (p ? { ...p, name: next } : p));
          }
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  /**
   * Pick a new folder for a project whose path is gone or moved (D05).
   * Host persists path and re-checks is_dir → pathOk true.
   */
  const relocateProject = async (proj: Project) => {
    setCtxMenu(null);
    if (!api.isTauri()) {
      setLocalError(tr("error.needTauri"));
      return;
    }
    try {
      const dir = await api.pickDirectory();
      if (!dir) return;
      const updated = (await api.projectRelocate(proj.id, dir)) as Project;
      await refreshProjects();
      void api.trayRefresh();
      if (activeProject?.id === proj.id) {
        setActiveProject(updated);
        // Force reconnect on next send — cwd changed.
        setSession((prev) =>
          prev.sessionId
            ? {
                ...IDLE_SNAPSHOT,
                sessionId: prev.sessionId,
                title: prev.title,
                state: "idle",
                backend: prev.backend || "pi_rpc",
              }
            : prev,
        );
        setLiveHost((prev) =>
          prev.sessionId ? { ...IDLE_SNAPSHOT } : prev,
        );
      }
      setLocalError(null);
      const msg = tr("project.relocateOk", {
        name: updated.name,
        path: updated.path,
      });
      setToast(msg);
      window.setTimeout(
        () => setToast((cur) => (cur === msg ? null : cur)),
        3200,
      );
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /**
   * Apply a project-level permission tier (L10).
   * `null` clears the override so the app default is used again.
   * YOLO still requires the same two-step confirm as the composer chip.
   */
  const applyProjectPermissionPolicy = (
    proj: Project,
    next: PermissionPolicyId | null,
  ) => {
    setCtxMenu(null);

    const commit = async () => {
      try {
        const updated = (await api.projectSetPermissionPolicy(
          proj.id,
          next,
        )) as Project;
        await refreshProjects();
        if (activeProject?.id === proj.id) {
          setActiveProject((p) =>
            p
              ? {
                  ...p,
                  permissionPolicy: updated.permissionPolicy ?? null,
                }
              : p,
          );
          const prefs = await api.composerPrefsResolve({
            projectId: proj.id,
            sessionId: session.sessionId ?? null,
          });
          applyComposerPrefs(prefs, availableModels);
        }
        const msg = next
          ? tr("project.permissionSet", {
              name: proj.name,
              policy: tr(
                (
                  {
                    ask: "policy.short.ask",
                    accept_edits: "policy.short.accept_edits",
                    allow_for_session: "policy.short.allow_for_session",
                    dont_ask: "policy.short.dont_ask",
                    always_approve: "policy.short.always_approve",
                  } as const
                )[next],
              ),
            })
          : tr("project.permissionCleared", { name: proj.name });
        setToast(msg);
        window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2800);
      } catch (e) {
        setLocalError(String(e));
      }
    };

    if (next === "always_approve") {
      setAppDialog({
        kind: "confirm",
        title: tr("policy.always_approve"),
        message: tr("policy.yoloConfirm"),
        confirmLabel: tr("common.confirm"),
        danger: true,
        onConfirm: () => {
          setAppDialog({
            kind: "confirm",
            title: tr("policy.always_approve"),
            message: tr("policy.yoloConfirm2"),
            confirmLabel: tr("policy.short.always_approve"),
            danger: true,
            onConfirm: () => {
              void commit();
            },
          });
        },
      });
      return;
    }

    void commit();
  };

  /** Remove project from app list only (disk folder + chats kept). */
  const removeProjectFromApp = (proj: Project) => {
    setCtxMenu(null);
    setAppDialog({
      kind: "confirm",
      title: tr("project.removeTitle"),
      message: tr("project.removeConfirmDetail", { name: proj.name }),
      confirmLabel: tr("project.remove"),
      danger: true,
      onConfirm: async () => {
        try {
          if (!api.isTauri()) {
            setLocalError(tr("error.needTauri"));
            return;
          }
          await api.projectRemove(proj.id);
          if (activeProject?.id === proj.id) {
            setActiveProject(null);
            setSession(IDLE_SNAPSHOT);
            setMessages([]);
          }
          await refreshProjects();
          await refreshSessions();
          setLocalError(null);
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  const renameSession = (s: SessionRow) => {
    setCtxMenu(null);
    setAppDialog({
      kind: "prompt",
      title: tr("session.renamePrompt"),
      initial: s.title || tr("session.untitled"),
      placeholder: tr("session.renamePlaceholder"),
      onSubmit: async (title) => {
        const next = title.trim();
        if (!next) return;
        try {
          await api.sessionRename(s.id, next);
          applySessionTitle(s.id, next);
          await refreshSessions();
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  /**
   * Archive / unarchive a session.
   * If the open conversation is archived, leave it for a fresh draft so the
   * main pane does not keep showing a chat that disappeared from the tree.
   */
  const archiveSession = async (s: SessionRow, archived = true) => {
    setCtxMenu(null);
    const wasViewing =
      archived &&
      (session.sessionId === s.id || viewingSessionIdRef.current === s.id);
    try {
      await api.sessionSetArchived(s.id, archived);
      await refreshSessions();
      if (wasViewing) {
        const proj = s.projectId
          ? projects.find((p) => p.id === s.projectId) ?? null
          : null;
        // Same project context when possible; orphan → “Other chats” draft.
        if (proj) await newChat(proj, { switchToChat: true });
        else await newChat(null, { switchToChat: true });
      } else if (!archived && s.projectId) {
        setExpandedProjects((e) => ({ ...e, [s.projectId!]: true }));
      }
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /** Pin / unpin a session (floats to top of its sidebar group). */
  const pinSession = async (s: SessionRow, pinned = true) => {
    setCtxMenu(null);
    try {
      await api.sessionSetPinned(s.id, pinned);
      await refreshSessions();
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /** Permanent delete — confirm first; leave workbench if viewing that chat. */
  const deleteSessionConfirm = (s: SessionRow) => {
    deleteSessionsConfirm([s]);
  };

  /** Bulk restore archived sessions. */
  const restoreSessions = async (rows: SessionRow[]) => {
    if (!rows.length) return;
    try {
      if (!api.isTauri()) {
        setLocalError(tr("error.needTauri"));
        return;
      }
      for (const s of rows) {
        await api.sessionSetArchived(s.id, false);
        if (s.projectId) {
          setExpandedProjects((e) => ({ ...e, [s.projectId!]: true }));
        }
      }
      await refreshSessions();
      setLocalError(null);
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /** Bulk permanent delete with one confirm. */
  const deleteSessionsConfirm = (rows: SessionRow[]) => {
    setCtxMenu(null);
    if (!rows.length) return;
    const n = rows.length;
    const title =
      n === 1
        ? rows[0].title || tr("session.untitled")
        : tr("session.deleteManyTitle");
    const message =
      n === 1
        ? tr("session.deleteConfirm", {
            name: rows[0].title || tr("session.untitled"),
          })
        : tr("session.deleteManyConfirm", { n: String(n) });
    setAppDialog({
      kind: "confirm",
      title: n === 1 ? tr("session.deleteTitle") : title,
      message,
      confirmLabel: tr("session.delete"),
      danger: true,
      onConfirm: async () => {
        try {
          if (!api.isTauri()) {
            setLocalError(tr("error.needTauri"));
            return;
          }
          const openId =
            session.sessionId ?? viewingSessionIdRef.current ?? null;
          const wasViewing = !!openId && rows.some((s) => s.id === openId);
          const viewingRow = wasViewing
            ? rows.find((s) => s.id === openId)
            : null;
          const deletedIds = new Set(rows.map((s) => s.id));
          for (const s of rows) {
            await api.sessionDelete(s.id);
            messagesBySessionRef.current.delete(s.id);
            planBySessionRef.current.delete(s.id);
          }
          sendQueue.dropSessions(deletedIds);
          await refreshSessions();
          if (wasViewing && viewingRow) {
            const proj = viewingRow.projectId
              ? projects.find((p) => p.id === viewingRow.projectId) ?? null
              : null;
            if (proj) await newChat(proj, { switchToChat: true });
            else await newChat(null, { switchToChat: true });
          }
          setLocalError(null);
        } catch (e) {
          setLocalError(String(e));
        }
      },
    });
  };

  /** Archive all chats under a project; exit mid-pane if current chat is among them. */
  const archiveProjectSessions = async (proj: Project) => {
    setCtxMenu(null);
    const openId = session.sessionId ?? viewingSessionIdRef.current;
    const openBelongs =
      !!openId &&
      sessions.some((s) => s.id === openId && s.projectId === proj.id);
    try {
      await api.projectArchiveSessions(proj.id);
      await refreshSessions();
      if (openBelongs) {
        await newChat(proj, { switchToChat: true });
      }
    } catch (e) {
      setLocalError(String(e));
    }
  };

  const copySessionId = async (s: SessionRow) => {
    setCtxMenu(null);
    try {
      await navigator.clipboard.writeText(s.id);
    } catch {
      setLocalError(s.id);
    }
  };

  const openSessionMenu = (e: ReactMouseEvent, s: SessionRow) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ kind: "session", id: s.id, x: e.clientX, y: e.clientY });
  };

  const openProjectMenu = (e: ReactMouseEvent, proj: Project) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ kind: "project", id: proj.id, x: e.clientX, y: e.clientY });
  };

  const searchHits = useMemo(
    () =>
      filterSessionSearch(
        searchQuery,
        sessions.map((s) => ({
          id: s.id,
          title: s.title,
          projectId: s.projectId,
          archived: s.archived,
        })),
        projects.map((p) => ({ id: p.id, name: p.name, path: p.path })),
      ),
    [searchQuery, sessions, projects],
  );

  const mergedSessionHits = useMemo(
    () =>
      mergeSessionSearchHits(
        searchQuery,
        searchHits.matchedSessions,
        contentSearchHits,
      ),
    [searchQuery, searchHits.matchedSessions, contentSearchHits],
  );
  const filteredSessionHits = useMemo(
    () => mergedSessionHits.filter((hit) => {
      const row = sessions.find((item) => item.id === hit.id);
      return (!searchModelFilter || row?.modelId === searchModelFilter) &&
        (!searchProjectFilter || (row?.projectId ?? hit.projectId) === searchProjectFilter);
    }),
    [mergedSessionHits, searchModelFilter, searchProjectFilter, sessions],
  );

  const paletteCommands = useMemo(() => {
    const commands = [
      {
        id: "settings",
        label: tr("palette.openSettings"),
        run: () => {
          setShowSearch(false);
          setAppView("settings");
          setSettingsSection("general");
          window.location.hash = "#/settings/general";
        },
      },
      {
        id: "automations",
        label: tr("palette.openAutomations"),
        run: () => {
          setShowSearch(false);
          setMainPane("automations");
          setAppView("workbench");
          window.location.hash = "#/automations";
        },
      },
      {
        id: "new-chat",
        label: tr("search.newChat"),
        run: () => {
          setShowSearch(false);
          void newChat(activeProject);
        },
      },
      {
        id: "start-batch",
        label: tr("palette.startBatch"),
        run: () => {
          setShowSearch(false);
          taskBatchDraftRef.current = true;
          setDraft("/parallel ");
          requestComposerFocus();
        },
      },
      ...sessions.filter((item) => item.pinned).slice(0, 9).map((row) => ({
        id: `session:${row.id}`,
        label: `${tr("palette.switchSession")} · ${row.title || tr("session.untitled")}`,
        run: () => {
          setShowSearch(false);
          void openSession(row, projects.find((project) => project.id === row.projectId));
        },
      })),
      ...projects.map((project) => ({
        id: `project:${project.id}`,
        label: `${tr("palette.switchProject")} · ${project.name}`,
        run: () => {
          setShowSearch(false);
          void newChat(project);
        },
      })),
      ...WORKSPACE_IDS.map((id) => ({
        id: `workspace:${id}`,
        label: `${tr("palette.switchWorkspace")} · ${tr(`workspace.${id}`)}`,
        run: () => {
          setShowSearch(false);
          setWorkspace(id);
          saveWorkspace(localStorage, id);
        },
      })),
      ...availableModels.map((model) => ({
        id: `model:${model.id}`,
        label: `${tr("palette.switchModel")} · ${model.label || model.id}`,
        run: () => {
          setShowSearch(false);
          setModelId(model.id);
          void api.composerPrefsSet({
            projectId: activeProject?.id ?? null,
            sessionId: session.sessionId ?? null,
            modelId: model.id,
          });
        },
      })),
    ];
    const query = searchQuery.trim().replace(/^>/, "").trim().toLowerCase();
    return query
      ? commands.filter((command) => command.label.toLowerCase().includes(query))
      : commands;
  }, [activeProject, availableModels, newChat, openSession, projects, requestComposerFocus, searchQuery, session.sessionId, sessions, tr]);

  /** Session row currently open in the workbench (drives the top-bar ⋯ menu). */
  const activeSessionRow = useMemo(
    () => sessions.find((s) => s.id === session.sessionId) ?? null,
    [sessions, session.sessionId],
  );

  const isPlaceholderTitle = useCallback(
    (title: string | undefined | null) => {
      const t = (title || "").trim();
      if (!t) return true;
      const placeholders = [
        tr("session.new"),
        tr("session.placeholderTitle"),
        tr("session.untitled"),
        "New chat",
        "Untitled",
      ];
      return placeholders.some((p) => p.toLowerCase() === t.toLowerCase());
    },
    [tr],
  );

  /**
   * `/compact [note]` — in-app prompt for optional keep-note (CLI supports a
   * context note of what to retain). Empty → `/compact`; non-empty → `/compact {note}`.
   * Never uses window.prompt (unreliable in Tauri WebView).
   */
  const openCompactWithNote = () => {
    setAppDialog({
      kind: "prompt",
      title: tr("slash.compact"),
      message: tr("slash.compactConfirm"),
      initial: "",
      placeholder: tr("slash.compactNote"),
      submitLabel: tr("slash.compactConfirmOk"),
      onSubmit: (value) => {
        void (async () => {
          const note = value.trim();
          const cmd = note ? `/compact ${note}` : "/compact";
          try {
            const sid = await ensureConnected();
            if (!sid) return;
            await api.sessionSend(cmd, null, null, sid);
          } catch (err) {
            setLocalError(String(err));
          }
        })();
      },
    });
  };

  const attachLabels = useMemo(
    () => ({
      open: tr("attach.open"),
      reveal: tr("attach.reveal"),
      copyPath: tr("attach.copyPath"),
      copyImage: tr("attach.copyImage"),
      addToComposer: tr("attach.addToComposer"),
      remove: tr("composer.attachRemove"),
      viewImage: tr("image.view"),
    }),
    [tr],
  );

  const lastUserMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return messages[i]!.id;
    }
    return null;
  }, [messages]);

  const canEditLastUser =
    !!lastUserMessageId &&
    canSend(session.state) &&
    !connecting &&
    session.state !== "streaming" &&
    session.state !== "awaiting_permission";

  /** Idle-ish: allow fork / rewind from transcript (not mid-turn). */
  const canRewindSession =
    canSend(session.state) &&
    !connecting &&
    !editSubmitting &&
    !rewindBusy;

  const queuePreviewLabels = useMemo(
    () => ({
      filesCount: (n: number) =>
        tr("composer.queueFilesCount", { n: String(n) }),
      empty: tr("composer.queueEmptyPreview"),
    }),
    [tr],
  );

  const addAttachmentsFromPaths = useCallback(

    async (paths: string[]) => {
      if (!paths.length) {
        setLocalError(tr("attach.droppedNone"));
        return;
      }
      // While inline-editing a sent message, drops target the edit form — not the composer.
      const intoEdit = !!editingUserMessageIdRef.current;
      const mergeInto = intoEdit ? setEditAttachments : setAttachments;
      try {
        if (!api.isTauri()) {
          mergeInto((prev) =>
            mergeAttachments(
              prev,
              paths.map((p) => ({
                path: p,
                name: p.split(/[/\\]/).pop() || p,
                isDir: false,
              })),
            ),
          );
          return;
        }
        const classified = await api.pathsClassify(paths);
        // Accept all formats (images, docs, …). Keep entries even if exists is false
        // so transient sandbox / iCloud paths still show; open may fail later.
        const next = classified.map((c) => ({
          path: c.path,
          name: c.name,
          isDir: c.isDir,
        }));
        if (!next.length) {
          setLocalError(tr("attach.droppedNone"));
          return;
        }
        mergeInto((prev) => mergeAttachments(prev, next));
        setLocalError(null);
      } catch (e) {
        setLocalError(String(e));
      }
    },
    [tr],
  );

  /** Web File list (paste / HTML5 drop) → absolute paths for agent `@path`. */
  const addAttachmentsFromFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const withPath: string[] = [];
      const withoutPath: File[] = [];
      for (const f of files) {
        const anyF = f as File & { path?: string };
        if (anyF.path) withPath.push(anyF.path);
        else withoutPath.push(f);
      }
      if (withPath.length) {
        await addAttachmentsFromPaths(withPath);
      }
      if (!withoutPath.length) return;
      if (!api.isTauri()) {
        setLocalError(tr("composer.attachPasteFailed"));
        return;
      }
      const intoEdit = !!editingUserMessageIdRef.current;
      const mergeInto = intoEdit ? setEditAttachments : setAttachments;
      try {
        let lastName = "";
        for (const f of withoutPath) {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          // Chunked base64 to avoid call-stack limits on large pastes
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(
              ...bytes.subarray(i, Math.min(i + chunk, bytes.length)),
            );
          }
          const b64 = btoa(binary);
          const name =
            f.name && f.name !== "image.png" && f.name !== "blob"
              ? f.name
              : f.type?.startsWith("image/")
                ? `paste.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`
                : f.name || "paste.bin";
          const entry = await api.saveTempAttachment(b64, name, f.type || null);
          lastName = entry.name;
          mergeInto((prev) =>
            mergeAttachments(prev, [
              {
                path: entry.path,
                name: entry.name,
                isDir: entry.isDir,
              },
            ]),
          );
        }
        setLocalError(null);
        if (lastName) {
          const msg = tr("composer.attachSaved", { name: lastName });
          setToast(msg);
          window.setTimeout(
            () => setToast((cur) => (cur === msg ? null : cur)),
            2200,
          );
        }
      } catch (e) {
        setLocalError(String(e) || tr("composer.attachPasteFailed"));
      }
    },
    [addAttachmentsFromPaths, tr],
  );

  /**
   * Native OS clipboard image (arboard) when WebView paste has no File objects.
   * Used for macOS screenshots / system image clipboard.
   */
  const pasteMediaFromNativeClipboard = useCallback(
    async (opts?: { expectMedia?: boolean }) => {
      if (!api.isTauri()) {
        if (opts?.expectMedia) {
          setLocalError(tr("composer.attachPasteFailed"));
        }
        return;
      }
      try {
        const entry = await api.clipboardPasteImage();
        if (!entry?.path) {
          if (opts?.expectMedia) {
            setLocalError(tr("composer.attachPasteFailed"));
          }
          return;
        }
        await addAttachmentsFromPaths([entry.path]);
        setLocalError(null);
        const msg = tr("composer.attachSaved", { name: entry.name });
        setToast(msg);
        window.setTimeout(
          () => setToast((cur) => (cur === msg ? null : cur)),
          2200,
        );
      } catch (e) {
        setLocalError(String(e) || tr("composer.attachPasteFailed"));
      }
    },
    [addAttachmentsFromPaths, tr],
  );

  const closeComposerMenu = useCallback(() => {
    const live = liveSlashRef.current;
    if (live.present) {
      slashDismissedSigRef.current = `${live.start}:${live.query}`;
    }
    const liveAtNow = liveAtRef.current;
    if (liveAtNow.present) {
      atDismissedSigRef.current = `${liveAtNow.start}:${liveAtNow.query}`;
    }
    const atCleared = { present: false, query: "", start: 0, end: 0 };
    setLiveAt(atCleared);
    liveAtRef.current = atCleared;
    setAtActiveIndex(0);
    setShowComposerPlus(false);
    setSlashQuery(null);
    const cleared = { present: false, query: "", start: 0, end: 0 };
    setLiveSlash(cleared);
    liveSlashRef.current = cleared;
  }, []);

  /** Stable slash-query setter: skip no-op updates so filter effects don't thrash. */
  const onSlashQueryChange = useCallback(
    (q: { start: number; query: string; end: number } | null) => {
      setSlashQuery((prev) => {
        if (q == null) return prev == null ? prev : null;
        if (
          prev &&
          prev.start === q.start &&
          prev.query === q.query &&
          prev.end === q.end
        ) {
          return prev;
        }
        return q;
      });
    },
    [],
  );

  const pickComposerFiles = useCallback(async () => {
    closeComposerMenu();
    if (!api.isTauri()) {
      setLocalError(tr("composer.attachPasteFailed"));
      return;
    }
    try {
      const paths = await api.pickAttachFiles();
      if (!paths.length) {
        // Cancelled — no error.
        return;
      }
      await addAttachmentsFromPaths(paths);
      setLocalError(null);
      const label =
        paths.length === 1
          ? paths[0]!.split(/[/\\]/).pop() || paths[0]!
          : tr("composer.attachCount", { n: String(paths.length) });
      const msg =
        paths.length === 1
          ? tr("composer.attachSaved", { name: label })
          : tr("composer.attachSaved", { name: label });
      setToast(msg);
      window.setTimeout(
        () => setToast((cur) => (cur === msg ? null : cur)),
        2200,
      );
    } catch (e) {
      setLocalError(String(e) || tr("composer.attachPasteFailed"));
    }
  }, [addAttachmentsFromPaths, closeComposerMenu, tr]);

  const addProjectsFromPaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length || !api.isTauri()) return;
      try {
        const classified = await api.pathsClassify(paths);
        const dirs = classified.filter((c) => c.exists && c.isDir);
        if (!dirs.length) {
          setLocalError(tr("composer.dropProjectFilesOnly"));
          return;
        }
        let last: Project | null = null;
        for (const d of dirs) {
          last = (await api.projectAdd(d.path, false)) as Project;
        }
        const list = (await api.projectsList()) as Project[];
        setProjects(list);
        if (last) {
          setActiveProject(list.find((p) => p.id === last!.id) ?? last);
          setExpandedProjects((e) => ({ ...e, [last!.id]: true }));
          setLocalError(null);
          setToast(tr("composer.projectAdded", { name: last.name }));
          window.setTimeout(() => setToast(null), 2500);
        }
      } catch (e) {
        setLocalError(String(e));
      }
    },
    [tr],
  );

  /**
   * Hit-test CSS client point against the live sidebar box.
   * Only the real left rail is "sidebar" (add project); rest of workbench is attach.
   */
  const hitDragZone = useCallback(
    (clientX: number, clientY: number): "sidebar" | "main" => {
      const collapsed = layoutRef.current.sidebarCollapsed;
      if (collapsed) return "main";
      const el = querySidebarEl();
      if (!el) return "main";
      return hitDragZoneFromRects(
        clientX,
        clientY,
        el.getBoundingClientRect(),
        false,
      );
    },
    [],
  );

  // Tauri OS file drag-drop (full absolute paths)
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const webview = getCurrentWebview();
        const win = getCurrentWindow();
        const factor = await win.scaleFactor();

        unlisten = await webview.onDragDropEvent((event) => {
          if (cancelled) return;
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "drop") {
            if ("paths" in payload && payload.paths?.length) {
              dragPathsRef.current = payload.paths;
            }
          }
          if (payload.type === "leave") {
            setDragZone(null);
            dragPathsRef.current = [];
            return;
          }
          if (payload.type === "enter" || payload.type === "over") {
            // macOS: coords are already view points; win: physical → / factor
            const { x, y } = toClientDragPoint(
              payload.position,
              factor,
              platform,
            );
            setDragZone(hitDragZone(x, y));
            return;
          }
          if (payload.type === "drop") {
            const { x, y } = toClientDragPoint(
              payload.position,
              factor,
              platform,
            );
            const zone = hitDragZone(x, y);
            const paths = payload.paths?.length
              ? payload.paths
              : dragPathsRef.current;
            setDragZone(null);
            dragPathsRef.current = [];
            if (!paths.length) {
              setLocalError(tr("attach.droppedNone"));
              return;
            }
            if (zone === "sidebar") {
              void addProjectsFromPaths(paths);
            } else {
              // All file types (images, pdf, …) attach in main zone
              void addAttachmentsFromPaths(paths);
            }
          }
        });
      } catch {
        /* webview API unavailable */
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [
    addAttachmentsFromPaths,
    addProjectsFromPaths,
    hitDragZone,
    platform,
    tr,
  ]);

  // HTML5 fallback: some image drags only expose File list in the webview.
  // Prefer Tauri paths; use File.path when present (Tauri webview).
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      // If Tauri already handled this OS drop, paths may be empty here.
      const files = Array.from(e.dataTransfer.files);
      const paths = files
        .map((f) => {
          const anyF = f as File & { path?: string };
          return anyF.path || "";
        })
        .filter(Boolean);
      const zone = hitDragZone(e.clientX, e.clientY);
      if (paths.length) {
        e.preventDefault();
        e.stopPropagation();
        if (zone === "sidebar") void addProjectsFromPaths(paths);
        else void addAttachmentsFromPaths(paths);
        return;
      }
      // Browser-only / path-less File list (e.g. image from another app)
      if (zone !== "sidebar" && files.length) {
        e.preventDefault();
        e.stopPropagation();
        void addAttachmentsFromFiles(files);
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [
    addAttachmentsFromFiles,
    addAttachmentsFromPaths,
    addProjectsFromPaths,
    hitDragZone,
  ]);

  // Drag-resize right resource pane
  useEffect(() => {
    if (!resizingAside) return;
    const onMove = (e: PointerEvent) => {
      const next = clampAsideWidth(window.innerWidth - e.clientX);
      setLayout((l) => {
        const n = { ...l, asideWidth: next, asideCollapsed: false };
        return n;
      });
    };
    const onUp = () => {
      setResizingAside(false);
      setLayout((l) => {
        saveLayout(localStorage, l);
        return l;
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
  }, [resizingAside]);

  const resizeComposer = (el: HTMLElement) => {
    const line = 22; // ~line-height
    const min = line * 1;
    const max = line * 10;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
  };

  /** Programmatic draft / layout changes: recompute height after paint. */
  const syncComposerHeight = useCallback(() => {
    // Double rAF: wait for React commit + layout after mainPane switch.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const node = composerInputRef.current;
        if (node) resizeComposer(node);
      });
    });
  }, []);

  // Pi package management is surfaced in Settings. Pi RPC does not expose the
  // legacy inspect catalog, so the built-in slash palette remains local.

  const slashCatalog = useMemo(
    () => buildSlashCatalog(skillInfos),
    [skillInfos],
  );
  const resolveSlashTitle = useCallback(
    (item: SlashItem) => {
      if (item.titleKey) {
        try {
          return tr(item.titleKey as MessageKey);
        } catch {
          /* fall through */
        }
      }
      return item.displayTitle || item.name;
    },
    [tr],
  );
  const resolveSlashDescription = useCallback(
    (item: SlashItem) => {
      if (item.descriptionKey) {
        try {
          return tr(item.descriptionKey as MessageKey);
        } catch {
          /* fall through */
        }
      }
      return item.displayDescription || "";
    },
    [tr],
  );
  /** Filter query from live editor poll only. */
  const slashFilterQuery = liveSlash.present ? liveSlash.query : "";

  /** Shared filter for + menu and `/` slash — empty query = full catalog. */
  const slashFiltered = useMemo(
    () =>
      flattenFilteredCatalog(slashCatalog, slashFilterQuery, (item) => ({
        title: resolveSlashTitle(item),
        description: resolveSlashDescription(item),
      })),
    [
      slashCatalog,
      slashFilterQuery,
      resolveSlashTitle,
      resolveSlashDescription,
    ],
  );
  const showUploadInMenu = useMemo(
    () =>
      uploadMatchesQuery(slashFilterQuery, {
        title: tr("composer.addFiles"),
        hint: tr("composer.addFilesHint"),
      }),
    [slashFilterQuery, tr],
  );
  const composerMenuEntries = useMemo(
    () =>
      buildComposerPlusEntries({
        showUpload: showUploadInMenu,
        commands: slashFiltered.commands,
        skills: slashFiltered.skills,
      }),
    [showUploadInMenu, slashFiltered.commands, slashFiltered.skills],
  );
  const composerMenuEntriesRef = useRef(composerMenuEntries);
  composerMenuEntriesRef.current = composerMenuEntries;

  /** `@` reference picker is open while a live `@` token sits at the caret. */
  const atMenuOpen = liveAt.present;
  /** `+` button and `/` open the same palette — but never while `@` is active. */
  const composerMenuOpen =
    (showComposerPlus || liveSlash.present) && !atMenuOpen;

  /** Files of the active project for the `@` picker (root listing). */
  useEffect(() => {
    if (!atMenuOpen || !resourceProjectPath || !api.isTauri()) {
      setAtFiles([]);
      setAtLoading(false);
      return;
    }
    let alive = true;
    setAtLoading(true);
    api
      .fsListDir(resourceProjectPath, "")
      .then((list) => {
        if (!alive) return;
        setAtFiles(list ?? []);
        setAtLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setAtFiles([]);
        setAtLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [atMenuOpen, resourceProjectPath]);

  /** Navigable `@` rows: attach-file, attach-folder, then project files. */
  const atItems = useMemo<AtItem[]>(() => {
    const out: AtItem[] = [
      { id: "at-attach-file", kind: "attach-file" },
      { id: "at-attach-folder", kind: "attach-folder" },
    ];
    const q = liveAt.query.trim().toLowerCase();
    const files = atFiles
      .filter(
        (f) =>
          !q ||
          f.name.toLowerCase().includes(q) ||
          f.relativePath.toLowerCase().includes(q),
      )
      .sort((a, b) =>
        a.isDir === b.isDir
          ? a.name.localeCompare(b.name)
          : a.isDir
            ? -1
            : 1,
      );
    for (const f of files) {
      out.push({
        id: `at-f-${f.relativePath}`,
        kind: "file",
        name: f.name,
        relativePath: f.relativePath,
        isDir: f.isDir,
      });
    }
    return out;
  }, [atFiles, liveAt.query]);
  const atItemsRef = useRef(atItems);
  atItemsRef.current = atItems;

  // Reset `@` highlight when the query string changes.
  const prevAtQueryRef = useRef(liveAt.query);
  useEffect(() => {
    if (prevAtQueryRef.current === liveAt.query) return;
    prevAtQueryRef.current = liveAt.query;
    setAtActiveIndex(0);
  }, [liveAt.query]);

  // Keep `@` highlight in range when the filtered list shrinks.
  useEffect(() => {
    setAtActiveIndex((i) =>
      atItems.length === 0
        ? 0
        : i >= atItems.length
          ? atItems.length - 1
          : i,
    );
  }, [atItems.length]);

  const applyAtPick = useCallback(
    (item: AtItem) => {
      const live = liveAtRef.current;
      const clearToken = () => {
        if (live.present) {
          setDraft((d) => d.slice(0, live.start) + d.slice(live.end));
        }
        const cleared = { present: false, query: "", start: 0, end: 0 };
        setLiveAt(cleared);
        liveAtRef.current = cleared;
        atDismissedSigRef.current = null;
        setAtActiveIndex(0);
      };
      if (item.kind === "attach-file") {
        clearToken();
        void pickComposerFiles();
        return;
      }
      if (item.kind === "attach-folder") {
        clearToken();
        if (api.isTauri()) {
          void api
            .pickAttachFolder()
            .then((p) => {
              if (p) return addAttachmentsFromPaths([p]);
            })
            .catch((e) => setLocalError(String(e)));
        }
        return;
      }
      const abs = joinAtPath(activeProject?.path ?? "", item.relativePath);
      clearToken();
      void addAttachmentsFromPaths([abs]);
    },
    [activeProject?.path, addAttachmentsFromPaths, pickComposerFiles],
  );

  /**
   * rAF poll of composer innerText → live slash token.
   * Single source of truth for open state + filter (not React draft).
   */
  useEffect(() => {
    let raf = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const el = composerInputRef.current;
      const detected = detectSlashQueryFromEditor(el);
      let next = detected
        ? {
            present: true as const,
            query: detected.query,
            start: detected.start,
            end: detected.end,
          }
        : {
            present: false as const,
            query: "",
            start: 0,
            end: 0,
          };
      // Honor Escape dismiss until the user edits the `/token`.
      if (next.present && slashDismissedSigRef.current != null) {
        const sig = `${next.start}:${next.query}`;
        if (sig === slashDismissedSigRef.current) {
          next = { present: false, query: "", start: 0, end: 0 };
        } else {
          slashDismissedSigRef.current = null;
        }
      }
      if (!next.present && detected == null) {
        slashDismissedSigRef.current = null;
      }
      const prev = liveSlashRef.current;
      if (
        prev.present !== next.present ||
        prev.query !== next.query ||
        prev.start !== next.start ||
        prev.end !== next.end
      ) {
        liveSlashRef.current = next;
        setLiveSlash(next);
        if (next.present) {
          setSlashQuery({
            start: next.start,
            query: next.query,
            end: next.end,
          });
        } else if (!showComposerPlusRef.current) {
          setSlashQuery((q) => (q == null ? q : null));
        }
      }
      const detectedAt = detectAtQueryFromEditor(el);
      let atNext = detectedAt
        ? {
            present: true as const,
            query: detectedAt.query,
            start: detectedAt.start,
            end: detectedAt.end,
          }
        : { present: false as const, query: "", start: 0, end: 0 };
      if (atNext.present && atDismissedSigRef.current != null) {
        const sig = `${atNext.start}:${atNext.query}`;
        if (sig === atDismissedSigRef.current) {
          atNext = { present: false, query: "", start: 0, end: 0 };
        } else {
          atDismissedSigRef.current = null;
        }
      }
      if (!atNext.present && detectedAt == null) {
        atDismissedSigRef.current = null;
      }
      const prevAt = liveAtRef.current;
      if (
        prevAt.present !== atNext.present ||
        prevAt.query !== atNext.query ||
        prevAt.start !== atNext.start ||
        prevAt.end !== atNext.end
      ) {
        liveAtRef.current = atNext;
        setLiveAt(atNext);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  /** Pin above input card; width matches composer shell.
   * Re-anchor when filter results change height (short list must sit on input). */
  // `/` palette — anchored to the composer, as wide as the input.
  const slashAnchor = useFloatingMenu({
    open: liveSlash.present,
    triggerRef: composerShellRef,
    panelRef: composerPlusPanelRef,
    roots: [composerPlusTriggerRef, composerShellRef, composerInputRef],
    onClose: closeComposerMenu,
    placement: "up",
    fitContent: false,
    matchTriggerWidth: true,
    minWidth: 280,
    estHeight: 220,
    gap: 8,
    deps: [slashFilterQuery, composerMenuEntries.length],
  });
  // `+` palette — a compact popover anchored to the + button itself.
  const plusAnchor = useFloatingMenu({
    open: showComposerPlus && !liveSlash.present,
    triggerRef: composerPlusTriggerRef,
    panelRef: composerPlusPanelRef,
    roots: [composerPlusTriggerRef, composerShellRef, composerInputRef],
    onClose: closeComposerMenu,
    placement: "up",
    fitContent: true,
    matchTriggerWidth: false,
    minWidth: 268,
    estHeight: 300,
    gap: 8,
    deps: [composerMenuEntries.length],
  });
  const composerPlusPos = liveSlash.present ? slashAnchor.pos : plusAnchor.pos;
  const composerPlusStyle = liveSlash.present
    ? slashAnchor.style
    : plusAnchor.style;
  // `@` picker — anchored to the composer, as wide as the input.
  const atAnchor = useFloatingMenu({
    open: atMenuOpen,
    triggerRef: composerShellRef,
    panelRef: composerAtPanelRef,
    roots: [composerShellRef, composerInputRef],
    onClose: closeComposerMenu,
    placement: "up",
    fitContent: false,
    matchTriggerWidth: true,
    minWidth: 280,
    estHeight: 240,
    gap: 8,
    deps: [liveAt.query, atItems.length],
  });

  // Reset highlight only when the filter *string* changes.
  const prevFilterQueryRef = useRef(slashFilterQuery);
  useEffect(() => {
    if (prevFilterQueryRef.current === slashFilterQuery) return;
    prevFilterQueryRef.current = slashFilterQuery;
    setSlashActiveIndex(0);
  }, [slashFilterQuery]);

  // Keep highlight in range when the filtered list shrinks (no forced 0).
  useEffect(() => {
    setSlashActiveIndex((i) => {
      if (composerMenuEntries.length === 0) return 0;
      return i >= composerMenuEntries.length
        ? composerMenuEntries.length - 1
        : i;
    });
  }, [composerMenuEntries.length]);

  const showToast = useCallback((msg: string, ms = 3200) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, ms);
  }, []);

  const {
    theme,
    skin,
    workspaceSkins,
    wallpaperRecord,
    wallpaperUrl,
    wallpaperScrim,
    applyThemeChoice,
    applySkinOnly,
    applySkinChoice,
    applyWallpaperChoice,
    applyWallpaperScrimChoice,
  } = useAppearance({ workspace, onError: (message) => showToast(message, 4000) });

  // Persistence and document side effects live in the hook; this only picks
  // the other theme.
  const toggleThemeBtn = () => applyThemeChoice(toggleTheme(theme));

  const runAutomation = useAutomationRunner({
    projects,
    sessionState: session.state,
    connecting,
    tr,
    showToast,
    setToast,
    setLocalError,
    setMainPane,
    setAppView,
    setActiveProject,
    setExpandedProjects,
    setHistoryOpen,
    setMessages,
    setAttachments,
    setPerm,
    setAskUser,
    setRetryStatus,
    setDraft,
    setSession,
    setLiveHost,
    refreshSessions,
    messagesBySessionRef,
    viewingSessionIdRef,
    openingSessionIdRef,
    liveHostRef,
  });

  const {
    rewindTimeline,
    setRewindTimeline,
    rewindConfirm,
    setRewindConfirm,
    rewindRestoreFiles,
    setRewindRestoreFiles,
    runRewindToPrompt,
    confirmRewindToPrompt,
    openRewindTimeline,
    onRewindToUserMessage,
  } = useRewindDialogs({
    canRewindSession,
    activeSessionId: session.sessionId,
    sessionState: session.state,
    messages,
    rewindBusy,
    setRewindBusy,
    messagesRef,
    viewingSessionIdRef,
    messagesBySessionRef,
    ensureConnected,
    refreshSessions,
    setMessages,
    setCtxMenu: () => setCtxMenu(null),
    showToast,
    tr,
  });

  const {
    confirmForkSession,
    openHandoffDialog,
    onForkFromUserMessage,
  } = useSessionActions({
    projects,
    sessions,
    activeProjectId: activeProject?.id ?? null,
    activeSessionId: session.sessionId,
    sessionTitle: session.title || "",
    canRewindSession,
    messages,
    messagesRef,
    messagesBySessionRef,
    viewingSessionIdRef,
    refreshSessions,
    openSession,
    requestComposerFocus,
    setDraft,
    setCtxMenu: () => setCtxMenu(null),
    setExpandedProjects,
    setHistoryOpen,
    openDialog: (dialog) => setAppDialog(dialog as AppDialog),
    showToast,
    tr,
  });

  const onDictationTranscript = useCallback(
    (text: string) => {
      setDraft((current) => appendTranscript(current, text));
      requestComposerFocus();
    },
    [requestComposerFocus],
  );
  const onDictationError = useCallback(
    (error: unknown) => {
      const message = String(error);
      if (message.includes("NotAllowedError")) {
        showToast(tr("composer.voiceErr.mic_denied"), 5000);
      } else if (message.includes("SPEECH_NO_SPEECH")) {
        showToast(tr("composer.voiceErr.no_speech"));
      } else {
        showToast(tr("composer.voiceErr.local"), 5000);
      }
    },
    [showToast, tr],
  );
  const dictation = useLocalDictation({
    onTranscript: onDictationTranscript,
    onError: onDictationError,
  });

  const writePlanForViewing = useCallback((next: PlanState) => {
    const sid = viewingSessionIdRef.current;
    if (sid) planBySessionRef.current.set(sid, next);
    setPlan(next);
  }, []);

  /** Persist an explicit composer-mode change for the current preference scope. */
  const setComposerMode = useCallback(
    (next: "agent" | "plan" | "ask") => {
      if (next === "plan") setGoalMode(false);
      setMode(next);
      void api
        .composerPrefsSet({
          projectId: activeProject?.id ?? null,
          sessionId: session.sessionId ?? null,
          mode: next,
        })
        .catch((e) => showToast(String(e), 4000));
    },
    [activeProject?.id, session.sessionId, showToast],
  );

  const exitPlanMode = useCallback(() => {
    setComposerMode("agent");
  }, [setComposerMode]);

  const approvePlan = useCallback(async () => {
    try {
      await api.sessionResolvePlan({
        decision: "approved",
        rpcId: plan.rpcId,
      });
      writePlanForViewing({
        ...planRef.current,
        visible: false,
        waiting: false,
        rpcId: null,
        userClosed: false,
      });
      // Approval moves from proposal to execution. Keep the composer in sync
      // with the agent so the next turn is never accidentally another plan.
      exitPlanMode();
      showToast(tr("plan.approvedToast"), 2500);
    } catch (e) {
      showToast(String(e), 4500);
    }
  }, [exitPlanMode, plan.rpcId, showToast, tr, writePlanForViewing]);

  const requestPlanChanges = useCallback(async () => {
    try {
      await api.sessionResolvePlan({
        decision: "cancelled",
        feedback: tr("plan.reviseFeedback"),
        rpcId: plan.rpcId,
      });
      writePlanForViewing({
        ...planRef.current,
        visible: false,
        waiting: false,
        rpcId: null,
        userClosed: false,
      });
      showToast(tr("plan.reviseToast"), 2800);
    } catch (e) {
      showToast(String(e), 4500);
    }
  }, [plan.rpcId, showToast, tr, writePlanForViewing]);

  /**
   * User closes plan chrome from the resource panel.
   * Flow: confirm → abandon pending review RPC if any → hard-close session plan
   * so reopen stays empty until a new plan cycle (plan mode / new tool / new rpcId).
   */
  const dismissPlan = useCallback(() => {
    const cur = planRef.current;
    if (!cur.visible && !cur.entries.length && !cur.body && cur.rpcId == null) {
      return;
    }
    setAppDialog({
      kind: "confirm",
      title: tr("plan.dismissConfirmTitle"),
      message: tr("plan.dismissConfirmMessage"),
      confirmLabel: tr("plan.dismiss"),
      danger: false,
      onConfirm: async () => {
        const latest = planRef.current;
        if (latest.rpcId != null) {
          try {
            await api.sessionResolvePlan({
              decision: "abandoned",
              rpcId: latest.rpcId,
            });
          } catch {
            /* clear UI anyway */
          }
        }
        writePlanForViewing(
          closedSessionPlan(
            trRef.current("plan.ready"),
            latest.toolCallId ?? null,
          ),
        );
      },
    });
  }, [tr, writePlanForViewing]);

 // ── Parallel task batches ────────────────────────────────────────────────

  const batchProject = useMemo(
    () =>
      remoteRuntime.enabled && activeProject
        ? { ...activeProject, path: resourceProjectPath || activeProject.path }
        : activeProject,
    [activeProject, remoteRuntime.enabled, resourceProjectPath],
  );
  const batch = useTaskBatch({
    tr: tr as TaskBatchDeps["tr"],
    showToast: (m, ms) => showToast(m, ms),
    project: batchProject,
    onStarted: refreshSessions,
  });

  const comparisonEntries = useMemo<ComparisonEntry[]>(() => {
    if (!comparisonPair) return batch.entries;
    return comparisonPair.map((id) => {
      const row = sessions.find((item) => item.id === id);
      return {
        title: row?.title || tr("session.untitled"),
        modelId: row?.modelId ?? null,
        sessionId: id,
      };
    });
  }, [batch.entries, comparisonPair, sessions, tr]);

  const loadComparisonMessages = useCallback(async (sessionId: string): Promise<ChatMessage[]> => {
    const stored = await api.sessionMessages(sessionId);
    return stored.map((message) => ({
      id: message.id,
      role:
        message.role === "user" || message.role === "assistant"
          ? message.role
          : "tool",
      content: message.content || "",
      modelId: message.modelId ?? null,
      effort: message.effort ?? null,
      createdAt: message.createdAt,
      isError: !!message.isError,
      marker: message.marker ?? undefined,
    }));
  }, []);

  runTaskBatchRef.current = (tasks: ParallelTask[]) => void batch.run(tasks);

  // ── PR workspace ─────────────────────────────────────────────────────────

  const {
    openReviewPrDialog,
    postPrComment,
    startMultiReview,
  } = usePrActions({
    // The PR helper invokes the host `gh` CLI. Do not pass a local checkout
    // while the agent is attached to a remote runtime; repo-scoped PR actions
    // remain available through the existing PR workspace path.
    activeProjectPath: remoteRuntime.enabled ? null : activeProject?.path,
    reviewModelId: prReviewModel,
    reviewRoleModelId: modelRoles.review,
    availableModels,
    runBatch: (tasks) => batch.run(tasks),
    openDialog: (dialog) => setAppDialog(dialog as AppDialog),
    startReviewChat: (seedDraft) =>
      newChat(activeProject, { seedDraft, switchToChat: true }),
    setComparisonOpen,
    showToast,
    tr,
  });

  const pr = usePrWorkspace({
    tr: tr as PrWorkspaceDeps["tr"],
    showToast: (m, ms) => showToast(m, ms),
    openDialog: (d) => setAppDialog(d as AppDialog),
    startReviewChat: async (seedDraft, selectedModel) => {
      if (selectedModel) setModelId(selectedModel);
      await newChat(null, { seedDraft, switchToChat: true });
    },
    reviewModelId: prReviewModel,
    postInlineComment: postPrComment,
    startMultiReview,
  });

  /**
   * Apply permission policy (incl. YOLO). Never use window.confirm in Tauri —
   * it is unreliable in the WebView and blocks YOLO enable/disable.
   */
  const applyPermissionPolicy = useCallback(
    (next: PermissionPolicyId, opts?: { toastYoloToggle?: boolean }) => {
      if (!isValidPolicy(next)) return;

      const commit = () => {
        setPolicy(next);
        void api
          .sessionSetPolicy(next, {
            projectId: activeProject?.id ?? null,
            sessionId: session.sessionId ?? null,
          })
          .catch((e) => showToast(String(e), 4000));
        if (opts?.toastYoloToggle) {
          showToast(
            next === "always_approve"
              ? tr("slash.yoloOn")
              : tr("slash.yoloOff"),
            2500,
          );
        }
      };

      if (next !== "always_approve") {
        commit();
        return;
      }

      // Full access (YOLO) disables every permission prompt — a single clear
      // in-app confirm guards it (no window.confirm: unreliable in the WebView).
      // One step only: a second stacked confirm read as "it's asking me again"
      // and users dismissed it, leaving the policy unchanged.
      setAppDialog({
        kind: "confirm",
        title: tr("policy.always_approve"),
        message: `${tr("policy.yoloConfirm")} ${tr("policy.yoloConfirm2")}`,
        confirmLabel: tr("policy.short.always_approve"),
        danger: true,
        onConfirm: commit,
      });
    },
    [activeProject?.id, session.sessionId, showToast, tr],
  );

  // When the policy flips to an auto-resolving tier, clear any permission bar
  // already on screen. The host auto-approves *new* requests under these
  // tiers, but a request emitted just before the change would otherwise
  // linger and read as "it still asks me". Resolve it with the matching
  // decision so switching to Full access / Deny all takes effect immediately.
  useEffect(() => {
    if (!perm) return;
    const autoAllow = policy === "always_approve";
    const autoDeny = policy === "dont_ask";
    if (!autoAllow && !autoDeny) return;
    const buttons = mapPermissionButtons(perm.options, {
      allowOnce: tr("perm.allowOnce"),
      allowSession: tr("perm.allowSession"),
      deny: tr("perm.deny"),
    });
    const pick = automaticPermissionButton(
      buttons,
      autoDeny ? "dont_ask" : "always_approve",
    );
    if (!pick) return;
    const rpcId = perm.rpcId;
    void api
      .sessionResolvePermission({
        rpcId,
        decision: pick.decision,
        optionId: pick.optionId,
        scopeKey: perm.scopeKey,
      })
      .then(() => setPerm((cur) => (cur && cur.rpcId === rpcId ? null : cur)))
      .catch(() => {});
  }, [policy, perm, tr]);

  const applySlashItem = useCallback(
    (item: SlashItem) => {
      const live = liveSlashRef.current;
      const q =
        slashQuery ??
        (live.present
          ? { start: live.start, query: live.query, end: live.end }
          : null);
      setSlashQuery(null);
      setLiveSlash({ present: false, query: "", start: 0, end: 0 });
      liveSlashRef.current = { present: false, query: "", start: 0, end: 0 };
      setShowComposerPlus(false);

      if (item.kind === "skill") {
        if (q) {
          setDraft((d) => applySkillAtSlash(d, q.start, q.end, item.name));
        } else {
          setDraft((d) => {
            const needsSpace = d.length > 0 && !/\s$/.test(d);
            return `${d}${needsSpace ? " " : ""}[[skill:${item.name}]] `;
          });
        }
        return;
      }

      // Remove the /query from draft for mode/action
      if (q) {
        setDraft((d) => d.slice(0, q.start) + d.slice(q.end));
      }

      if (item.kind === "mode") {
        if (item.mode === "goal") {
          setGoalMode(true);
          if (mode === "plan") setComposerMode("agent");
          return;
        }
        if (item.mode === "plan") {
          setComposerMode("plan");
          return;
        }
      }

      if (item.kind === "action") {
        switch (item.action) {
          case "doctor":
            openDoctor();
            return;
          case "status":
            setShowStatusModal(true);
            return;
          case "mcp":
            navigateSettings("extensions");
            return;
          case "compact":
            openCompactWithNote();
            return;
          case "handoff":
            openHandoffDialog();
            return;
          case "newChat":
            void newChat();
            return;
          case "automations":
            navigateAutomations();
            return;
          case "settings":
            navigateSettings("general");
            return;
          case "parallel":
            taskBatchDraftRef.current = true;
            showToast(tr("batch.hint"), 5000);
            requestComposerFocus();
            return;
          case "review-pr":
            openReviewPrDialog();
            return;
          case "export":
            void exportActiveSessionMd();
            return;
          case "copy":
            void copyLastAssistantReply();
            return;
          case "find":
            openChatFind();
            return;
          case "extensions":
            navigateSettings("extensions");
            return;
          case "yolo": {
            const next: PermissionPolicyId =
              policy === "always_approve" ? "ask" : "always_approve";
            applyPermissionPolicy(next, { toastYoloToggle: true });
            return;
          }
          case "goal-clear":
            setGoalMode(false);
            return;
          default:
            return;
        }
      }
    },
    // many deps — intentionally broad for stable handlers used in render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      slashQuery,
      mode,
      policy,
      activeProject?.id,
      session.sessionId,
      tr,
      applyPermissionPolicy,
      openHandoffDialog,
      showToast,
      setComposerMode,
    ],
  );

  // Seed draft / clear / pane switch: grow textarea. If a focus request is still
  // pending (e.g. textarea just remounted), retry focus here as a backstop.
  useEffect(() => {
    if (mainPane !== "chat") return;
    if (pendingComposerFocus.current) {
      requestComposerFocus();
      return;
    }
    syncComposerHeight();
  }, [draft, mainPane, session.sessionId, requestComposerFocus, syncComposerHeight]);

  /** Context usage chip label/state from compact events + message estimate. */
  const contextUsageDisplay = useMemo(
    () =>
      resolveContextUsageDisplay(
        contextUsage,
        messages,
        findModel(modelId, availableModels)?.contextWindow ?? 128_000,
      ),
    [availableModels, contextUsage, messages, modelId],
  );

  const composer = useComposer({
    session,
    modelId,
    availableModels,
    modelRoles,
    fallbackChains,
    contextWindowPercent: contextUsageDisplay.windowPercent ?? null,
    compactionThresholdPercent,
    draft,
    attachments,
    goalMode,
    mode,
    hasActiveProject: !!activeProject,
    connecting,
    editingUserMessageId,
    tr,
    showToast,
    setAppDialog: (dialog) => setAppDialog(dialog as AppDialog),
    setDraft,
    setAttachments,
    setPromptHistoryIndex,
    promptHistoryIndexRef,
    setSlashQuery,
    setEditingUserMessageId,
    setEditAttachments,
    setRetryStatus,
    setTurnStartedAt,
    setSession,
    setLiveHost,
    setMessages,
    setModelId,
    setLocalError,
    sendInFlightRef,
    compactWaiterRef,
    fallbackTurnRef,
    fallbackRetryRef,
    liveHostRef,
    viewingSessionIdRef,
    messagesBySessionRef,
    automationSetupDraftRef,
    automationSetupSessionsRef,
    taskBatchDraftRef,
    ensureConnected,
    patchSessionMessages,
    applySessionTitle,
    isPlaceholderTitle,
  });
  const { sendQueue, send, retryInterruptedTurn } = composer;
  retryInterruptedTurnRef.current = retryInterruptedTurn;

  const retryActivity = async (item: ActivityItem) => {
    const row = sessionsRef.current.find(
      (sessionRow) => sessionRow.id === item.sessionId,
    );
    if (row) {
      await openSession(
        row,
        projectsRef.current.find(
          (project) => project.id === row.projectId,
        ) ?? null,
      );
    } else {
      trayHandlersRef.current.openSessionById(item.sessionId);
    }
    const history =
      messagesBySessionRef.current.get(item.sessionId) ?? messagesRef.current;
    const markerIndex = [...history]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.marker === "turn_cancelled")?.index;
    if (markerIndex === undefined) {
      showToast(tr("activity.retryUnavailable"), 3600);
      return;
    }
    for (let index = markerIndex - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (message?.role === "user") {
        await retryInterruptedTurnRef.current(message);
        return;
      }
    }
    showToast(tr("activity.retryUnavailable"), 3600);
  };

  const sessionTasks = useMemo(
    () => collectSessionTasks(messages),
    [messages],
  );
  const runningTaskCount = useMemo(
    () => countRunningTasks(sessionTasks),
    [sessionTasks],
  );
  const activityTranslate = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      tr(key as MessageKey, vars),
    [tr],
  );
  const {
    activityItems,
    activityOpen,
    runningSessions,
    setActivityOpen,
    markRead: markActivityReadState,
    togglePin: toggleActivityPinState,
    dismiss: dismissActivityState,
  } = useActivityCenter({
    sessionsRef,
    projectsRef,
    translate: activityTranslate,
  });
  const comparisonMessages = useCallback(
    (sessionId: string) => messagesBySessionRef.current.get(sessionId) ?? [],
    [],
  );

  /**
   * In-chat find matches — user + assistant bodies only.
   * Historical tool_step rows are not rendered in the transcript, so matching
   * them would land on invisible hits.
   */
  const chatFindMatches = useMemo((): ChatFindMatch[] => {
    if (!showChatFind) return [];
    return findChatMatches(
      chatFindQuery,
      messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          marker: m.marker,
        })),
    );
  }, [showChatFind, chatFindQuery, messages]);

  const chatFindHitIds = useMemo(() => {
    const s = new Set<string>();
    for (const m of chatFindMatches) s.add(m.messageId);
    return s;
  }, [chatFindMatches]);

  const chatFindActive = useMemo(() => {
    if (!showChatFind || chatFindMatches.length === 0) return null;
    const idx =
      chatFindIndex >= 0 && chatFindIndex < chatFindMatches.length
        ? chatFindIndex
        : 0;
    const hit = chatFindMatches[idx]!;
    return { messageId: hit.messageId, occurrence: hit.occurrence };
  }, [showChatFind, chatFindMatches, chatFindIndex]);

  // Clamp active index when the match list shrinks (query edit / new messages).
  useEffect(() => {
    if (!showChatFind) return;
    if (chatFindMatches.length === 0) {
      if (chatFindIndex !== 0) setChatFindIndex(0);
      return;
    }
    if (chatFindIndex >= chatFindMatches.length) {
      setChatFindIndex(0);
    }
  }, [showChatFind, chatFindMatches.length, chatFindIndex]);

  // Reset find when switching conversation (keep open across same session).
  useEffect(() => {
    setShowChatFind(false);
    setChatFindQuery("");
    setChatFindIndex(0);
  }, [session.sessionId]);

  // Close find when leaving the chat pane (not when opening from another pane).
  useEffect(() => {
    if (mainPane !== "chat") {
      setShowChatFind(false);
    }
  }, [mainPane]);

  useEffect(() => {
    if (!showChatFind) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.isComposing) return;
      // Permission bar / dialogs own Escape when open.
      if (perm || appDialog) return;
      e.preventDefault();
      e.stopPropagation();
      setShowChatFind(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [showChatFind, perm, appDialog]);

  const [chatFindFocusKey, setChatFindFocusKey] = useState(0);
  const openChatFind = useCallback(() => {
    // Ensure chat pane first; opening find after pane switch is handled by
    // setting show true in the same tick (pane effect only closes on leave).
    if (mainPane !== "chat") {
      setMainPane("chat");
    }
    setShowChatFind(true);
    setChatFindFocusKey((k) => k + 1);
  }, [mainPane]);

  const chatFindNext = useCallback(() => {
    setChatFindIndex((i) =>
      stepChatFindIndex(i, chatFindMatches.length, 1),
    );
  }, [chatFindMatches.length]);

  const chatFindPrev = useCallback(() => {
    setChatFindIndex((i) =>
      stepChatFindIndex(i, chatFindMatches.length, -1),
    );
  }, [chatFindMatches.length]);

  /** Copy last non-error assistant reply body to the clipboard. */
  const copyLastAssistantReply = useCallback(async () => {
    let last: ChatMessage | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && !m.isError) {
        last = m;
        break;
      }
    }
    const text = (last?.content ?? "").trim();
    if (!text) {
      showToast(tr("slash.copyEmpty"));
      return;
    }
    try {
      await navigator.clipboard.writeText(last!.content);
      showToast(tr("message.copied"));
    } catch (e) {
      showToast(String(e), 4000);
    }
  }, [messages, showToast, tr]);

  /**
   * New empty draft only: lift composer and Pi brand.
   * Existing sessions (even with empty journal) must not look like a fresh chat.
   */
  const welcomeSession =
    mainPane === "chat" &&
    !session.sessionId &&
    messages.length === 0 &&
    session.state !== "streaming";
  const emptyExistingSession =
    mainPane === "chat" &&
    !!session.sessionId &&
    messages.length === 0 &&
    session.state !== "streaming" &&
    session.state !== "connecting";
  const activeCustomProvider: api.CustomProvider | null = null;

  // Floating composer height → chat bottom pad so messages can scroll under it.
  useEffect(() => {
    if (mainPane !== "chat") return;
    const el = composerWrapRef.current;
    if (!el) return;
    const measure = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h <= 0) return;
      // Ignore 1px subpixel flicker — pad thrash reflows chat scrollHeight
      // and looks like the transcript bouncing while you type/scroll.
      setComposerFloatPad((prev) => (Math.abs(prev - h) <= 1 ? prev : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    mainPane,
    attachments.length,
    draft,
    showComposerPlus,
    messages.length,
    welcomeSession,
  ]);

  const stop = async () => {
    try {
      await api.sessionStop();
      setRetryStatus(null);
      setStreamStall(null);
      setTurnStartedAt(null);
      setTurnStartedAt(null);
      const liveId = liveHostRef.current.sessionId;
      if (liveId) {
        patchSessionMessages(liveId, (m) =>
          m.map((x) => ({ ...x, streaming: false })),
        );
      } else {
        setMessages((m) => m.map((x) => ({ ...x, streaming: false })));
      }
    } catch (e) {
      setLocalError(String(e));
    }
  };

  /**
   * Bind (or clear) the open session's project. Draft chats only switch
   * workspace context. Untrusted projects refuse bind when a session exists.
   */
  const bindSessionProject = useCallback(
    async (proj: Project | null, opts?: { silent?: boolean }) => {
      const sid = session.sessionId;
      if (!sid || !api.isTauri()) {
        setActiveProject(proj);
        if (proj) {
          setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
        } else {
          setHistoryOpen(true);
        }
        return;
      }
      if (proj && !remoteRuntime.enabled && !proj.trusted) {
        setLocalError(tr("project.trustFirst", { name: proj.name }));
        return;
      }
      if (proj && !remoteRuntime.enabled && isProjectPathMissing(proj.pathOk)) {
        setLocalError(tr("project.pathMissing", { name: proj.name }));
        return;
      }
      try {
        await api.sessionSetProject(sid, proj?.id ?? null);
        setActiveProject(proj);
        setSessions((list) =>
          list.map((s) =>
            s.id === sid ? { ...s, projectId: proj?.id ?? null } : s,
          ),
        );
        // Live agent used old cwd — force reconnect next send
        setSession((prev) =>
          prev.sessionId === sid
            ? {
                ...IDLE_SNAPSHOT,
                sessionId: sid,
                title: prev.title,
                state: "idle",
                backend: prev.backend || "pi_rpc",
              }
            : prev,
        );
        setLiveHost((prev) =>
          prev.sessionId === sid ? { ...IDLE_SNAPSHOT } : prev,
        );
        if (proj) {
          setExpandedProjects((e) => ({ ...e, [proj.id]: true }));
          if (!opts?.silent) {
            showToast(tr("composer.projectBound", { name: proj.name }), 2500);
          }
        } else {
          setHistoryOpen(true);
          if (!opts?.silent) {
            showToast(tr("composer.projectCleared"), 2200);
          }
        }
        setLocalError(null);
      } catch (e) {
        showToast(String(e), 4500);
      }
    },
    [remoteRuntime.enabled, session.sessionId, showToast, tr],
  );

  /**
   * Move the current chat to a remote workspace/worktree. Remote paths stay
   * session-scoped; they must never be registered as local projects because
   * the desktop cannot validate or browse them directly.
   */
  const selectRemoteWorkspacePath = useCallback(
    async (nextPath: string) => {
      const path = nextPath.trim();
      if (!path || !remoteRuntime.enabled) return false;
      const sid = session.sessionId;
      try {
        if (sid && api.isTauri()) {
          await api.sessionSetRemoteCwd(sid, path);
        }
        setRemoteWorkspacePath(path);
        if (sid) {
          setSession((prev) =>
            prev.sessionId === sid
              ? {
                  ...IDLE_SNAPSHOT,
                  sessionId: sid,
                  title: prev.title,
                  state: "idle",
                  backend: prev.backend || "pi_rpc",
                }
              : prev,
          );
          setLiveHost((prev) =>
            prev.sessionId === sid ? { ...IDLE_SNAPSHOT } : prev,
          );
        }
        return true;
      } catch (error) {
        showToast(String(error), 4500);
        return false;
      }
    },
    [remoteRuntime.enabled, session.sessionId, showToast],
  );

  const gitWorktreesReqRef = useRef(0);
  const gitWorktreesPathRef = useRef<string | null>(null);
  const refreshGitWorktrees = useCallback(async () => {
    const path = resourceProjectPath?.trim() || null;
    if (!path || !api.isTauri()) {
      gitWorktreesReqRef.current += 1;
      gitWorktreesPathRef.current = null;
      setGitWorktrees([]);
      setGitWorktreesAvailable(null);
      setGitWorktreesReason(null);
      setGitWorktreesLoading(false);
      return;
    }
    const reqId = ++gitWorktreesReqRef.current;
    // Drop stale rows when the active project path changes; soft-refresh keeps
    // the previous list for the same path so the menu does not flash empty.
    if (gitWorktreesPathRef.current !== path) {
      gitWorktreesPathRef.current = path;
      setGitWorktrees([]);
      setGitWorktreesAvailable(null);
      setGitWorktreesReason(null);
    }
    setGitWorktreesLoading(true);
    try {
      const res = await api.gitWorktreesList(path);
      if (reqId !== gitWorktreesReqRef.current) return;
      if (!res.available) {
        setGitWorktrees([]);
        setGitWorktreesAvailable(false);
        setGitWorktreesReason(res.reason?.trim() || "unavailable");
      } else {
        setGitWorktrees(res.worktrees ?? []);
        setGitWorktreesAvailable(true);
        setGitWorktreesReason(null);
      }
    } catch (e) {
      if (reqId !== gitWorktreesReqRef.current) return;
      setGitWorktrees([]);
      setGitWorktreesAvailable(false);
      setGitWorktreesReason(String(e));
    } finally {
      if (reqId === gitWorktreesReqRef.current) {
        setGitWorktreesLoading(false);
      }
    }
  }, [resourceProjectPath]);

  useEffect(() => {
    void refreshGitWorktrees();
  }, [refreshGitWorktrees]);

  /**
   * After a project is created/updated: refresh list, expand, optionally trust
   * via in-app confirm, then set active (+ bind session when requested).
   */
  const finalizeAddedProject = useCallback(
    async (p: Project, opts: { bindSession: boolean }) => {
      const list = (await api.projectsList()) as Project[];
      setProjects(list);
      setSetup((s) => ({ ...s, project: true }));

      const apply = async (proj: Project) => {
        const fresh = (await api.projectsList()) as Project[];
        setProjects(fresh);
        const current = fresh.find((x) => x.id === proj.id) ?? proj;
        if (opts.bindSession) {
          await bindSessionProject(current);
        } else {
          setActiveProject(current);
          setExpandedProjects((e) => ({ ...e, [current.id]: true }));
          showToast(tr("composer.projectAdded", { name: current.name }), 2500);
        }
      };

      // Tauri WebView: never use window.confirm — offer in-app trust dialog.
      if (!p.trusted) {
        setAppDialog({
          kind: "confirm",
          title: tr("project.trustTitle"),
          message: tr("project.trustConfirm", {
            name: p.name,
            path: p.path,
          }),
          confirmLabel: tr("project.trustToSend", { name: p.name }),
          onConfirm: async () => {
            try {
              const trusted = (await api.projectTrust(p.id)) as Project;
              await apply(trusted);
            } catch (e) {
              setLocalError(String(e));
            }
          },
        });
        return;
      }
      await apply(p);
    },
    [bindSessionProject, showToast, tr],
  );

  /**
   * Worktree dialogs. Adoption of the new path — trust prompt, session
   * binding, opening a chat — stays here because it is the shell's job, not
   * the dialog's; the hook hands the finished worktree back through onCreated.
   */
  const wt = useWorktreeDialogs({
    projectPath: resourceProjectPath,
    worktrees: gitWorktrees,
    tr: tr as WorktreeDialogsDeps["tr"],
    showToast: (m, ms) => showToast(m, ms),
    refreshWorktrees: refreshGitWorktrees,
    onCreated: async ({ path, name, branch, startChat }) => {
      if (remoteRuntime.enabled) {
        const selected = await selectRemoteWorkspacePath(path);
        if (selected) {
          if (startChat) {
            await newChat(activeProject ?? null, { switchToChat: true });
          }
          showToast(
            startChat
              ? tr("composer.worktreeCreatedChat", { name, branch })
              : tr("composer.worktreeCreated", { name, branch }),
            2800,
          );
        }
        return;
      }
      const trust = !!activeProject?.trusted;
      const existing = projects.find((pr) => pathsEqual(pr.path, path));
      let target: Project | null = existing ?? null;
      if (!target) {
        const added = (await api.projectAdd(path, trust)) as Project;
        const list = (await api.projectsList()) as Project[];
        setProjects(list);
        target = list.find((pr) => pr.id === added.id) ?? added;
      }

      if (!target.trusted) {
        // Trust prompt first; bind only (chat requires a trusted project).
        await finalizeAddedProject(target, { bindSession: true });
        showToast(tr("composer.worktreeCreated", { name, branch }), 2800);
        return;
      }

      if (startChat) {
        await newChat(target, { switchToChat: true });
        showToast(tr("composer.worktreeCreatedChat", { name, branch }), 2800);
      } else {
        await bindSessionProject(target, { silent: true });
        showToast(tr("composer.worktreeCreated", { name, branch }), 2800);
      }
    },
  });

  /** Open a linked worktree as project cwd (reuse existing project if path matches). */
  const switchToWorktree = useCallback(
    async (wt: api.GitWorktreeEntry) => {
      if (!api.isTauri()) return;
      const path = wt.path?.trim();
      if (!path) return;
      if (remoteRuntime.enabled) {
        if (await selectRemoteWorkspacePath(path)) {
          showToast(
            tr("composer.worktreeSwitched", {
              name: path.split(/[\\/]/).filter(Boolean).pop() || path,
              branch: wt.branch || tr("composer.worktreeDetached"),
            }),
            2500,
          );
        }
        return;
      }
      try {
        const existing = projects.find((p) => pathsEqual(p.path, path));
        if (existing) {
          await bindSessionProject(existing, { silent: true });
          showToast(
            tr("composer.worktreeSwitched", {
              name: existing.name,
              branch: wt.branch || tr("composer.worktreeDetached"),
            }),
            2500,
          );
          return;
        }
        const trust = !!activeProject?.trusted;
        const added = (await api.projectAdd(path, trust)) as Project;
        const list = (await api.projectsList()) as Project[];
        setProjects(list);
        const proj = list.find((p) => p.id === added.id) ?? added;
        if (!proj.trusted) {
          await finalizeAddedProject(proj, { bindSession: true });
        } else {
          await bindSessionProject(proj, { silent: true });
          showToast(
            tr("composer.worktreeSwitched", {
              name: proj.name,
              branch: wt.branch || tr("composer.worktreeDetached"),
            }),
            2500,
          );
        }
      } catch (e) {
        showToast(String(e), 4500);
      }
    },
    [
      activeProject?.trusted,
      bindSessionProject,
      finalizeAddedProject,
      projects,
      remoteRuntime.enabled,
      newChat,
      selectRemoteWorkspacePath,
      showToast,
      tr,
    ],
  );


  /**
   * Pick folder → add project (name = folder basename; no rename prompt).
   * `bindSession` also attaches the open chat under the new project.
   */
  const addProjectFromPicker = useCallback(
    async (opts: { bindSession: boolean; autoTrust?: boolean }) => {
      setLocalError(null);
      try {
        if (!api.isTauri()) {
          setLocalError(tr("error.needTauri"));
          return;
        }
        const path = await api.pickDirectory();
        if (!path) return;
        const p = (await api.projectAdd(path, !!opts.autoTrust)) as Project;
        await finalizeAddedProject(p, { bindSession: opts.bindSession });
      } catch (e) {
        setLocalError(String(e));
      }
    },
    [finalizeAddedProject, tr],
  );

  const addProject = async (autoTrust = false) => {
    await addProjectFromPicker({ bindSession: false, autoTrust });
  };

  const trustProject = async (proj?: Project | null) => {
    const target = proj || activeProject;
    if (!target) return;
    try {
      const p = (await api.projectTrust(target.id)) as Project;
      setActiveProject(p);
      setProjects((await api.projectsList()) as Project[]);
      setLocalError(null);
      // CLI connects on first send only.
    } catch (e) {
      setLocalError(String(e));
    }
  };

  const openDoctor = () => {
    setShowDoctor(true);
  };

  // Keep tray menu actions on latest closures (listeners registered once).
  const trayHandlersRef = useRef({
    newChat: () => {},
    openSessionById: (_id: string) => {},
    openSettings: (_section: SettingsSectionId = "general") => {},
    openDoctor: () => {},
  });
  shortcutHandlersRef.current = {
    newChat: () => {
      void newChat();
    },
    openSettings: () => {
      setAppView("settings");
      setSettingsSection("general");
      window.location.hash = "#/settings/general";
    },
    openChatFind: () => {
      openChatFind();
    },
    openModelMenu: () => {
      setShowSearch(true);
      setSearchQuery("> model");
    },
    switchPinned: (index: number) => {
      const pinned = sessions.filter((item) => item.pinned).slice(0, 9);
      const row = pinned[index];
      if (row) void openSession(row, projects.find((project) => project.id === row.projectId));
    },
  };
  trayHandlersRef.current = {
    newChat: () => {
      void newChat();
    },
    openSessionById: (id: string) => {
      void (async () => {
        let row = sessions.find((s) => s.id === id) ?? null;
        if (!row) {
          try {
            const list = await api.sessionsList();
            const hit = list.find((s) => s.id === id);
            if (hit) {
              row = {
                id: hit.id,
                title: hit.title,
                projectId: hit.projectId,
                updatedAt: hit.updatedAt,
                archived: !!hit.archived,
                scheduled: !!hit.scheduled,
              };
              setSessions(
                list.map((s) => ({
                  id: s.id,
                  title: s.title,
                  projectId: s.projectId,
                  updatedAt: s.updatedAt,
                  archived: !!s.archived,
                  scheduled: !!s.scheduled,
                })),
              );
            }
          } catch {
            /* ignore */
          }
        }
        if (!row) return;
        const proj =
          projects.find((p) => p.id === row!.projectId) ?? null;
        await openSession(row, proj);
      })();
    },
    openSettings: (section: SettingsSectionId = "general") => {
      navigateSettings(section);
    },
    openDoctor: () => {
      void openDoctor();
    },
  };

  // System tray / menu-bar (Codex-style): Recent · More · Usage · New Chat · Open · Quit
  useEffect(() => {
    if (!api.isTauri()) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        unsubs.push(
          await listen("tray://new-chat", () => {
            trayHandlersRef.current.newChat();
          }),
        );
        unsubs.push(
          await listen<{ sessionId?: string }>("tray://open-session", (ev) => {
            const id = ev.payload?.sessionId;
            if (id) trayHandlersRef.current.openSessionById(id);
          }),
        );
        unsubs.push(
          await listen<{ section?: string }>("tray://open-settings", (ev) => {
            const raw = (ev.payload?.section || "general") as SettingsSectionId;
            const allowed: SettingsSectionId[] = [
              "general",
              "appearance",
              "context",
              "usage",
              "speech",
              "archived",
              "providers-models",
              "extensions",
              "runtime",
              "shortcuts",
              "about",
            ];
            trayHandlersRef.current.openSettings(
              allowed.includes(raw) ? raw : "general",
            );
          }),
        );
        unsubs.push(
          await listen("tray://open-doctor", () => {
            trayHandlersRef.current.openDoctor();
          }),
        );
      } catch (e) {
        console.warn("tray listeners failed", e);
      }
    })();
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, []);

  const error = session.lastError;
  const errorBanner = useMemo(
    () => presentErrorBanner(error, localError, locale),
    [error, localError, locale],
  );
  /** Prefer in-thread turn error; avoid stacking with the top error banner. */
  const hasChatTurnError = useMemo(
    () => messages.some((m) => m.isError),
    [messages],
  );
  // Collapse technical dump whenever the visible error changes.
  useEffect(() => {
    setErrorDetailOpen(false);
  }, [errorBanner?.code, errorBanner?.summary, errorBanner?.detail]);

  // T15: announce stream start/end once (avoid token-level noise).
  useEffect(() => {
    const streaming =
      session.state === "streaming" ||
      messages.some((m) => m.role === "assistant" && m.streaming);
    if (streaming && !wasStreamingRef.current) {
      setStreamA11yNote(tr("a11y.assistantStreaming"));
    } else if (!streaming && wasStreamingRef.current) {
      setStreamA11yNote(tr("a11y.assistantDone"));
      const t = window.setTimeout(() => setStreamA11yNote(""), 2500);
      wasStreamingRef.current = streaming;
      return () => window.clearTimeout(t);
    }
    wasStreamingRef.current = streaming;
  }, [session.state, messages, tr]);

  // T15: permission bar — focus primary action, Tab trap, Escape → deny.
  useEffect(() => {
    if (!perm) return;
    const t = window.setTimeout(() => {
      preferPermissionFocus(permBarRef.current);
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const deny = mapPermissionButtons(perm.options, {
          allowOnce: tr("perm.allowOnce"),
          allowSession: tr("perm.allowSession"),
          deny: tr("perm.deny"),
        }).find((b) => b.decision === "deny");
        if (deny) {
          void api
            .sessionResolvePermission({
              rpcId: perm.rpcId,
              decision: deny.decision,
              optionId: deny.optionId,
              scopeKey: perm.scopeKey,
            })
            .then(() => setPerm(null));
        }
        return;
      }
      trapTabKey(e, permBarRef.current);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [perm, tr]);

  /** T04 deck buttons: reconnect / Doctor / Settings sections / dismiss. */
  const runErrorBannerAction = useCallback(
    (action: NonNullable<ErrorBannerView["primary"]>) => {
      setErrorDetailOpen(false);
      switch (action.id) {
        case "reconnect":
          setLocalError(null);
          void ensureConnected(true).then((sid) => {
            if (sid) setLocalError(null);
          });
          break;
        case "open_doctor":
          setLocalError(null);
          openDoctor();
          break;
        case "open_runtime":
          setLocalError(null);
          navigateSettings("runtime");
          break;
        case "open_account":
          setLocalError(null);
          navigateSettings("runtime");
          break;
        case "open_providers":
          setLocalError(null);
          navigateSettings("extensions");
          break;
        case "dismiss":
          setLocalError(null);
          break;
        default:
          break;
      }
    },
    [ensureConnected, navigateSettings, openDoctor],
  );

  /** Export active (or given) session as Markdown (from PR #24). */
  const exportActiveSessionMd = useCallback(
    async (sessionMeta?: {
      id: string;
      title: string;
      projectId?: string | null;
    }) => {
      try {
        const id = sessionMeta?.id ?? session.sessionId;
        if (!id) {
          showToast(tr("session.exportFail"));
          return;
        }
        const title =
          sessionMeta?.title ||
          sessions.find((s) => s.id === id)?.title ||
          session.title ||
          tr("session.untitled");
        const projectId =
          sessionMeta?.projectId ??
          sessions.find((s) => s.id === id)?.projectId ??
          null;
        const proj =
          projects.find((p) => p.id === projectId) || activeProject || null;
        let msgs = messages;
        if (id !== session.sessionId) {
          msgs = (await api.sessionMessages(id)) as ChatMessage[];
        }
        const md = sessionToMarkdown({
          title,
          projectName: proj?.name,
          projectPath: proj?.path,
          sessionId: id,
          messages: msgs.map((m) => ({
            role: m.role,
            content: m.content,
            thought: m.thought,
            createdAt: m.createdAt,
          })),
        });
        const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = sessionExportFilename(title, id);
        a.click();
        URL.revokeObjectURL(url);
        showToast(tr("session.exportDone"));
      } catch (e) {
        showToast(`${tr("session.exportFail")}: ${String(e)}`);
      }
    },
    [
      session.sessionId,
      session.title,
      sessions,
      messages,
      projects,
      activeProject,
      showToast,
      tr,
    ],
  );

  /** Full diagnostic zip (messages + agent trail + logs) for bug reports. */
  const exportSessionDiagnostic = useCallback(
    async (sessionId?: string | null) => {
      const id = sessionId || session.sessionId;
      if (!id) {
        showToast(tr("session.exportBundleFail"));
        return;
      }
      try {
        const res = await api.exportSessionBundle(id);
        if (res?.ok && res.path) {
          showToast(tr("session.exportBundleDone"), 4200);
        } else {
          showToast(tr("session.exportBundleFail"));
        }
      } catch (e) {
        showToast(`${tr("session.exportBundleFail")}: ${String(e)}`, 5000);
      }
    },
    [session.sessionId, showToast, tr],
  );

  const inlineEdit = useInlineEdit({
    lastUserMessageId,
    canEditLastUser,
    editSubmitting,
    editAttachments,
    goalMode,
    session,
    localeRef,
    tr,
    showToast,
    isPlaceholderTitle,
    setEditingUserMessageId,
    setEditAttachments,
    setEditSubmitting,
    setMessages,
    setRetryStatus,
    setSession,
    setLiveHost,
    setLocalError,
    liveHostRef,
    viewingSessionIdRef,
    messagesBySessionRef,
    patchSessionMessages,
    ensureConnected,
    applySessionTitle,
  });
  const { beginEditLastUser, cancelEditUser, submitEditLastUser } = inlineEdit;
  const settingsLabels = useMemo(() => buildSettingsLabels(tr), [tr]);

  const activePiExtensionUi =
    (session.sessionId && piExtensionUiBySession[session.sessionId]) ||
    EMPTY_PI_EXTENSION_UI;
  const piWidgetsAbove = piExtensionWidgetsAt(
    activePiExtensionUi,
    "aboveEditor",
  );
  const piWidgetsBelow = piExtensionWidgetsAt(
    activePiExtensionUi,
    "belowEditor",
  );

  useEffect(() => {
    const title = activePiExtensionUi.title || "Pi";
    document.title = title;
    if (!api.isTauri()) return;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
      .catch(() => {
        /* The document title remains the safe fallback. */
      });
  }, [activePiExtensionUi.title]);

  return (
    <ImageViewerProvider locale={locale}>
    <div
      className={
        `app-shell platform-${platform}` +
        (windowMaximized ? " is-maximized" : "") +
        (useCustomWindowChrome ? " has-custom-chrome" : "")
      }
      data-testid="app-shell"
    >
      <WindowControls
        visible={useCustomWindowChrome}
        labels={{
          minimize: tr("window.minimize"),
          maximize: tr("window.maximize"),
          restore: tr("window.restore"),
          close: tr("window.close"),
        }}
      />

      {wallpaperUrl && (
        <div className="app-wallpaper-media" aria-hidden>
          {wallpaperRecord?.kind === "video" ? (
            <video
              className="app-wallpaper-media__el"
              src={wallpaperUrl}
              autoPlay
              muted
              loop
              playsInline
              disablePictureInPicture
            />
          ) : (
            <img className="app-wallpaper-media__el" src={wallpaperUrl} alt="" />
          )}
        </div>
      )}

      {appGate === "loading" && (
        <div className="setup-gate" data-testid="setup-booting">
          <div className="setup-gate__drag" data-tauri-drag-region />
          <div className="setup-gate__center">
            <div className="setup-hero">
              <div className="setup-logo setup-logo--spin">
                <PiLogo size={44} />
              </div>
              <h1 className="setup-title">{tr("setup.title")}</h1>
              <p className="setup-subtitle">{tr("setup.detecting")}</p>
            </div>
          </div>
        </div>
      )}

      {appGate === "setup" && (
        <SetupWizard
          tr={tr}
          platform={platform}
          useCustomWindowChrome={useCustomWindowChrome}
          initialCli={
            setupCliSeed ?? {
              found: false,
              path: null,
              version: null,
              source: "",
              cliAuthPresent: false,
            }
          }
          initialRemote={remoteRuntime}
          onRemoteConfigured={(value) => {
            setRemoteRuntime(value);
            void api.settingsGet().then((settings) =>
              api.settingsSet({
                ...settings,
                remoteRuntime: value,
                acpServerAddr: null,
              }),
            );
          }}
          onComplete={(cli, name) => {
            setUserName(name);
            setCliInfo({
              found: cli.found,
              path: cli.path,
              version: cli.version,
              source: cli.source,
              cliAuthPresent: cli.cliAuthPresent,
            });
            if (cli.path) setManualCliPath(cli.path);
            setSetup((s) => ({
              ...s,
              cli: cli.found,
              auth: s.auth || cli.cliAuthPresent,
            }));
            setAppGate("ready");
            void refreshLists();
          }}
        />
      )}

      {appGate === "ready" && (appView === "settings" ? (
        <Suspense
          fallback={
            <div className="settings-loading" role="status">
              {tr("common.loading")}
            </div>
          }
        >
          {/* Settings commands run on the desktop host. A remote POSIX path
              must never be handed to them as if it were local. */}
          <SettingsPage
          section={settingsSection}
          onSection={(id) => {
            setSettingsSection(id);
            window.location.hash = `#/settings/${id}`;
          }}
          onBack={navigateWorkbench}
          labels={settingsLabels}
          locale={locale}
          theme={theme}
          onTheme={applyThemeChoice}
          userName={userName}
          onUserName={(value) => {
            const next = value.trim().slice(0, 80);
            if (!next) return;
            setUserName(next);
            void api.settingsGet().then((settings) =>
              api.settingsSet({ ...settings, userName: next }),
            );
          }}
          skin={skin}
          onSkin={applySkinChoice}
          wallpaperUrl={wallpaperUrl}
          wallpaperKind={wallpaperRecord?.kind ?? null}
          wallpaperIsCustom={wallpaperRecord !== null}
          onWallpaper={applyWallpaperChoice}
          wallpaperScrim={wallpaperScrim}
          onWallpaperScrim={applyWallpaperScrimChoice}
          sessionDataMode={sessionDataMode}
          onCliSessionsImported={() => {
            void refreshSessions();
          }}
          onProviderActivated={() => {
            void api.sessionDisconnect().catch(() => {});
          }}
          onSessionDataMode={(v) => {
            const commit = () => {
              setSessionDataMode(v);
              void api.settingsGet().then((s) =>
                api.settingsSet({ ...s, sessionDataMode: v }),
              );
            };
            // Tauri WebView: window.confirm is unreliable (often always false).
            if (v === "shared") {
              setAppDialog({
                kind: "confirm",
                title: tr("settings.sessionDataMode"),
                message: tr("settings.sharedConfirm"),
                confirmLabel: tr("common.confirm"),
                onConfirm: commit,
              });
              return;
            }
            commit();
          }}
          policy={policy}
          onPolicy={(v) => {
            if (!isValidPolicy(v)) return;
            applyPermissionPolicy(v);
          }}
          prefsScope={prefsScope}
          onPrefsScope={(v) => {
            if (!isValidPrefsScope(v)) return;
            setPrefsScope(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, composerPrefsScope: v }),
            );
            void api
              .composerPrefsResolve({
                projectId: activeProject?.id ?? null,
                sessionId: session.sessionId ?? null,
              })
              .then((prefs) => applyComposerPrefs(prefs, availableModels))
              .catch(() => {});
          }}
          availableModels={availableModels}
          modelRoles={modelRoles}
          onModelRoles={(next) => {
            setModelRoles(next);
            void api.settingsGet().then((settings) =>
              api.settingsSet({ ...settings, modelRoles: next }),
            );
          }}
          fallbackChains={fallbackChains}
          onFallbackChains={(next) => {
            setFallbackChains(next);
            void api.settingsGet().then((settings) =>
              api.settingsSet({ ...settings, fallbackChains: next }),
            );
          }}
          budgetMonthlyByTier={budgetMonthlyByTier}
          budgetSessionByTier={budgetSessionByTier}
          compactionThresholdPercent={compactionThresholdPercent}
          onBudgetChange={(monthly, sessionBudget) => {
            setBudgetMonthlyByTier(monthly);
            setBudgetSessionByTier(sessionBudget);
            void api.settingsGet().then((settings) =>
              api.settingsSet({
                ...settings,
                budgetMonthlyByTier: monthly,
                budgetSessionByTier: sessionBudget,
              }),
            );
          }}
          onCompactionThresholdPercent={(value) => {
            setCompactionThresholdPercent(value);
            void api.settingsGet().then((settings) =>
              api.settingsSet({ ...settings, compactionThresholdPercent: value }),
            );
          }}
          manualCliPath={manualCliPath}
          onManualCliPath={setManualCliPath}
          onCliBlur={(v) => {
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, manualCliPath: v || null }),
            );
            void api.probeCli(v || undefined).then((cli) => {
              setCliInfo({
                found: cli.found,
                path: cli.path,
                version: cli.version,
                source: cli.source || "",
                cliAuthPresent: !!cli.cliAuthPresent,
              });
              setSetup((prev) => ({
                ...prev,
                cli: cli.found,
                auth: prev.auth || !!cli.cliAuthPresent,
              }));
            });
          }}
          acpServerAddr={acpServerAddr}
          onAcpServerAddr={(v) => {
            setAcpServerAddr(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, acpServerAddr: v.trim() || null }),
            );
          }}
          remoteRuntime={remoteRuntime}
          onRemoteRuntime={(value) => {
            setRemoteRuntime(value);
            void api.settingsGet().then((settings) =>
              api.settingsSet({
                ...settings,
                remoteRuntime: value,
                acpServerAddr: null,
              }),
            );
          }}
          maxConcurrentAgents={maxConcurrentAgents}
          onMaxConcurrentAgents={(v) => {
            setMaxConcurrentAgents(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, maxConcurrentAgents: v }),
            );
          }}
          agentIdleMinutes={agentIdleMinutes}
          onAgentIdleMinutes={(v) => {
            setAgentIdleMinutes(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, agentIdleMinutes: v }),
            );
          }}
          streamStallSeconds={streamStallSeconds}
          onStreamStallSeconds={(v) => {
            setStreamStallSeconds(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, streamStallSeconds: v }),
            );
          }}
          maxAgentTurns={maxAgentTurns}
          onMaxAgentTurns={(v) => {
            const n = v > 0 ? Math.min(200, Math.round(v)) : 0;
            setMaxAgentTurns(n);
            void api.settingsGet().then((s) =>
              api.settingsSet({
                ...s,
                // null clears the optional field; 0 would also omit on spawn.
                maxAgentTurns: n > 0 ? n : null,
              }),
            );
          }}
          storeApiKeysInKeychain={storeApiKeysInKeychain}
          crashReportingEnabled={crashReportingEnabled}
          onCrashReportingEnabled={(value) => {
            setCrashReportingEnabled(value);
            void api.settingsGet().then((settings) =>
              api.settingsSet({ ...settings, crashReportingEnabled: value }),
            );
          }}
          onStoreApiKeysInKeychain={(v) => {
            const prev = storeApiKeysInKeychain;
            setStoreApiKeysInKeychain(v);
            void api
              .settingsGet()
              .then((s) =>
                api.settingsSet({ ...s, storeApiKeysInKeychain: v }),
              )
              .catch((e) => {
                setStoreApiKeysInKeychain(prev);
                showToast(String(e), 4500);
              });
          }}
          sandboxProfile={sandboxProfile}
          onSandboxProfile={(v) => {
            setSandboxProfile(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, sandboxProfile: v }),
            );
          }}
          preferredAgent={preferredAgent}
          onPreferredAgent={(v) => {
            setPreferredAgent(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, preferredAgent: v }),
            );
          }}
          agentCatalog={agentCatalog}
          experimentalMemory={experimentalMemory}
          onExperimentalMemory={(v) => {
            setExperimentalMemory(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, experimentalMemory: v }),
            );
          }}
          subagentsEnabled={subagentsEnabled}
          onSubagentsEnabled={(v) => {
            setSubagentsEnabled(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, subagentsEnabled: v }),
            );
          }}
          planEnabled={planEnabled}
          onPlanEnabled={(v) => {
            setPlanEnabled(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, planEnabled: v }),
            );
          }}
          disableWebSearch={disableWebSearch}
          onDisableWebSearch={(v) => {
            setDisableWebSearch(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, disableWebSearch: v }),
            );
          }}
          useLeader={useLeader}
          onUseLeader={(v) => {
            setUseLeader(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, useLeader: v }),
            );
          }}
          reopenLastSession={reopenLastSession}
          onReopenLastSession={(v) => {
            setReopenLastSession(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, reopenLastSession: v }),
            );
          }}
          cliInfo={cliInfo}
          onDoctor={() => void openDoctor()}
          onOpenShortcutsHelp={() => setShowShortcuts(true)}
          versionFooter={tr("app.versionFooter")}
          defaultOpenTarget={defaultOpenTarget}
          onDefaultOpenTarget={(v) => {
            setDefaultOpenTarget(v);
            void api.settingsGet().then((s) =>
              api.settingsSet({ ...s, defaultOpenTarget: v }),
            );
          }}
          archivedGroups={archivedGroups}
          onRestoreArchivedSessions={(ids) => {
            const rows = ids
              .map((id) => sessions.find((x) => x.id === id))
              .filter((s): s is SessionRow => !!s);
            void restoreSessions(rows);
          }}
          onDeleteArchivedSessions={(ids) => {
            const rows = ids
              .map((id) => sessions.find((x) => x.id === id))
              .filter((s): s is SessionRow => !!s);
            deleteSessionsConfirm(rows);
          }}
          projectPath={remoteRuntime.enabled ? null : activeProject?.path ?? null}
          onSkillsPrefsChanged={() => {
            void refreshSkills();
          }}
          onAskPiForCapability={(request) => {
            void newChat(activeProject ?? null, {
              seedDraft: request
                ? tr("piExt.askDraftWithRequest", { request })
                : tr("piExt.askDraft"),
            });
          }}
          />
        </Suspense>
      ) : (
      <div className="workbench">
        {/* LEFT — fully hideable (not icon-rail); open via top-bar icon when closed */}
        <aside
          className={
            "sidebar" +
            (layout.sidebarCollapsed ? " sidebar--hidden" : "") +
            (dragZone === "sidebar" ? " is-drop-target" : "") +
            (dragZone === "main" ? " is-drop-idle" : "")
          }
          aria-hidden={layout.sidebarCollapsed}
        >
          {dragZone === "sidebar" && (
            <div className="drop-overlay drop-overlay--project" aria-hidden>
              <div className="drop-overlay__card">
                <span className="drop-overlay__icon">
                  <IconFolderPlus size={22} />
                </span>
                <strong>{tr("composer.dropProjectTitle")}</strong>
                <span>{tr("composer.dropProjectHint")}</span>
              </div>
            </div>
          )}
          {/* Row 1: traffic-light height — panel toggle sits just right of traffic lights */}
          <div
            className="sidebar-chrome"
            data-tauri-drag-region
            onDoubleClick={() => {
              if (useCustomWindowChrome) void toggleMaximizeFromTitlebar();
            }}
          >
            <Tip label={tr("main.leftPaneHide")}>
              <button
                type="button"
                className="chrome-btn chrome-btn--traffic main__pane-toggle is-on"
                aria-label={tr("main.leftPaneHide")}
                onClick={() =>
                  setLayout((l) => {
                    const n = { ...l, sidebarCollapsed: true };
                    saveLayout(localStorage, n);
                    return n;
                  })
                }
              >
                <IconPanel size={16} />
              </button>
            </Tip>
            <div className="sidebar-chrome__drag" data-tauri-drag-region />
          </div>

          {/* Row 2: search only — brand lives in the footer avatar */}
          <div className="sidebar-brand-row">
            <div className="sidebar-brand-row__left" aria-hidden />
            <Tip label={tr("sidebar.search")}>
              <button
                type="button"
                className="chrome-btn"
                aria-label={tr("sidebar.search")}
                onClick={() => {
                  setShowSearch(true);
                  setSearchQuery("");
                }}
              >
                <IconSearch size={16} />
              </button>
            </Tip>
          </div>

          {/* Primary nav — new orphan session + scheduled tasks (Codex parity) */}
          <div className="sidebar-nav">
            <button
              type="button"
              className="nav-new"
              onClick={() => void newChat(null)}
            >
              <span className="nav-item__icon">
                <IconNewChat size={16} />
              </span>
              {workspace === "pr"
                ? tr("pr.newReview")
                : tr("sidebar.newSession")}
            </button>
            <button
              type="button"
              className={
                "nav-item" +
                (mainPane === "automations" ? " nav-item--active" : "")
              }
              onClick={() => navigateAutomations()}
            >
              <span className="nav-item__icon">
                <IconScheduled size={16} />
              </span>
              {tr("sidebar.scheduled")}
            </button>
          </div>

          <OverlayScroll className="sidebar__scroll" viewportClassName="sidebar__scroll-inner">
            {workspace === "pr" ? (
              <PrTree
                repos={pr.repos}
                activePr={pr.activePr}
                labels={{
                  repos: tr("pr.repos"),
                  addRepo: tr("pr.addRepo"),
                  removeRepo: tr("pr.removeRepo"),
                  empty: tr("pr.empty"),
                  noPulls: tr("pr.noPulls"),
                  loading: tr("pr.loading"),
                  draft: tr("pr.draft"),
                  reviewModel: tr("pr.reviewModel"),
                  defaultModel: tr("batch.defaultModel"),
                  comment: tr("pr.comment"),
                  multiReview: tr("pr.multiReview"),
                }}
                onToggle={pr.toggleRepo}
                onAddRepo={pr.addRepo}
                onRemoveRepo={pr.removeRepo}
                onOpenPr={pr.openReview}
                onPostComment={pr.postInlineComment}
                reviewModelId={prReviewModel}
                availableModels={availableModels.map((model) => ({
                  id: model.id,
                  label: model.label,
                }))}
                onReviewModel={(next) => {
                  setPrReviewModel(next);
                  savePrReviewModel(localStorage, next);
                }}
                onMultiReview={pr.startMultiReview}
              />
            ) : (
              <>
            {/* L1 — Projects section */}
            <div className="tree-l1">
              <button
                type="button"
                className="tree-l1__head"
                onClick={() => setProjectsOpen((v) => !v)}
              >
                {projectsOpen ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )}
                <span className="tree-l1__label">
                  {tr("sidebar.projects")}
                </span>
              </button>
              <Tip label={tr("sidebar.addProject")}>
                <button
                  type="button"
                  className="tree-l1__action"
                  aria-label={tr("sidebar.addProject")}
                  onClick={() => void addProject(false)}
                >
                  <IconPlus size={15} />
                </button>
              </Tip>
            </div>

            {projectsOpen && projects.length === 0 && (
              <div className="sidebar-empty">
                {tr("sidebar.noProjects")}
              </div>
            )}

            {projectsOpen &&
              projects.map((proj) => {
                const open = expandedProjects[proj.id] !== false;
                const projSessions = sessionsForProject(proj.id);
                return (
                  <div key={proj.id} className="tree-project">
                    {/* L2 — project folder: expand/collapse only (not selectable) */}
                    <div
                      className={
                        "tree-l2" +
                        (isProjectPathMissing(proj.pathOk)
                          ? " tree-l2--path-missing"
                          : "")
                      }
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => {
                        setExpandedProjects((e) => ({
                          ...e,
                          [proj.id]: !open,
                        }));
                      }}
                      onContextMenu={(e) => openProjectMenu(e, proj)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpandedProjects((ex) => ({
                            ...ex,
                            [proj.id]: !open,
                          }));
                        }
                      }}
                    >
                      <span className="tree-l2__icon">
                        <IconFolder size={15} />
                      </span>
                      <Tip
                        label={
                          isProjectPathMissing(proj.pathOk)
                            ? tr("project.pathMissing", { name: proj.name })
                            : proj.path
                        }
                      >
                        <span className="tree-l2__name">
                          {proj.pinned ? (
                            <IconPin size={12} className="tree-l2__pin" />
                          ) : null}
                          {proj.name}
                        </span>
                      </Tip>
                      {isProjectPathMissing(proj.pathOk) ? (
                        <span className="project-row__badge project-row__badge--path-missing">
                          {tr("sidebar.pathMissing")}
                        </span>
                      ) : !proj.trusted ? (
                        <span className="project-row__badge">
                          {tr("sidebar.untrusted")}
                        </span>
                      ) : null}
                      <span className="tree-l2__actions">
                        <Tip label={tr("sidebar.newConversation")}>
                          <button
                            type="button"
                            className="tree-icon-btn"
                            disabled={
                              !proj.trusted ||
                              isProjectPathMissing(proj.pathOk)
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              void newChat(proj);
                            }}
                          >
                            <IconSquarePen size={14} />
                          </button>
                        </Tip>
                        <Tip label={tr("sidebar.menu")}>
                          <button
                            type="button"
                            className="tree-icon-btn"
                            onClick={(e) => openProjectMenu(e, proj)}
                          >
                            <IconMore size={14} />
                          </button>
                        </Tip>
                      </span>
                    </div>

                    {open && (
                      <div className="tree-l3-list-wrap">
                        {isProjectPathMissing(proj.pathOk) && (
                          <button
                            type="button"
                            className="tree-l3 tree-l3--hint"
                            onClick={(e) => {
                              e.stopPropagation();
                              void relocateProject(proj);
                            }}
                          >
                            {tr("sidebar.relocateProject")}
                          </button>
                        )}
                        {!proj.trusted && !isProjectPathMissing(proj.pathOk) && (
                          <button
                            type="button"
                            className="tree-l3 tree-l3--hint"
                            onClick={(e) => {
                              e.stopPropagation();
                              void trustProject(proj);
                            }}
                          >
                            {tr("sidebar.trustProject")}
                          </button>
                        )}
                        {projSessions.length > 0 ? (
                          <VirtualList
                            className="tree-l3-list"
                            items={projSessions}
                            getKey={(s) => s.id}
                            rowHeight={SIDEBAR_SESSION_ROW_HEIGHT}
                            gap={SIDEBAR_SESSION_ROW_GAP}
                            scrollToKey={
                              session.sessionId &&
                              projSessions.some((x) => x.id === session.sessionId)
                                ? session.sessionId
                                : null
                            }
                            renderItem={(s) => {
                              const working = busySessionId === s.id;
                              return (
                                <div
                                  className={
                                    "tree-l3" +
                                    (session.sessionId === s.id
                                      ? " tree-l3--active"
                                      : "") +
                                    (s.archived ? " tree-l3--archived" : "") +
                                    (working ? " tree-l3--working" : "")
                                  }
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => void openSession(s, proj)}
                                  onContextMenu={(e) => openSessionMenu(e, s)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      void openSession(s, proj);
                                  }}
                                >
                                  <span className="tree-l3__title">
                                    {s.pinned ? (
                                      <span
                                        className="tree-l3__kind"
                                        title={tr("session.pinned")}
                                        aria-label={tr("session.pinned")}
                                      >
                                        <IconPin
                                          size={12}
                                          className="tree-l3__pin"
                                        />
                                      </span>
                                    ) : null}
                                    {s.scheduled ? (
                                      <span
                                        className="tree-l3__kind"
                                        title={tr("automations.msgTag")}
                                        aria-label={tr("automations.msgTag")}
                                      >
                                        <IconClock size={13} />
                                      </span>
                                    ) : null}
                                    <span className="tree-l3__name">
                                      {s.title || "Untitled"}
                                    </span>
                                    {cacheStandings[s.id] ? (
                                      <span
                                        className="tree-l3__cache"
                                        title={tr("sidebar.cacheStanding", { n: Math.round(cacheStandings[s.id]!.hitRate * 100) })}
                                      >
                                        {Math.round(cacheStandings[s.id]!.hitRate * 100)}%
                                      </span>
                                    ) : null}
                                  </span>
                                  {working ? (
                                    <Tip label={tr("sidebar.sessionWorking")}>
                                      <span
                                        className="tree-l3__status"
                                        aria-label={tr(
                                          "sidebar.sessionWorking",
                                        )}
                                      >
                                        <Spinner
                                          size={14}
                                          className="tree-l3__spinner"
                                        />
                                      </span>
                                    </Tip>
                                  ) : (
                                    <span className="tree-l3__actions tree-l3__actions--triple">
                                      <Tip
                                        label={
                                          s.pinned
                                            ? tr("session.unpin")
                                            : tr("session.pin")
                                        }
                                      >
                                        <button
                                          type="button"
                                          className="tree-icon-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void pinSession(s, !s.pinned);
                                          }}
                                        >
                                          {s.pinned ? (
                                            <IconPinOff size={13} />
                                          ) : (
                                            <IconPin size={13} />
                                          )}
                                        </button>
                                      </Tip>
                                      <Tip
                                        label={
                                          s.archived
                                            ? tr("sidebar.unarchive")
                                            : tr("sidebar.archive")
                                        }
                                      >
                                        <button
                                          type="button"
                                          className="tree-icon-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void archiveSession(
                                              s,
                                              !s.archived,
                                            );
                                          }}
                                        >
                                          <IconArchive size={13} />
                                        </button>
                                      </Tip>
                                      <Tip label={tr("sidebar.menu")}>
                                        <button
                                          type="button"
                                          className="tree-icon-btn"
                                          onClick={(e) =>
                                            openSessionMenu(e, s)
                                          }
                                        >
                                          <IconMore size={13} />
                                        </button>
                                      </Tip>
                                    </span>
                                  )}
                                </div>
                              );
                            }}
                          />
                        ) : null}
                        {projSessions.length === 0 && proj.trusted && (
                          <div className="sidebar-empty" style={{ padding: "4px 10px" }}>
                            {tr("sidebar.noChats")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Orphans / history */}
            <div className="tree-l1" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="tree-l1__head"
                onClick={() => setHistoryOpen((v) => !v)}
              >
                {historyOpen ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronRight size={14} />
                )}
                <span className="tree-l1__label">
                  {tr("sidebar.otherSessions")}
                </span>
              </button>
            </div>
            {historyOpen && orphanSessions.length > 0 ? (
              <VirtualList
                className="tree-orphan-list"
                items={orphanSessions}
                getKey={(s) => s.id}
                rowHeight={SIDEBAR_SESSION_ROW_HEIGHT}
                gap={SIDEBAR_SESSION_ROW_GAP}
                scrollToKey={
                  session.sessionId &&
                  orphanSessions.some((x) => x.id === session.sessionId)
                    ? session.sessionId
                    : null
                }
                renderItem={(s) => {
                  const working = busySessionId === s.id;
                  return (
                    <div
                      className={
                        "tree-l3 tree-l3--orphan" +
                        (session.sessionId === s.id
                          ? " tree-l3--active"
                          : "") +
                        (working ? " tree-l3--working" : "")
                      }
                      role="button"
                      tabIndex={0}
                      onClick={() => void openSession(s)}
                      onContextMenu={(e) => openSessionMenu(e, s)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void openSession(s);
                      }}
                    >
                      <span className="tree-l3__title">
                        {s.pinned ? (
                          <span
                            className="tree-l3__kind"
                            title={tr("session.pinned")}
                            aria-label={tr("session.pinned")}
                          >
                            <IconPin
                              size={12}
                              className="tree-l3__pin"
                            />
                          </span>
                        ) : null}
                        {s.scheduled ? (
                          <span
                            className="tree-l3__kind"
                            title={tr("automations.msgTag")}
                            aria-label={tr("automations.msgTag")}
                          >
                            <IconClock size={13} />
                          </span>
                        ) : null}
                        <span className="tree-l3__name">
                          {s.title || "Untitled"}
                        </span>
                        {cacheStandings[s.id] ? (
                          <span
                            className="tree-l3__cache"
                            title={tr("sidebar.cacheStanding", { n: Math.round(cacheStandings[s.id]!.hitRate * 100) })}
                          >
                            {Math.round(cacheStandings[s.id]!.hitRate * 100)}%
                          </span>
                        ) : null}
                      </span>
                      {working ? (
                        <Tip label={tr("sidebar.sessionWorking")}>
                          <span
                            className="tree-l3__status"
                            aria-label={tr("sidebar.sessionWorking")}
                          >
                            <Spinner
                              size={14}
                              className="tree-l3__spinner"
                            />
                          </span>
                        </Tip>
                      ) : (
                        <span className="tree-l3__actions tree-l3__actions--triple">
                          <Tip
                            label={
                              s.pinned
                                ? tr("session.unpin")
                                : tr("session.pin")
                            }
                          >
                            <button
                              type="button"
                              className="tree-icon-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                void pinSession(s, !s.pinned);
                              }}
                            >
                              {s.pinned ? (
                                <IconPinOff size={13} />
                              ) : (
                                <IconPin size={13} />
                              )}
                            </button>
                          </Tip>
                          <Tip label={tr("sidebar.archive")}>
                            <button
                              type="button"
                              className="tree-icon-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                void archiveSession(s, !s.archived);
                              }}
                            >
                              <IconArchive size={13} />
                            </button>
                          </Tip>
                          <button
                            type="button"
                            className="tree-icon-btn"
                            onClick={(e) => openSessionMenu(e, s)}
                          >
                            <IconMore size={13} />
                          </button>
                        </span>
                      )}
                    </div>
                  );
                }}
              />
            ) : null}
              </>
            )}
          </OverlayScroll>

          <WorkspaceSwitcher
            active={workspace}
            onSelect={(id) => {
              setWorkspace(id);
              saveWorkspace(localStorage, id);
              const next = workspaceSkin(workspaceSkins, id);
              if (isThemeSkinId(next) && next !== skin) {
                applySkinOnly(next);
              }
            }}
            labels={{
              code: tr("workspace.code"),
              pr: tr("workspace.pr"),
            }}
            comingSoonSuffix={tr("workspace.comingSoon")}
          />

          <UserMenu
            open={showUserMenu}
            onClose={() => setShowUserMenu(false)}
            theme={theme}
            account={account}
            activeProvider={activeCustomProvider}
            accountBusy={accountBusy}
            labels={{
              settings: tr("sidebar.settings"),
              theme: tr("user.theme"),
              themeLight: tr("user.themeLight"),
              themeDark: tr("user.themeDark"),
              local: tr("common.local"),
              signedIn: tr("account.signedIn"),
              signedOut: tr("account.signedOut"),
              login: tr("account.login"),
              logout: tr("account.logout"),
              remaining: tr("account.quotaRemaining"),
              customProvider: tr("prov.customProvider"),
              resetsAt: tr("account.resetsAt"),
            }}
            onSettings={() => navigateSettings("general")}
            onAccountSettings={() => navigateSettings("runtime")}
            onToggleTheme={toggleThemeBtn}
            onLogin={() => {}}
            onLogout={() => {}}
          >
            <button
              type="button"
              className={
                "sidebar__footer" + (showUserMenu ? " is-open" : "")
              }
              aria-label={tr("user.menu")}
              aria-haspopup="menu"
              aria-expanded={showUserMenu}
              onClick={() => setShowUserMenu((v) => !v)}
            >
              <div className="user-avatar" aria-hidden>
                <PiLogo size={14} />
              </div>
              <div className="user-meta">
                <span className="user-meta__name">
                  {userName || tr("app.name")}
                </span>
                <span className="user-meta__quota">{tr("common.local")}</span>
              </div>
            </button>
          </UserMenu>
        </aside>

        {/* CENTER — solid pane; top icons fully toggle L/R columns */}
        <main
          className={
            "main" +
            (layout.sidebarCollapsed ? " main--sidebar-hidden" : "") +
            (dragZone === "main" ? " is-drop-target" : "") +
            (dragZone === "sidebar" ? " is-drop-idle" : "")
          }
        >
          {dragZone === "main" && (
            <div className="drop-overlay drop-overlay--attach" aria-hidden>
              <div className="drop-overlay__card">
                <span className="drop-overlay__icon">
                  <IconAttach size={22} />
                </span>
                <strong>{tr("composer.dropAttachTitle")}</strong>
                <span>{tr("composer.dropAttachHint")}</span>
              </div>
            </div>
          )}
          {toast && (
            <div className="app-toast" role="status">
              {toast}
            </div>
          )}
          {appUpdateOffer?.updateAvailable ? (
            <div className="app-update-banner" role="status">
              <span className="app-update-banner__text">
                {tr("app.updateBanner", {
                  latest: appUpdateOffer.latestVersion,
                  current: appUpdateOffer.currentVersion,
                })}
              </span>
              <div className="app-update-banner__actions">
                <button
                  type="button"
                  className="btn btn--solid btn--sm"
                  disabled={appUpdateInstallPercent !== null}
                  onClick={() => {
                    setAppUpdateInstallPercent(0);
                    void api
                      .appInstallUpdate(({ downloaded, total }) => {
                        setAppUpdateInstallPercent(
                          total && total > 0
                            ? Math.min(
                                100,
                                Math.round((downloaded / total) * 100),
                              )
                            : 0,
                        );
                      })
                      .catch((error) => {
                        setAppUpdateInstallPercent(null);
                        setToast(
                          tr("settings.checkUpdateFailed", {
                            error: String(error),
                          }),
                        );
                      });
                  }}
                >
                  {appUpdateInstallPercent === null
                    ? tr("app.updateBannerOpen")
                    : tr("app.updateBannerInstalling", {
                        percent: appUpdateInstallPercent,
                      })}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={appUpdateInstallPercent !== null}
                  onClick={() => {
                    try {
                      localStorage.setItem(
                        "pi-app.dismissedUpdate",
                        appUpdateOffer.latestVersion,
                      );
                    } catch {
                      /* ignore */
                    }
                    setAppUpdateOffer(null);
                  }}
                >
                  {tr("app.updateBannerDismiss")}
                </button>
              </div>
            </div>
          ) : null}
          <div
            className="main__top"
            data-tauri-drag-region
            onDoubleClick={() => {
              if (useCustomWindowChrome) void toggleMaximizeFromTitlebar();
            }}
          >
            <div className="main__title-row" data-tauri-drag-region>
              {/* When left rail is hidden, reopen control sits next to traffic lights */}
              {layout.sidebarCollapsed && (
                <Tip label={tr("main.leftPaneShow")}>
                  <button
                    type="button"
                    className="chrome-btn chrome-btn--traffic main__pane-toggle"
                    aria-label={tr("main.leftPaneShow")}
                    onClick={() =>
                      setLayout((l) => {
                        const n = openWorkbenchPane(
                          l,
                          "sidebar",
                          window.matchMedia(NARROW_WORKBENCH_QUERY).matches,
                        );
                        saveLayout(localStorage, n);
                        return n;
                      })
                    }
                  >
                    <IconPanel size={16} />
                  </button>
                </Tip>
              )}
              {mainPane === "automations" ? (
                <>
                  <span className="main__title-icon">
                    <IconScheduled size={16} />
                  </span>
                  <h1 className="main__title" data-tauri-drag-region>
                    {tr("automations.title")}
                  </h1>
                </>
              ) : (
                (() => {
                  const cur = sessions.find((s) => s.id === session.sessionId);
                  const title =
                    cur?.title ||
                    session.title ||
                    activeProject?.name ||
                    tr("session.new");
                  const isScheduledSession =
                    !!cur?.scheduled ||
                    messages.some(
                      (m) =>
                        m.role === "user" &&
                        !!parseScheduledUserContent(m.content || ""),
                    );
                  return (
                    <>
                      {isScheduledSession ? (
                        <span
                          className="main__title-icon"
                          title={tr("automations.msgTag")}
                          aria-label={tr("automations.msgTag")}
                        >
                          <IconClock size={16} />
                        </span>
                      ) : null}
                      <Tip label={title}>
                        <h1 className="main__title" data-tauri-drag-region>
                          {title}
                        </h1>
                      </Tip>
                    </>
                  );
                })()
              )}
            </div>
            <div className="main__top-actions">
              {/* Retry progress only — connection is silent; thinking lives in chat */}
              {retryStatus && (
                <Tip
                  label={retryStatus.reason || ""}
                  disabled={!retryStatus.reason}
                >
                  <span className="main__sub main__sub--retry">
                    {retryStatus.reason
                      ? tr("main.retryingWithReason", {
                          attempt: String(retryStatus.attempt),
                          max: String(retryStatus.maxRetries),
                          reason:
                            retryStatus.reason.length > 72
                              ? `${retryStatus.reason.slice(0, 72)}…`
                              : retryStatus.reason,
                        })
                      : tr("main.retrying", {
                          attempt: String(retryStatus.attempt),
                          max: String(retryStatus.maxRetries),
                        })}
                  </span>
                </Tip>
              )}
              {activeProject && mainPane === "chat" && !remoteRuntime.enabled && (
                <OpenLocationButton
                  path={activeProject.path}
                  target={defaultOpenTarget || "finder"}
                  onTargetChange={persistOpenTarget}
                  onOpenError={(e) => setLocalError(e)}
                  onCopied={() => {
                    setToast(tr("attach.copyPath") + " ✓");
                    window.setTimeout(() => setToast(null), 1600);
                  }}
                  platform={platform === "win" ? "win" : platform === "mac" ? "mac" : "other"}
                  labels={{
                    openLocation: tr("main.openLocation"),
                    openHint: tr("main.openLocationHint"),
                    openMenu: tr("main.openLocationMenu"),
                    finder:
                      platform === "win"
                        ? tr("main.openInExplorer")
                        : tr("main.openInFinder"),
                    systemDefault: tr("main.openSystemDefault"),
                    copyPath: tr("attach.copyPath"),
                  }}
                />
              )}
              {mainPane === "chat" && session.sessionId ? (
                <Tip
                  label={
                    tasksPanelOpen
                      ? tr("tasks.hidePanel")
                      : tr("tasks.showPanel")
                  }
                >
                  <button
                    type="button"
                    className={
                      "chrome-btn main__pane-toggle" +
                      (tasksPanelOpen ? " is-on" : "")
                    }
                    onClick={() => setTasksPanelOpen((v) => !v)}
                    aria-pressed={tasksPanelOpen}
                    aria-label={
                      tasksPanelOpen
                        ? tr("tasks.hidePanel")
                        : tr("tasks.showPanel")
                    }
                  >
                    <IconList size={16} />
                    {runningTaskCount > 0 ? (
                      <span className="rp-chrome__badge" aria-hidden>
                        {Math.min(99, runningTaskCount)}
                      </span>
                    ) : null}
                  </button>
                </Tip>
              ) : null}
              {mainPane === "chat" ? (
                <ActivityCenter
                  items={activityItems}
                  open={activityOpen}
                  onToggle={() => setActivityOpen((value) => !value)}
                  onOpenSession={(item) => {
                    markActivityReadState(item.id);
                    setActivityOpen(false);
                    trayHandlersRef.current.openSessionById(item.sessionId);
                  }}
                  onStopSession={(item) => {
                    void api.sessionStop(item.sessionId).catch((error) =>
                      showToast(String(error), 4000),
                    );
                  }}
                  onRetry={(item) => {
                    void retryActivity(item);
                  }}
                  onMarkRead={markActivityReadState}
                  onTogglePin={toggleActivityPinState}
                  onDismiss={dismissActivityState}
                  t={(key, vars) => tr(key as MessageKey, vars)}
                />
              ) : null}
              {mainPane === "chat" && activeSessionRow ? (
                <Tip label={tr("session.menu")}>
                  <button
                    type="button"
                    className="chrome-btn main__session-menu"
                    aria-label={tr("session.menu")}
                    aria-haspopup="menu"
                    onClick={(e) => openSessionMenu(e, activeSessionRow)}
                  >
                    <IconMore size={16} />
                  </button>
                </Tip>
              ) : null}
              <Tip
                label={
                  layout.asideCollapsed
                    ? tr("main.rightPaneShow")
                    : tr("main.rightPaneHide")
                }
              >
                <button
                  type="button"
                  className={
                    "chrome-btn main__pane-toggle" +
                    (!layout.asideCollapsed ? " is-on" : "")
                  }
                  aria-label={
                    layout.asideCollapsed
                      ? tr("main.rightPaneShow")
                      : tr("main.rightPaneHide")
                  }
                  onClick={() =>
                    setLayout((l) => {
                      const n = l.asideCollapsed
                        ? openWorkbenchPane(
                            l,
                            "aside",
                            window.matchMedia(NARROW_WORKBENCH_QUERY).matches,
                          )
                        : { ...l, asideCollapsed: true };
                      saveLayout(localStorage, n);
                      return n;
                    })
                  }
                >
                  <IconPanelRight size={16} />
                </button>
              </Tip>
            </div>
          </div>

          {batch.entries.length > 0 ? (
            <div className="batch-strip" aria-label={tr("batch.title")}>
              {batch.entries.map((t) => (
                <span
                  key={t.title}
                  className={"batch-chip batch-chip--" + t.status}
                  title={t.error || t.prompt}
                >
                  <span className="batch-chip__title">{t.title}</span>
                  <span className="batch-chip__model">
                    {t.modelId || tr("batch.defaultModel")}
                  </span>
                  <span className="batch-chip__status">
                    {tr(("batch." + t.status) as "batch.running")}
                  </span>
                </span>
              ))}
            </div>
          ) : null}

          <RunningTasksDock
            rows={runningSessions}
            cap={maxConcurrentAgents}
            queued={batch.entries.filter((entry) => entry.status === "pending" || entry.status === "starting").length}
            t={(key, vars) => tr(key as MessageKey, vars)}
            onOpen={(sessionId) => trayHandlersRef.current.openSessionById(sessionId)}
            onStop={(sessionId) => {
              void api.sessionStop(sessionId).catch((error) =>
                showToast(String(error), 4000),
              );
            }}
            onRaiseCap={() => {
              const next = Math.min(8, maxConcurrentAgents + 1);
              setMaxConcurrentAgents(next);
              void api.settingsGet().then((settings) => api.settingsSet({ ...settings, maxConcurrentAgents: next }));
            }}
          />

          {isComingSoon(workspace) ? (
            <div className="ws-soon">
              <h2 className="ws-soon__title">{tr("workspace.soonTitle")}</h2>
              <p className="ws-soon__body">{tr("workspace.soonBody")}</p>
            </div>
          ) : mainPane === "automations" ? (
            <AutomationsPage
              t={(k, vars) =>
                tr(k as Parameters<typeof tr>[0], vars as Record<string, string | number>)
              }
              projects={projects.map((p) => ({ id: p.id, name: p.name }))}
              defaultModelId={modelId}
              defaultEffort={effort}
              models={availableModels}
              onAiCreate={() => {
                void newChat(null, {
                  seedDraft: aiCreateSeedPrompt("Pi"),
                  switchToChat: true,
                  automationSetup: true,
                });
                setToast(tr("automations.aiComposerHint"));
                window.setTimeout(() => setToast(null), 4200);
              }}
              onRunNow={(auto) => void runAutomation(auto)}
            />
          ) : (
          <>
          {remoteRuntime.enabled && (
            <div className="conn-bar conn-bar--remote" role="status">
              <strong>{tr("remoteRuntime.active")}</strong>
              <span>
                {tr("remoteRuntime.activeTarget", {
                  target:
                    remoteRuntime.transport === "direct"
                      ? remoteRuntime.directUrl
                      : `${remoteRuntime.user}@${remoteRuntime.host}`,
                  cwd: resourceProjectPath || remoteRuntime.cwd,
                })}
              </span>
            </div>
          )}
          {activeProject && !remoteRuntime.enabled && isProjectPathMissing(activeProject.pathOk) && (
            <div className="conn-bar">
              <span style={{ fontSize: 12, opacity: 0.9, marginRight: 8 }}>
                {tr("project.pathMissingShort")}
              </span>
              <button
                type="button"
                className="btn btn--primary"
                style={{ height: 24, fontSize: 11 }}
                onClick={() => void relocateProject(activeProject)}
              >
                {tr("project.relocateToSend")}
              </button>
            </div>
          )}
          {activeProject &&
            !remoteRuntime.enabled &&
            !isProjectPathMissing(activeProject.pathOk) &&
            !activeProject.trusted && (
            <div className="conn-bar">
              <button
                type="button"
                className="btn btn--primary"
                style={{ height: 24, fontSize: 11 }}
                onClick={() => void trustProject(activeProject)}
              >
                {tr("project.trustToSend", { name: activeProject.name })}
              </button>
            </div>
          )}

          {emptyExistingSession && (
            <div className="conn-bar" role="status">
              <span style={{ fontSize: 12, opacity: 0.85 }}>
                {tr("automations.emptySession")}
              </span>
            </div>
          )}

          {/* I06: pure stream silence — cancel or keep waiting */}
          {streamStall && mainPane === "chat" && (
            <div className="stall-banner" role="status">
              <div className="stall-banner__summary">
                {tr("agent.streamStallBanner", {
                  seconds: String(streamStall.stallSeconds),
                })}
              </div>
              <div className="stall-banner__actions">
                <button
                  type="button"
                  className="btn btn--ghost stall-banner__btn"
                  onClick={() => setStreamStall(null)}
                >
                  {tr("agent.streamStallKeepWaiting")}
                </button>
                <button
                  type="button"
                  className="btn btn--primary stall-banner__btn stall-banner__btn--danger"
                  onClick={() => {
                    setStreamStall(null);
                    void stop();
                  }}
                >
                  {tr("agent.streamStallCancel")}
                </button>
              </div>
            </div>
          )}

          {mainPane === "chat" && showChatFind && (
            <ChatFindBar
              key={chatFindFocusKey}
              query={chatFindQuery}
              activeIndex={chatFindIndex}
              matchCount={chatFindMatches.length}
              labels={{
                placeholder: tr("chatFind.placeholder"),
                prev: tr("chatFind.prev"),
                next: tr("chatFind.next"),
                close: tr("chatFind.close"),
                count: tr("chatFind.count"),
                noMatches: tr("chatFind.noMatches"),
                aria: tr("chatFind.aria"),
              }}
              onQueryChange={(q) => {
                setChatFindQuery(q);
                setChatFindIndex(0);
              }}
              onPrev={chatFindPrev}
              onNext={chatFindNext}
              onClose={() => setShowChatFind(false)}
            />
          )}
          {comparisonOpen && comparisonEntries.length > 0 ? (
            <ComparisonView
              entries={comparisonEntries}
              getMessages={comparisonMessages}
              loadMessages={comparisonPair ? loadComparisonMessages : undefined}
              projectPath={resourceProjectPath}
              t={(key, vars) => tr(key as MessageKey, vars)}
              onClose={() => {
                setComparisonOpen(false);
                setComparisonPair(null);
              }}
              onAdopt={(entry, answer) => {
                if (entry.worktreePath && resourceProjectPath) {
                  const cleanupPaths = comparisonEntries
                    .map((candidate) => candidate.worktreePath)
                    .filter((path): path is string => !!path);
                  setAppDialog({
                    kind: "confirm",
                    title: tr("comparison.adoptWorktreeTitle"),
                    message: tr("comparison.adoptWorktreeMessage", {
                      model: entry.modelId || tr("batch.defaultModel"),
                    }),
                    confirmLabel: tr("comparison.adopt"),
                    onConfirm: () => {
                      void api
                        .gitWorktreeAdopt(resourceProjectPath, entry.worktreePath!, cleanupPaths)
                        .then(() => {
                          if (session.sessionId) {
                            return api.sessionAdoptAnswer(
                              session.sessionId,
                              answer.content,
                              entry.modelId,
                            );
                          }
                          return undefined;
                        })
                        .then(() => {
                          setMessages((current) => [
                            ...current,
                            {
                              id: `adopted-${Date.now()}`,
                              role: "assistant",
                              content: answer.content,
                              modelId: entry.modelId,
                              createdAt: new Date().toISOString(),
                            },
                          ]);
                          showToast(tr("comparison.adopted", {
                            model: entry.modelId || tr("batch.defaultModel"),
                          }), 3200);
                        })
                        .catch((error) => showToast(String(error), 6000));
                    },
                  });
                  return;
                }
                if (session.sessionId) {
                  void api
                    .sessionAdoptAnswer(
                      session.sessionId,
                      answer.content,
                      entry.modelId,
                    )
                    .catch((error) => showToast(String(error), 4000));
                }
                setMessages((current) => [
                  ...current,
                  {
                    id: `adopted-${Date.now()}`,
                    role: "assistant",
                    content: answer.content,
                    modelId: entry.modelId,
                    createdAt: new Date().toISOString(),
                  },
                ]);
                showToast(
                  tr("comparison.adopted", {
                    model: entry.modelId || tr("batch.defaultModel"),
                  }),
                  3200,
                );
              }}
            />
          ) : null}
          {mainPane === "chat" && tasksPanelOpen && session.sessionId ? (
            <AgentTasksPanel
              messages={messages}
              t={(k, vars) => tr(k, vars)}
              onClose={() => setTasksPanelOpen(false)}
            />
          ) : null}

          {/* Pre-turn / host errors: T04 deck (problem · cause · primary · secondary) */}
          {errorBanner && !hasChatTurnError && (
            <div className="error-banner" role="alert">
              {errorBanner.code ? (
                <div className="error-banner__code">{errorBanner.code}</div>
              ) : null}
              <div className="error-banner__summary">{errorBanner.summary}</div>
              {errorBanner.cause ? (
                <div className="error-banner__cause">{errorBanner.cause}</div>
              ) : null}
              <div className="error-banner__actions">
                {errorBanner.primary ? (
                  <button
                    type="button"
                    className="btn btn--primary error-banner__primary"
                    disabled={
                      connecting && errorBanner.primary.id === "reconnect"
                    }
                    onClick={() => {
                      if (errorBanner.primary) {
                        runErrorBannerAction(errorBanner.primary);
                      }
                    }}
                  >
                    {errorBanner.primary.label}
                  </button>
                ) : null}
                {errorBanner.secondary ? (
                  <button
                    type="button"
                    className="btn btn--ghost error-banner__secondary"
                    disabled={
                      connecting && errorBanner.secondary.id === "reconnect"
                    }
                    onClick={() => {
                      if (errorBanner.secondary) {
                        runErrorBannerAction(errorBanner.secondary);
                      }
                    }}
                  >
                    {errorBanner.secondary.label}
                  </button>
                ) : null}
                {!errorBanner.primary &&
                  (errorBanner.reconnectHint ||
                    session.state === "disconnected") && (
                    <button
                      type="button"
                      className="btn btn--ghost error-banner__reconnect"
                      disabled={connecting}
                      onClick={() => {
                        setLocalError(null);
                        setErrorDetailOpen(false);
                        void ensureConnected(true).then((sid) => {
                          if (sid) setLocalError(null);
                        });
                      }}
                    >
                      {tr("main.reconnect")}
                    </button>
                  )}
                {errorBanner.detail ? (
                  <button
                    type="button"
                    className="error-banner__details-btn"
                    aria-expanded={errorDetailOpen}
                    onClick={() => setErrorDetailOpen((v) => !v)}
                  >
                    {errorDetailOpen
                      ? tr("error.hideDetails")
                      : tr("error.details")}
                  </button>
                ) : null}
              </div>
              {errorBanner.detail && errorDetailOpen && (
                <pre className="error-banner__detail">{errorBanner.detail}</pre>
              )}
            </div>
          )}

          <div
            className="main__stage"
            style={
              {
                ["--composer-float-pad"]: `${composerFloatPad}px`,
              } as CSSProperties
            }
          >
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {streamA11yNote}
          </div>
          <ConversationThread
            locale={locale}
            messages={messages}
            sessionState={session.state}
            sessionKey={session.sessionId ?? `draft-${session.title ?? "new"}`}
            projectPath={resourceProjectPath}
            suppressEmptyCopy={welcomeSession}
            canEditLastUser={canEditLastUser}
            lastUserMessageId={lastUserMessageId}
            editingUserMessageId={editingUserMessageId}
            editSubmitting={editSubmitting}
            editAttachments={editAttachments}
            onEditUserMessage={beginEditLastUser}
            onCancelEditUserMessage={cancelEditUser}
            onSubmitEditUserMessage={(msg, content) => {
              void submitEditLastUser(msg, content);
            }}
            onRemoveEditAttachment={(att) =>
              setEditAttachments((prev) =>
                prev.filter((x) => x.path !== att.path),
              )
            }
            canRewindSession={canRewindSession && !!session.sessionId}
            onRewindToUserMessage={onRewindToUserMessage}
            onForkFromUserMessage={onForkFromUserMessage}
            onRetryInterrupted={retryInterruptedTurn}
            turnStartedAt={turnStartedAt}
            onOpenResource={(target) => {
              setLayout((l) => {
                if (l.asideCollapsed) {
                  const n = openWorkbenchPane(
                    l,
                    "aside",
                    window.matchMedia(NARROW_WORKBENCH_QUERY).matches,
                  );
                  saveLayout(localStorage, n);
                  return n;
                }
                return l;
              });
              setResourceOpenTarget(target);
            }}
            onAddAttachmentToComposer={(att) =>
              setAttachments((prev) => mergeAttachments(prev, [att]))
            }
            attachLabels={attachLabels}
            findQuery={showChatFind ? chatFindQuery : ""}
            findHitMessageIds={showChatFind ? chatFindHitIds : undefined}
            findActive={showChatFind ? chatFindActive : null}
          />

          <div
            ref={composerWrapRef}
            className={
              "composer-wrap composer-wrap--float" +
              (welcomeSession ? " composer-wrap--welcome" : "")
            }
          >
            {welcomeSession ? (
              <div className="composer-welcome-mark">
                <PiLogo size={44} />
                <h1 className="welcome-headline">{tr("welcome.headline")}</h1>
                <p className="welcome-sub">{tr("welcome.sub")}</p>
              </div>
            ) : null}
            {perm ? (
              <div
                ref={permBarRef}
                className="perm-bar"
                role="dialog"
                aria-modal="true"
                aria-labelledby="perm-bar-title"
                aria-describedby="perm-bar-summary"
              >
                <div className="sr-only" aria-live="assertive">
                  {tr("a11y.permissionNeeded")}
                </div>
                <div className="perm-bar__head">
                  <span className="perm-bar__badge" id="perm-bar-title">
                    {tr("perm.title")}
                  </span>
                  <span className="perm-bar__tool">
                    {perm.title || perm.toolName}
                  </span>
                </div>
                <p className="perm-bar__summary" id="perm-bar-summary">
                  {formatPermissionSummary({
                    toolName: perm.toolName,
                    title: perm.title,
                    command: perm.preview,
                  })}
                </p>
                {perm.preview?.trim() ? (
                  <pre className="perm-bar__preview">{perm.preview.trim()}</pre>
                ) : null}
                <div className="perm-bar__actions" role="group">
                  {mapPermissionButtons(perm.options, {
                    allowOnce: tr("perm.allowOnce"),
                    allowSession: tr("perm.allowSession"),
                    deny: tr("perm.deny"),
                  }).map((btn) => (
                    <button
                      key={btn.decision + btn.optionId}
                      type="button"
                      className={
                        "perm-bar__btn" +
                        (btn.decision === "allow_once"
                          ? " perm-bar__btn--allow"
                          : btn.decision === "deny"
                            ? " perm-bar__btn--deny"
                            : " perm-bar__btn--session")
                      }
                      title={
                        btn.decision === "allow_once"
                          ? tr("perm.hintOnce")
                          : btn.decision === "allow_session"
                            ? tr("perm.hintSession")
                            : tr("perm.hintDeny")
                      }
                      onClick={() =>
                        void api
                          .sessionResolvePermission({
                            rpcId: perm.rpcId,
                            decision: btn.decision,
                            optionId: btn.optionId,
                            scopeKey: perm.scopeKey,
                          })
                          .then(() => setPerm(null))
                      }
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div
              ref={composerShellRef}
              className={
                "composer" +
                (dragZone === "main" ? " composer--drop-ready" : "")
              }
            >
              <div className="composer__topbar">
                <ComposerProjectMenu
                  activeProject={activeProject}
                  projects={projects}
                  labels={{
                    pickProject: tr("composer.pickProject"),
                    addProject: tr("composer.addProject"),
                    searchProjects: tr("composer.searchProjects"),
                    newProject: tr("composer.newProject"),
                    chooseProject: tr("composer.chooseProject"),
                    noProjectsMatch: tr("composer.noProjectsMatch"),
                    worktrees: tr("composer.worktrees"),
                    worktreesEmpty: tr("composer.worktreesEmpty"),
                    worktreesUnavailable: tr("composer.worktreesUnavailable"),
                    worktreeCurrent: tr("composer.worktreeCurrent"),
                    worktreeSwitch: tr("composer.worktreeSwitch"),
                    worktreeMain: tr("composer.worktreeMain"),
                    worktreeDetached: tr("composer.worktreeDetached"),
                    pathMissing: tr("project.pathMissingShort"),
                    worktreeNew: tr("composer.worktreeNew"),
                    worktreeNewChat: tr("composer.worktreeNewChat"),
                    worktreeGc: tr("composer.worktreeGc"),
                  }}
                  worktrees={gitWorktrees}
                  currentWorkspacePath={resourceProjectPath}
                  worktreesAvailable={gitWorktreesAvailable}
                  worktreesLoading={gitWorktreesLoading}
                  worktreesReason={gitWorktreesReason}
                  disabled={
                    session.state === "streaming" ||
                    session.state === "awaiting_permission"
                  }
                  onSelect={(proj) => {
                    void bindSessionProject(proj);
                  }}
                  onAdd={() => {
                    void addProjectFromPicker({ bindSession: true });
                  }}
                  onSwitchWorktree={(wt) => {
                    void switchToWorktree(wt);
                  }}
                  onCreateWorktree={() => wt.create.openDialog()}
                  onCreateWorktreeAndChat={() =>
                    wt.create.openDialog({ startNewChat: true })
                  }
                  onGcWorktrees={wt.gc.openDialog}
                  onOpen={refreshGitWorktrees}
                />
              </div>
              {sendQueue.activeQueue.length > 0 && (
                <div
                  className="composer__queue"
                  aria-label={tr("composer.queueCount", {
                    n: String(sendQueue.activeQueue.length),
                  })}
                >
                  <div className="composer__queue-head">
                    <IconClock size={14} aria-hidden />
                    <span className="composer__queue-title">
                      {tr("composer.queueCount", {
                        n: String(sendQueue.activeQueue.length),
                      })}
                    </span>
                    <button
                      type="button"
                      className="composer__queue-clear"
                      onClick={sendQueue.clearQueue}
                    >
                      {tr("composer.queueClear")}
                    </button>
                  </div>
                  {sendQueue.flushHold ? (
                    <div className="composer__queue-hold" role="status">
                      <span className="composer__queue-hold-text">
                        {tr("composer.queueHold")}
                      </span>
                      <button
                        type="button"
                        className="composer__queue-hold-retry"
                        onClick={() => sendQueue.resumeFlush()}
                      >
                        {tr("composer.queueHoldRetry")}
                      </button>
                    </div>
                  ) : null}
                  <ul className="composer__queue-list">
                    {sendQueue.activeQueue.map((item, idx) => (
                      <li key={item.id} className="composer__queue-item">
                        <span className="composer__queue-idx" aria-hidden>
                          {idx + 1}
                        </span>
                        <span
                          className="composer__queue-text"
                          title={queuePreviewText(
                            item.storedDisplay,
                            item.attachments,
                            200,
                            queuePreviewLabels,
                          )}
                        >
                          {queuePreviewText(
                            item.storedDisplay,
                            item.attachments,
                            72,
                            queuePreviewLabels,
                          )}
                        </span>
                        <button
                          type="button"
                          className="composer__queue-remove"
                          aria-label={tr("composer.queueRemove")}
                          onClick={() => sendQueue.removeItem(item.id)}
                        >
                          <IconClose size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {attachments.length > 0 && (
                <div
                  className="composer__attachments"
                  aria-label={tr("composer.attachCount", {
                    n: String(attachments.length),
                  })}
                >
                  {attachments.map((a) => (
                    <AttachmentCard
                      key={a.path}
                      attachment={a}
                      variant="chip"
                      labels={attachLabels}
                      galleryPaths={attachments
                        .filter((x) => !x.isDir && isImagePath(x.path))
                        .map((x) => x.path)}
                      onRemove={(att) =>
                        setAttachments((prev) =>
                          prev.filter((x) => x.path !== att.path),
                        )
                      }
                      onAddToComposer={(att) =>
                        setAttachments((prev) => mergeAttachments(prev, [att]))
                      }
                    />
                  ))}
                </div>
              )}
              {composerMenuOpen &&
                composerPlusPos &&
                typeof document !== "undefined" &&
                createPortal(
                  <ComposerPlusPanel
                    open
                    panelRef={composerPlusPanelRef}
                    locale={locale}
                    entries={composerMenuEntries}
                    filterQuery={
                      liveSlash.present ? slashFilterQuery : undefined
                    }
                    skillsLoading={skillsLoading}
                    activeIndex={slashActiveIndex}
                    onActiveIndexChange={setSlashActiveIndex}
                    onSelectUpload={() => {
                      void pickComposerFiles();
                    }}
                    onSelectSlash={applySlashItem}
                    resolveTitle={resolveSlashTitle}
                    resolveDescription={resolveSlashDescription}
                    style={{
                      ...composerPlusStyle,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              {atMenuOpen &&
                atAnchor.pos &&
                typeof document !== "undefined" &&
                createPortal(
                  <ComposerAtPanel
                    open
                    panelRef={composerAtPanelRef}
                    locale={locale}
                    items={atItems}
                    query={liveAt.query}
                    projectPath={resourceProjectPath}
                    loading={atLoading}
                    activeIndex={atActiveIndex}
                    onActiveIndexChange={setAtActiveIndex}
                    onPick={applyAtPick}
                    labels={{
                      search: tr("at.search"),
                      attachFile: tr("at.attachFile"),
                      attachFolder: tr("at.attachFolder"),
                      empty: tr("at.empty"),
                      noProject: tr("at.noProject"),
                      loading: tr("at.loading"),
                    }}
                    style={{
                      ...atAnchor.style,
                      zIndex: 10050,
                    }}
                  />,
                  document.body,
                )}
              <PiExtensionWidgets
                widgets={piWidgetsAbove}
                label={tr("pi.extensionWidget")}
              />
              <ComposerEditor
                editorRef={composerInputRef}
                className="composer__input"
                value={draft}
                disabled={!canType(session.state)}
                placeholder={
                  goalMode
                    ? tr("composer.goalPlaceholder")
                    : tr("composer.placeholder")
                }
                onChange={(next) => {
                  setDraft(next);
                  // Manual edit exits history browse; same text (DOM re-sync) keeps it.
                  const idx = promptHistoryIndexRef.current;
                  if (idx !== null) {
                    const hist = collectUserPromptHistory(messages);
                    if (next !== hist[idx]) {
                      promptHistoryIndexRef.current = null;
                      setPromptHistoryIndex(null);
                    }
                  }
                }}
                onPasteFiles={(files) => {
                  void addAttachmentsFromFiles(files);
                }}
                onPasteMediaFallback={(opts) => {
                  void pasteMediaFromNativeClipboard(opts);
                }}
                onSlashQueryChange={onSlashQueryChange}
                onKeyDown={(e) => {
                  if (
                    e.nativeEvent.isComposing ||
                    (e.nativeEvent as KeyboardEvent).keyCode === 229
                  ) {
                    return;
                  }
                  if (atMenuOpen) {
                    const flat = atItemsRef.current;
                    const n = flat.length;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (n) setAtActiveIndex((i) => (i + 1) % n);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (n) setAtActiveIndex((i) => (i - 1 + n) % n);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const item =
                        flat[
                          Math.min(
                            Math.max(0, atActiveIndex),
                            Math.max(0, n - 1),
                          )
                        ];
                      if (item) applyAtPick(item);
                      return;
                    }
                    if (e.key === "Tab" && n > 0) {
                      e.preventDefault();
                      const item =
                        flat[
                          Math.min(
                            Math.max(0, atActiveIndex),
                            Math.max(0, n - 1),
                          )
                        ]!;
                      applyAtPick(item);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeComposerMenu();
                      return;
                    }
                  }
                  if (composerMenuOpen) {
                    // Ref = same array the panel renders (never desync).
                    const flat = composerMenuEntriesRef.current;
                    const n = flat.length;
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (!n) return;
                      setSlashActiveIndex((i) => (i + 1) % n);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (!n) return;
                      setSlashActiveIndex((i) => (i - 1 + n) % n);
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const entry =
                        flat[
                          Math.min(
                            Math.max(0, slashActiveIndex),
                            Math.max(0, n - 1),
                          )
                        ];
                      if (!entry) return;
                      if (entry.kind === "upload") void pickComposerFiles();
                      else applySlashItem(entry.item);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      closeComposerMenu();
                      return;
                    }
                    if (e.key === "Tab" && n > 0) {
                      e.preventDefault();
                      const entry =
                        flat[
                          Math.min(
                            Math.max(0, slashActiveIndex),
                            n - 1,
                          )
                        ]!;
                      if (entry.kind === "upload") void pickComposerFiles();
                      else applySlashItem(entry.item);
                      return;
                    }
                  }
                  // CLI-like prompt history: ↑ on empty draft (or while browsing).
                  // Only when slash palette is closed so palette ↑/↓ is untouched.
                  if (
                    (e.key === "ArrowUp" || e.key === "ArrowDown") &&
                    !composerMenuOpen
                  ) {
                    const history = collectUserPromptHistory(messages);
                    const draftEmpty = isDraftEmpty(parseStoredContent(draft));
                    const browsing = promptHistoryIndexRef.current !== null;
                    if (
                      shouldHandlePromptHistoryKey({
                        key: e.key,
                        draftEmpty,
                        browsing,
                        historyLength: history.length,
                      })
                    ) {
                      e.preventDefault();
                      const step = stepPromptHistory(
                        history,
                        promptHistoryIndexRef.current,
                        e.key === "ArrowUp" ? "up" : "down",
                      );
                      promptHistoryIndexRef.current = step.index;
                      setPromptHistoryIndex(step.index);
                      setDraft(step.text);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    const hasBody =
                      !isDraftEmpty(parseStoredContent(draft)) ||
                      attachments.length > 0;
                    if (
                      hasBody &&
                      session.state !== "awaiting_permission"
                    ) {
                      void send();
                    }
                  }
                  if (e.key === "Escape") closeComposerMenu();
                }}
              />
              <PiExtensionWidgets
                widgets={piWidgetsBelow}
                label={tr("pi.extensionWidget")}
              />
              <div className="composer__row">
                <Tip label={tr("composer.add")}>
                  <button
                    ref={composerPlusTriggerRef}
                    type="button"
                    aria-label={tr("composer.add")}
                    className={
                      "icon-btn icon-btn--plus" +
                      (composerMenuOpen ? " is-open" : "")
                    }
                    onClick={() => {
                      if (composerMenuOpen) {
                        closeComposerMenu();
                      } else {
                        setShowComposerPlus(true);
                      }
                    }}
                  >
                    <IconPlus size={18} />
                  </button>
                </Tip>
                <ComposerApprovalsMenu
                  policy={policy}
                  onPolicy={applyPermissionPolicy}
                  onLearnMore={() => {
                    setSettingsSection("general");
                    setAppView("settings");
                  }}
                  labels={{
                    title: tr("approvals.title"),
                    learnMore: tr("approvals.learnMore"),
                    aria: tr("approvals.aria"),
                    ask: tr("approvals.ask"),
                    askDesc: tr("approvals.askDesc"),
                    acceptEdits: tr("approvals.acceptEdits"),
                    acceptEditsDesc: tr("approvals.acceptEditsDesc"),
                    session: tr("approvals.session"),
                    sessionDesc: tr("approvals.sessionDesc"),
                    dontAsk: tr("approvals.dontAsk"),
                    dontAskDesc: tr("approvals.dontAskDesc"),
                    full: tr("approvals.full"),
                    fullDesc: tr("approvals.fullDesc"),
                    shortAsk: tr("approvals.shortAsk"),
                    shortAccept: tr("approvals.shortAccept"),
                    shortSession: tr("approvals.shortSession"),
                    shortDontAsk: tr("approvals.shortDontAsk"),
                    shortFull: tr("approvals.shortFull"),
                  }}
                />
                {goalMode ? (
                  <Tip label={tr("composer.goalClear")}>
                    <button
                      type="button"
                      className="chip chip--goal"
                      onClick={() => setGoalMode(false)}
                      aria-label={tr("composer.goalClear")}
                      title={tr("composer.goalClear")}
                      data-testid="composer-goal-chip"
                    >
                      <IconImagine size={14} />
                      <span className="chip__label">
                        {tr("composer.goalActive")}
                      </span>
                      <IconClose size={12} aria-hidden />
                    </button>
                  </Tip>
                ) : null}
                <ComposerModelMenu
                  modelId={modelId}
                  effort={effort}
                  models={availableModels}
                  modelHealth={modelHealth}
                  labels={{
                    model: tr("composer.model"),
                    effort: tr("composer.effort"),
                    effortHigh: tr("effort.high"),
                    effortMedium: tr("effort.medium"),
                    effortLow: tr("effort.low"),
                    compare: tr("composer.compare"),
                    compareHint: tr("composer.compareHint"),
                    compareRun: tr("composer.compareRun"),
                    compareWorktrees: tr("composer.compareWorktrees"),
                    customProvider: tr("composer.customProvider"),
                  blocked: tr("composer.modelBlocked"),
                    healthLatency: tr("composer.healthLatency"),
                    healthFailure: tr("composer.healthFailure"),
                  }}
                  onModel={(v) => {
                    if (!isValidModelId(v, availableModels)) return;
                    setModelId(v);
                    const nextModel = findModel(v, availableModels);
                    if (!isValidEffort(effort, nextModel)) {
                      setEffort(pickDefaultEffort(nextModel));
                    }
                    void api
                      .composerPrefsSet({
                        projectId: activeProject?.id ?? null,
                        sessionId: session.sessionId ?? null,
                        modelId: v,
                        ...(!isValidEffort(effort, nextModel)
                          ? { effort: pickDefaultEffort(nextModel) }
                          : {}),
                      })
                      .catch((e) => showToast(String(e), 4000));
                  }}
                  onEffort={(v) => {
                    const model = findModel(modelId, availableModels);
                    if (!isValidEffort(v, model)) return;
                    setEffort(v);
                    void api
                      .composerPrefsSet({
                        projectId: activeProject?.id ?? null,
                        sessionId: session.sessionId ?? null,
                        effort: v,
                      })
                      .catch((e) => showToast(String(e), 4000));
                  }}
                  onCompare={(ids) => {
                    const prompt = draft.trim();
                    if (!prompt) {
                      showToast(tr("composer.compareEmpty"), 3500);
                      return;
                    }
                    setComparisonPair(null);
                    void batch.run(
                      ids.slice(0, 4).map((id) => ({
                        title: `${tr("composer.compareTitle")} · ${findModel(id, availableModels)?.label ?? id}`,
                        prompt,
                        modelId: id,
                      })),
                    );
                    setComparisonOpen(true);
                  }}
                  onCompareWorktrees={(ids) => {
                    const prompt = draft.trim();
                    if (!prompt) {
                      showToast(tr("composer.compareEmpty"), 3500);
                      return;
                    }
                    if (!activeProject?.path) {
                      showToast(tr("batch.worktreeNeedsProject"), 4500);
                      return;
                    }
                    setComparisonPair(null);
                    void batch.run(
                      ids.slice(0, 4).map((id) => ({
                        title: `${tr("composer.compareTitle")} · ${findModel(id, availableModels)?.label ?? id}`,
                        prompt,
                        modelId: id,
                        worktree: true,
                      })),
                      { worktree: true },
                    );
                    setComparisonOpen(true);
                  }}
                />
                <PromptCostPreview
                  modelId={modelId}
                  text={serializeForAgent(parseStoredContent(draft))}
                  attachmentRefs={attachments.map((attachment) => attachment.path)}
                  t={(key, vars) => tr(key as MessageKey, vars)}
                />
                <CacheChip
                  usage={sessionUsage}
                  viewedSessionId={session.sessionId ?? null}
                  labels={{
                    title: tr("cache.title"),
                    tipCold: tr("cache.tipCold"),
                    tipWarming: tr("cache.tipWarming"),
                    tipGood: tr("cache.tipGood"),
                    prompt: tr("cache.prompt"),
                    cached: tr("cache.cached"),
                    output: tr("cache.output"),
                    cost: tr("cache.cost"),
                  }}
                  breakHint={cacheBreakHint ?? undefined}
                />
                <ContextUsageChip
                  display={contextUsageDisplay}
                  labels={{
                    aria: tr("context.chipAria"),
                    tipUnknown: tr("context.chipTipUnknown"),
                    tipEstimated: tr("context.chipTipEstimated"),
                    tipKnown: tr("context.chipTipKnown"),
                    menuTitle: tr("context.menuTitle"),
                    current: tr("context.current"),
                    sourceKnown: tr("context.sourceKnown"),
                    sourceEstimated: tr("context.sourceEstimated"),
                    sourceUnknown: tr("context.sourceUnknown"),
                    lastCompact: tr("context.lastCompact"),
                    lastCompactNone: tr("context.lastCompactNone"),
                    tokensRange: tr("compact.tokensRange"),
                    compactAction: tr("context.compactAction"),
                    heuristicNote: tr("context.heuristicNote"),
                    auto: tr("context.triggerAuto"),
                    manual: tr("context.triggerManual"),
                    breakdownUser: tr("context.breakdownUser"),
                    breakdownAssistant: tr("context.breakdownAssistant"),
                    breakdownThought: tr("context.breakdownThought"),
                    breakdownEstimatedNote: tr(
                      "context.breakdownEstimatedNote",
                    ),
                    threshold: tr("context.threshold"),
                    thresholdReached: tr("context.thresholdReached"),
                  }}
                  thresholdPercent={compactionThresholdPercent}
                  onCompact={openCompactWithNote}
                />
                <span className="composer__spacer" />
                <Tip
                  label={
                    dictation.recording
                      ? tr("composer.voiceListening")
                      : dictation.phase === "transcribing"
                        ? tr("composer.voiceTranscribing")
                        : tr("composer.voice")
                  }
                >
                  <button
                    type="button"
                    className={
                      "icon-btn composer__voice" +
                      (dictation.recording
                        ? " composer__voice--live"
                        : dictation.busy
                          ? " composer__voice--busy"
                          : "")
                    }
                    disabled={
                      dictation.phase === "requesting" ||
                      dictation.phase === "transcribing" ||
                      !canType(session.state)
                    }
                    aria-label={
                      dictation.recording
                        ? tr("composer.voiceListening")
                        : dictation.phase === "transcribing"
                          ? tr("composer.voiceTranscribing")
                          : tr("composer.voice")
                    }
                    aria-pressed={dictation.recording}
                    onClick={() =>
                      dictation.recording
                        ? void dictation.stop()
                        : void dictation.start()
                    }
                  >
                    <IconMic size={16} />
                  </button>
                </Tip>
                {canStop(session.state) ? (
                  <>
                    {sendQueue.canShowQueueButton(
                      session.state,
                      connecting,
                      !isDraftEmpty(parseStoredContent(draft)) ||
                        attachments.length > 0,
                    ) && (
                      <Tip label={tr("composer.queue")}>
                        <button
                          type="button"
                          className="icon-btn icon-btn--primary"
                          onClick={() => void send()}
                          aria-label={tr("composer.queue")}
                        >
                          <IconQueue size={16} />
                        </button>
                      </Tip>
                    )}
                    <Tip label={tr("composer.stop")}>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={() => void stop()}
                        aria-label={tr("composer.stop")}
                      >
                        <IconStop size={14} />
                      </button>
                    </Tip>
                  </>
                ) : (
                  <Tip label={tr("composer.send")}>
                    <button
                      type="button"
                      className="icon-btn icon-btn--primary"
                      disabled={
                        (!canSend(session.state) &&
                          !shouldEnqueueSend(session.state, connecting)) ||
                        (isDraftEmpty(parseStoredContent(draft)) &&
                          attachments.length === 0) ||
                        session.state === "awaiting_permission"
                      }
                      onClick={() => void send()}
                      aria-label={tr("composer.send")}
                    >
                      <IconSend size={16} />
                    </button>
                  </Tip>
                )}
              </div>
            </div>
          </div>
          </div>
          </>
          )}
        </main>

        {/* RIGHT — session-linked project resource viewer (fully hideable + resizable) */}
        <aside
          className={
            (layout.asideCollapsed ? "aside aside--hidden" : "aside") +
            (resizingAside ? " is-resizing" : "")
          }
          aria-hidden={layout.asideCollapsed}
          style={
            !layout.asideCollapsed
              ? {
                  width: layout.asideWidth,
                  minWidth: layout.asideWidth,
                  maxWidth: layout.asideWidth,
                }
              : undefined
          }
        >
          {!layout.asideCollapsed && (
            <div
              className="aside-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize files pane"
              onPointerDown={(e) => {
                e.preventDefault();
                setResizingAside(true);
              }}
            />
          )}
          <div className="aside__inner">
            <ResourceViewer
              projectId={activeProject?.id ?? null}
              sessionId={session.sessionId ?? null}
              projectPath={resourceProjectPath}
              projectName={activeProject?.name ?? (remoteRuntime.enabled ? remoteRuntime.cwd : null)}
              remoteRuntime={remoteRuntime.enabled}
              locale={locale}
              paneActive={!layout.asideCollapsed}
              openRequest={resourceOpenTarget}
              onOpenRequestConsumed={() => setResourceOpenTarget(null)}
              sessionChanges={
                sessionChangesById[session.sessionId || ""] ?? []
              }
              sessionMessages={messages}
              plan={plan}
              planFocusKey={planFocusKey}
              onApprovePlan={() => void approvePlan()}
              onRequestPlanChanges={() => void requestPlanChanges()}
              onDismissPlan={() => void dismissPlan()}
              onClose={() =>
                setLayout((l) => {
                  const n = { ...l, asideCollapsed: true };
                  saveLayout(localStorage, n);
                  return n;
                })
              }
            />
          </div>
        </aside>
      </div>
      ))}

      <DoctorModal
        open={showDoctor}
        onClose={() => setShowDoctor(false)}
        locale={locale}
        onConfirm={({ title, message, confirmLabel, danger, onConfirm }) => {
          setAppDialog({
            kind: "confirm",
            title,
            message,
            confirmLabel,
            danger,
            onConfirm,
          });
        }}
        onResetDone={() => {
          void refreshLists();
        }}
      />
      <GlassModal
        open={wt.create.open}
        onClose={() => {
          if (wt.create.busy) return;
          wt.create.close();
        }}
        title={
          wt.create.startChat
            ? tr("composer.worktreeNewChatTitle")
            : tr("composer.worktreeNewTitle")
        }
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!wt.create.busy}
        showClose={!wt.create.busy}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={wt.create.busy}
              onClick={() => wt.create.close()}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={wt.create.busy || !wt.create.name.trim()}
              onClick={() => {
                void wt.create.submit();
              }}
            >
              {wt.create.busy
                ? tr("composer.worktreeCreating")
                : wt.create.startChat
                  ? tr("composer.worktreeCreateChat")
                  : tr("composer.worktreeCreate")}
            </button>
          </>
        }
      >
        <form
          className="wt-create"
          onSubmit={(e) => {
            e.preventDefault();
            if (wt.create.busy) return;
            void wt.create.submit();
          }}
        >
          <p className="wt-create__hint">
            {wt.create.startChat
              ? tr("composer.worktreeNewChatHint")
              : tr("composer.worktreeNewHint")}
          </p>
          <label className="wt-create__field">
            <span className="wt-create__label">
              {tr("composer.worktreeName")}
            </span>
            <input
              className="settings-input"
              value={wt.create.name}
              onChange={(e) => {
                wt.create.setName(e.target.value);
              }}
              placeholder={tr("composer.worktreeNamePlaceholder")}
              autoComplete="off"
              autoFocus
              disabled={wt.create.busy}
              spellCheck={false}
            />
          </label>
          <label className="wt-create__field">
            <span className="wt-create__label">
              {tr("composer.worktreeRef")}
            </span>
            <input
              className="settings-input"
              value={wt.create.startPoint}
              onChange={(e) => {
                wt.create.setStartPoint(e.target.value);
              }}
              placeholder={tr("composer.worktreeRefPlaceholder")}
              autoComplete="off"
              disabled={wt.create.busy}
              spellCheck={false}
            />
          </label>
          {wt.create.previewPath ? (
            <p className="wt-create__preview">
              {tr("composer.worktreePathPreview", {
                path: wt.create.previewPath,
              })}
            </p>
          ) : null}
          {wt.create.error ? (
            <p className="wt-create__error" role="alert">
              {wt.create.error}
            </p>
          ) : null}
        </form>
      </GlassModal>
      <GlassModal
        open={wt.gc.open}
        onClose={() => {
          if (wt.gc.busy) return;
          wt.gc.close();
        }}
        title={tr("composer.worktreeGcTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!wt.gc.busy}
        showClose={!wt.gc.busy}
        wrapBody
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={wt.gc.busy}
              onClick={() => {
                wt.gc.close();
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={wt.gc.busy || wt.gc.previewBusy}
              onClick={() => {
                void wt.gc.submit();
              }}
            >
              {wt.gc.busy
                ? tr("composer.worktreeGcRunning")
                : tr("composer.worktreeGcConfirm")}
            </button>
          </>
        }
      >
        <div className="wt-gc">
          <p className="wt-gc__hint">{tr("composer.worktreeGcHint")}</p>
          <label className="wt-gc__force">
            <input
              type="checkbox"
              checked={wt.gc.force}
              disabled={wt.gc.busy || wt.gc.previewBusy}
              onChange={(e) => wt.gc.setForce(e.target.checked)}
            />
            <span>{tr("composer.worktreeGcForce")}</span>
          </label>
          <div className="wt-gc__preview-head">{tr("composer.worktreeGcPreview")}</div>
          {wt.gc.previewBusy ? (
            <p className="wt-gc__preview-status">
              {tr("composer.worktreeGcPreviewLoading")}
            </p>
          ) : wt.gc.preview ? (
            <>
              {(wt.gc.preview.prunable?.length ?? 0) > 0 ? (
                <p className="wt-gc__prunable">
                  {tr("composer.worktreeGcPrunable", {
                    n: String(wt.gc.preview.prunable?.length ?? 0),
                  })}
                </p>
              ) : null}
              {(wt.gc.preview.output ?? "").trim() ||
              (wt.gc.preview.prunable?.length ?? 0) > 0 ? (
                <pre className="wt-gc__output" tabIndex={0}>
                  {(wt.gc.preview.output ?? "").trim() ||
                    (Array.isArray(wt.gc.preview.prunable)
                      ? wt.gc.preview.prunable.join("\n")
                      : "")}
                </pre>
              ) : (
                <p className="wt-gc__preview-status">
                  {tr("composer.worktreeGcPreviewEmpty")}
                </p>
              )}
            </>
          ) : wt.gc.error ? null : (
            <p className="wt-gc__preview-status">
              {tr("composer.worktreeGcPreviewEmpty")}
            </p>
          )}
          {wt.gc.error ? (
            <p className="wt-gc__error" role="alert">
              {wt.gc.error}
            </p>
          ) : null}
        </div>
      </GlassModal>
      <GlassModal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        title={tr("shortcuts.title")}
        size="md"
        closeLabel={tr("shortcuts.close")}
        footer={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setShowShortcuts(false)}
          >
            {tr("shortcuts.close")}
          </button>
        }
      >
        <ul className="shortcuts-list">
          {shortcutsForPlatform(
            platform === "mac" ? "mac" : platform === "win" ? "win" : "other",
          ).map((row) => (
            <li key={row.id} className="shortcuts-list__row">
              <span className="shortcuts-list__label">
                {tr(row.labelKey as MessageKey)}
              </span>
              <kbd className="shortcuts-list__keys">{row.keys}</kbd>
            </li>
          ))}
        </ul>
      </GlassModal>
      <AskUserModal
        payload={askUser}
        labels={{
          title: tr("askUser.title"),
          submit: tr("askUser.submit"),
          cancel: tr("askUser.cancel"),
          otherPlaceholder: tr("askUser.otherPlaceholder"),
          freeTextHint: tr("askUser.freeTextHint"),
          multiHint: tr("askUser.multiHint"),
          close: tr("common.close"),
        }}
        onSubmit={async (answers) => {
          if (!askUser) return;
          try {
            await api.sessionResolveAskUser({
              decision: "accepted",
              answers,
              rpcId: askUser.rpcId,
            });
            setAskUser(null);
          } catch (e) {
            showToast(String(e), 4500);
          }
        }}
        onCancel={async () => {
          if (!askUser) return;
          try {
            await api.sessionResolveAskUser({
              decision: "cancelled",
              rpcId: askUser.rpcId,
            });
          } catch {
            /* still hide UI */
          }
          setAskUser(null);
        }}
      />
      <StatusModal
        open={showStatusModal}
        locale={locale}
        sessionId={session.sessionId}
        agentSessionId={session.agentSessionId}
        modelId={modelId}
        effort={effort}
        mode={mode}
        policy={policy}
        projectPath={resourceProjectPath}
        messageCount={messages.length}
        onClose={() => setShowStatusModal(false)}
      />
      {rewindTimeline && (
        <div
          className="overlay"
          role="presentation"
          onClick={() => {
            if (!rewindBusy) setRewindTimeline(null);
          }}
        >
          <div
            className="modal rewind-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rewind-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-head">
              <h2 id="rewind-modal-title" className="modal-title">
                {tr("session.rewindTitle")}
              </h2>
              <button
                type="button"
                className="icon-btn modal-close"
                onClick={() => setRewindTimeline(null)}
                aria-label={tr("common.close")}
                disabled={rewindBusy}
              >
                <IconClose size={16} />
              </button>
            </header>
            <p className="rewind-modal__msg">{tr("session.rewindHint")}</p>
            <div className="rewind-modal__list" role="list">
              {rewindTimeline.points.map((p) => {
                const isLast =
                  p.promptIndex ===
                  rewindTimeline.points[rewindTimeline.points.length - 1]
                    ?.promptIndex;
                return (
                  <button
                    key={`${p.promptIndex}-${p.messageId ?? ""}`}
                    type="button"
                    role="listitem"
                    className="rewind-modal__item"
                    disabled={rewindBusy || isLast}
                    title={
                      isLast
                        ? tr("session.rewindNoop")
                        : tr("message.rewindHere")
                    }
                    onClick={() => {
                      if (isLast) {
                        showToast(tr("session.rewindNoop"));
                        return;
                      }
                      confirmRewindToPrompt(
                        rewindTimeline.sessionId,
                        p.promptIndex,
                        p.preview,
                      );
                    }}
                  >
                    <span className="rewind-modal__idx">
                      #{p.promptIndex + 1}
                    </span>
                    <span className="rewind-modal__preview">
                      {p.preview || "…"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={rewindBusy}
                onClick={() => setRewindTimeline(null)}
              >
                {tr("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <GlassModal
        open={!!rewindConfirm}
        onClose={() => {
          if (rewindBusy) return;
          setRewindConfirm(null);
          setRewindRestoreFiles(false);
        }}
        title={tr("session.rewindTitle")}
        size="sm"
        closeLabel={tr("common.close")}
        closeOnOverlay={!rewindBusy}
        showClose={!rewindBusy}
        wrapBody
        className="rewind-confirm-modal"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={rewindBusy}
              onClick={() => {
                setRewindConfirm(null);
                setRewindRestoreFiles(false);
              }}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={rewindBusy || !rewindConfirm}
              onClick={() => {
                if (!rewindConfirm) return;
                void runRewindToPrompt(
                  rewindConfirm.sessionId,
                  rewindConfirm.targetPromptIndex,
                  rewindRestoreFiles,
                );
              }}
            >
              {tr("session.rewindConfirmLabel")}
            </button>
          </>
        }
      >
        <div className="rewind-confirm">
          <p className="rewind-confirm__msg">
            {tr("session.rewindConfirm")}
            {rewindConfirm?.preview
              ? `\n\n“${rewindConfirm.preview}”`
              : ""}
          </p>
          <label className="rewind-confirm__restore">
            <input
              type="checkbox"
              checked={rewindRestoreFiles}
              disabled={rewindBusy}
              onChange={(e) => setRewindRestoreFiles(e.target.checked)}
            />
            <span>{tr("session.rewindRestoreFiles")}</span>
          </label>
          <p className="rewind-confirm__hint">
            {tr("session.rewindRestoreFilesHint")}
          </p>
        </div>
      </GlassModal>

      {showCompactModal && (
        <div
          className="overlay"
          role="presentation"
          onClick={() => {
            setShowCompactModal(false);
            setCompactNote("");
          }}
        >
          <form
            className="modal compact-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="compact-modal-title"
            onSubmit={(e) => {
              e.preventDefault();
              const note = compactNote;
              setShowCompactModal(false);
              setCompactNote("");
              void (async () => {
                const cmd = note.trim()
                  ? `/compact ${note.trim()}`
                  : "/compact";
                try {
                  const sid = await ensureConnected();
                  if (!sid) return;
                  await api.sessionSend(cmd, null, null, sid);
                } catch (err) {
                  setLocalError(String(err));
                }
              })();
            }}
          >
            <header className="modal-head">
              <h2 id="compact-modal-title" className="modal-title">
                {tr("slash.compact")}
              </h2>
              <button
                type="button"
                className="icon-btn modal-close"
                onClick={() => {
                  setShowCompactModal(false);
                  setCompactNote("");
                }}
                aria-label={tr("common.close")}
              >
                <IconClose size={16} />
              </button>
            </header>
            <p className="compact-modal__msg">
              {tr("slash.compactConfirm")}
            </p>
            <input
              ref={compactNoteRef}
              className="compact-modal__field"
              value={compactNote}
              onChange={(e) => setCompactNote(e.target.value)}
              placeholder={tr("slash.compactNote")}
              autoFocus
              autoComplete="off"
            />
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setShowCompactModal(false);
                  setCompactNote("");
                }}
              >
                {tr("slash.compactConfirmCancel")}
              </button>
              <button type="submit" className="btn btn--solid">
                {tr("slash.compactConfirmOk")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search / command palette (Codex-style) */}
      {showSearch && (
        <div
          className="overlay"
          onClick={() => setShowSearch(false)}
        >
          <div
            className="search-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={tr("sidebar.search")}
          >
            <div className="search-panel__head">
              <IconSearch size={16} />
              <input
                autoFocus
                className="search-panel__input"
                placeholder={
                  tr("search.placeholder")
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button
                type="button"
                className="icon-btn modal-close"
                onClick={() => setShowSearch(false)}
                aria-label={tr("common.close")}
              >
                <IconClose size={16} />
              </button>
            </div>
            {!searchQuery.trim().startsWith(">") ? (
              <div className="search-panel__filters">
                <select value={searchModelFilter} onChange={(event) => setSearchModelFilter(event.target.value)} aria-label={tr("search.filterModel")}>
                  <option value="">{tr("search.allModels")}</option>
                  {availableModels.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}
                </select>
                <select value={searchProjectFilter} onChange={(event) => setSearchProjectFilter(event.target.value)} aria-label={tr("search.filterProject")}>
                  <option value="">{tr("search.allProjects")}</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </div>
            ) : null}
            {searchQuery.trim().startsWith(">") ? (
              <>
                <div className="search-panel__section">{tr("palette.title")}</div>
                {paletteCommands.map((command) => (
                  <button
                    type="button"
                    className="search-panel__row"
                    key={command.id}
                    onClick={command.run}
                  >
                    <IconSearch size={15} />
                    <span className="search-panel__title">{command.label}</span>
                  </button>
                ))}
                {paletteCommands.length === 0 ? (
                  <div className="sidebar-empty" style={{ padding: 12 }}>
                    {tr("search.noMatches")}
                  </div>
                ) : null}
              </>
            ) : (
            <>
            {searchHits.matchedProjects.length > 0 && (
              <>
                <div className="search-panel__section">
                  {tr("sidebar.projects")}
                </div>
                {searchHits.matchedProjects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="search-panel__row"
                    onClick={() => {
                      setShowSearch(false);
                      // Project is a folder: expand only; selection is for sessions.
                      setProjectsOpen(true);
                      setExpandedProjects((e) => ({ ...e, [p.id]: true }));
                    }}
                  >
                    <IconFolder size={15} />
                    <span className="search-panel__title">{p.name}</span>
                    <span className="search-panel__meta">{p.path}</span>
                  </button>
                ))}
              </>
            )}
            <div className="search-panel__section">
              {tr("search.chats")}
              {contentSearchLoading && searchQuery.trim()
                ? ` · ${tr("search.searchingContent")}`
                : null}
            </div>
            {filteredSessionHits.length === 0 && !contentSearchLoading && (
              <div className="sidebar-empty" style={{ padding: 12 }}>
                {tr("search.noMatches")}
              </div>
            )}
            {filteredSessionHits.map((hit, i) => {
              const s = sessions.find((x) => x.id === hit.id);
              // Content-only hits may lack a live row if the list is stale; still open by id.
              const row: SessionRow = s ?? {
                id: hit.id,
                title: hit.title,
                projectId: hit.projectId ?? null,
                updatedAt: "",
              };
              const proj = projects.find(
                (p) => p.id === (row.projectId ?? hit.projectId),
              );
              const metaParts: string[] = [];
              if (proj?.name) metaParts.push(proj.name);
              if (hit.contentMatch && hit.matchCount && hit.matchCount > 0) {
                metaParts.push(
                  tr("search.matchCount", { n: String(hit.matchCount) }),
                );
              }
              if (i < 9) metaParts.push(`⌘${i + 1}`);
              return (
                <button
                  key={hit.id}
                  type="button"
                  className="search-panel__row"
                  onClick={() => {
                    setShowSearch(false);
                    void openSession(row, proj ?? null);
                  }}
                >
                  <IconSquarePen size={15} />
                  <span className="search-panel__body">
                    <span className="search-panel__title">
                      {hit.title || s?.title || "Untitled"}
                    </span>
                    {hit.snippet ? (
                      <span className="search-panel__snippet">
                        {hit.snippet}
                      </span>
                    ) : null}
                  </span>
                  <span className="search-panel__meta">
                    {metaParts.join(" · ") || "—"}
                  </span>
                </button>
              );
            })}
            <div className="search-panel__foot">
              <button
                type="button"
                className="search-panel__row"
                onClick={() => {
                  setShowSearch(false);
                  void newChat(activeProject);
                }}
              >
                <IconSquarePen size={15} />
                <span className="search-panel__title">
                  {tr("search.newChat")}
                </span>
              </button>
              <button
                type="button"
                className="search-panel__row"
                onClick={() => {
                  setShowSearch(false);
                  void addProject(false);
                }}
              >
                <IconFolder size={15} />
                <span className="search-panel__title">
                  {tr("sidebar.addProject")}
                </span>
              </button>
            </div>
            </>
            )}
          </div>
        </div>
      )}

      {/* In-app confirm / prompt (Tauri WebView has no reliable window.prompt/confirm) */}
      {appDialog &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="overlay app-dialog-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setAppDialog(null);
            }}
          >
            <div
              className="modal app-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="app-dialog-title"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header className="modal-head">
                <h2 id="app-dialog-title" className="modal-title">
                  {appDialog.title}
                </h2>
                <button
                  type="button"
                  className="icon-btn modal-close"
                  onClick={() => setAppDialog(null)}
                  aria-label={tr("common.close")}
                >
                  <IconClose size={16} />
                </button>
              </header>
              {appDialog.kind === "confirm" ? (
                <form
                  className="app-dialog__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    // Prefer the keyboard path's latest ref so chained
                    // dialogs (YOLO step1 → step2) stay consistent.
                    const dialog = appDialogRef.current;
                    if (!dialog || dialog.kind !== "confirm") return;
                    const run = dialog.onConfirm;
                    setAppDialog(null);
                    void run();
                  }}
                >
                  <p className="app-dialog__msg">{appDialog.message}</p>
                  <div className="app-dialog__actions modal-actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setAppDialog(null)}
                    >
                      {tr("common.cancel")}
                    </button>
                    <button
                      ref={confirmBtnRef}
                      type="submit"
                      className={`btn ${appDialog.danger ? "btn--danger" : "btn--solid"}`}
                    >
                      {appDialog.confirmLabel || tr("common.confirm")}
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  className="app-dialog__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = dialogInput;
                    const submit = appDialog.onSubmit;
                    setAppDialog(null);
                    void submit(value);
                  }}
                >
                  {appDialog.message ? (
                    <p className="app-dialog__msg">{appDialog.message}</p>
                  ) : null}
                  <input
                    ref={dialogInputRef}
                    className="app-dialog__input"
                    value={dialogInput}
                    placeholder={appDialog.placeholder}
                    onChange={(e) => setDialogInput(e.target.value)}
                    autoComplete="off"
                  />
                  <div className="app-dialog__actions modal-actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setAppDialog(null)}
                    >
                      {tr("common.cancel")}
                    </button>
                    <button type="submit" className="btn btn--solid">
                      {appDialog.submitLabel || tr("common.save")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* Floating context menu (project / session) — unified ContextMenu */}
      {(() => {
        let items: ContextMenuItem[] = [];
        if (ctxMenu?.kind === "project") {
          const proj = projects.find((p) => p.id === ctxMenu.id);
          if (proj) {
            items = [
              {
                id: "pin",
                label: proj.pinned
                  ? tr("project.unpin")
                  : tr("project.pin"),
                icon: proj.pinned ? (
                  <IconPinOff size={16} />
                ) : (
                  <IconPin size={16} />
                ),
                onClick: () => {
                  void api
                    .projectSetPinned(proj.id, !proj.pinned)
                    .then(() => refreshProjects());
                },
              },
              {
                id: "reveal",
                label: tr("project.reveal"),
                icon: <IconExternalLink size={16} />,
                onClick: () => {
                  void api
                    .projectReveal(proj.id)
                    .catch((e) => setLocalError(String(e)));
                },
              },
              {
                id: "relocate",
                label: tr("project.relocate"),
                icon: <IconFolderPlus size={16} />,
                onClick: () => {
                  void relocateProject(proj);
                },
              },
              {
                id: "rename",
                label: tr("project.rename"),
                icon: <IconRename size={16} />,
                onClick: () => renameProject(proj),
              },
              {
                id: "archive-chats",
                label: tr("project.archiveChats"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void archiveProjectSessions(proj);
                },
              },
              {
                id: "remove",
                label: tr("project.remove"),
                icon: <IconTrash size={16} />,
                danger: true,
                onClick: () => removeProjectFromApp(proj),
              },
            ];
          }
        } else if (ctxMenu?.kind === "project-policy") {
          const proj = projects.find((p) => p.id === ctxMenu.id);
          if (proj && proj.trusted) {
            const current = proj.permissionPolicy?.trim() || null;
            const policyLabel = (id: PermissionPolicyId) =>
              tr(
                (
                  {
                    ask: "policy.ask",
                    accept_edits: "policy.accept_edits",
                    allow_for_session: "policy.allow_for_session",
                    dont_ask: "policy.dont_ask",
                    always_approve: "policy.always_approve",
                  } as const
                )[id],
              );
            items = [
              {
                id: "inherit",
                label: tr("project.permissionInherit"),
                icon: !current ? <IconCheck size={16} /> : undefined,
                onClick: () => applyProjectPermissionPolicy(proj, null),
              },
              ...PERMISSION_POLICIES.map(
                (p) =>
                  ({
                    id: `policy-${p.id}`,
                    label: policyLabel(p.id),
                    icon:
                      current === p.id ? <IconCheck size={16} /> : undefined,
                    danger: !!p.dangerous,
                    onClick: () => applyProjectPermissionPolicy(proj, p.id),
                  }) satisfies ContextMenuItem,
              ),
            ];
          }
        } else if (ctxMenu?.kind === "session") {
          const s = sessions.find((x) => x.id === ctxMenu.id);
          if (s) {
            const isOpen =
              session.sessionId === s.id ||
              viewingSessionIdRef.current === s.id;
            items = [
              {
                id: "pin",
                label: s.pinned ? tr("session.unpin") : tr("session.pin"),
                icon: s.pinned ? (
                  <IconPinOff size={16} />
                ) : (
                  <IconPin size={16} />
                ),
                onClick: () => {
                  void pinSession(s, !s.pinned);
                },
              },
              {
                id: "rename",
                label: tr("session.rename"),
                icon: <IconRename size={16} />,
                onClick: () => renameSession(s),
              },
              {
                id: "export-md",
                label: tr("session.exportMd"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void exportActiveSessionMd({
                    id: s.id,
                    title: s.title,
                    projectId: s.projectId,
                  });
                },
              },
              {
                id: "export-bundle",
                label: tr("session.exportBundle"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void exportSessionDiagnostic(s.id);
                },
              },
              {
                id: "handoff",
                label: tr("session.handoff"),
                icon: <IconFork size={16} />,
                disabled: !isOpen || !canRewindSession,
                onClick: () => openHandoffDialog(s),
              },
              {
                id: "fork",
                label: tr("session.fork"),
                icon: <IconFork size={16} />,
                onClick: () => confirmForkSession(s),
              },
              {
                id: "compare",
                label:
                  comparisonSelection === s.id
                    ? tr("session.compareSelectionClear")
                    : comparisonSelection
                      ? tr("session.compareWithSelected")
                      : tr("session.compareSelect"),
                icon: <IconPanel size={16} />,
                onClick: () => {
                  if (comparisonSelection === s.id) {
                    setComparisonSelection(null);
                    return;
                  }
                  if (comparisonSelection) {
                    setComparisonPair([comparisonSelection, s.id]);
                    setComparisonSelection(null);
                    setComparisonOpen(true);
                    return;
                  }
                  setComparisonSelection(s.id);
                  showToast(
                    tr("session.compareSelected", {
                      name: s.title || tr("session.untitled"),
                    }),
                    3600,
                  );
                },
              },
              {
                id: "rewind",
                label: tr("session.rewind"),
                icon: <IconRewind size={16} />,
                disabled: !isOpen || !canRewindSession,
                onClick: () => {
                  void openRewindTimeline(s.id);
                },
              },
              {
                id: "copy-id",
                label: tr("session.copyId"),
                icon: <IconCopy size={16} />,
                onClick: () => {
                  void copySessionId(s);
                },
              },
              {
                id: "archive",
                label: s.archived
                  ? tr("sidebar.unarchive")
                  : tr("sidebar.archive"),
                icon: <IconArchive size={16} />,
                onClick: () => {
                  void archiveSession(s, !s.archived);
                },
              },
              {
                id: "delete",
                label: tr("session.delete"),
                icon: <IconTrash size={16} />,
                danger: true,
                onClick: () => deleteSessionConfirm(s),
              },
            ];
          }
        }
        return (
          <ContextMenu
            open={!!ctxMenu && items.length > 0}
            x={ctxMenu?.x ?? 0}
            y={ctxMenu?.y ?? 0}
            onClose={() => setCtxMenu(null)}
            items={items}
            estimatedHeight={
              ctxMenu?.kind === "project-policy" ? 280 : 240
            }
          />
        );
      })()}

      <span hidden data-layout-default={JSON.stringify(DEFAULT_LAYOUT)} />
    </div>
    </ImageViewerProvider>
  );
}
