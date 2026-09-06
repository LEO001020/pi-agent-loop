/**
 * Full-page settings shell (ChatGPT-desktop style): left nav + content.
 * Back control returns to the workbench.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Select } from "@/components/Select";
import {
  IconArchive,
  IconActivity,
  IconAppearance,
  IconArrowLeft,
  IconCheck,
  IconDoctor,
  IconInfo,
  IconInstructions,
  IconKeyboard,
  IconMinimize,
  IconMic,
  IconPuzzle,
  IconSkills,
  IconSearch,
  IconShare,
  IconSettings,
  IconShield,
  IconTrash,
} from "@/components/icons";
import {
  detectShortcutPlatform,
  shortcutsByGroup,
  type ShortcutGroup,
} from "@/lib/shortcuts";
import type { Theme } from "@/lib/theme";
import {
  DEFAULT_WALLPAPER_SCRIM,
  THEME_SKINS,
  WALLPAPER_ACCEPT,
  WallpaperPrepareError,
  prepareWallpaperFromFile,
  type ThemeSkinId,
  type WallpaperKind,
  type WallpaperRecord,
} from "@/lib/themeSkin";
import type {
  ComposerPrefsScope,
  ModelOption,
  PermissionPolicyId,
} from "@/lib/agentCatalog";
import {
  COMPOSER_PREFS_SCOPES,
  PERMISSION_POLICIES,
} from "@/lib/agentCatalog";
import type { DetectedEditor } from "@/lib/api";
import * as api from "@/lib/api";
import { ExtensionsPanel } from "@/components/ExtensionsPanel";
import { SkillsPanel } from "@/components/SkillsPanel";
import { PiExtensionsPanel } from "@/components/PiExtensionsPanel";
import { ProvidersPanel } from "@/components/ProvidersPanel";
import { ProviderConnectionsPanel } from "@/components/ProviderConnectionsPanel";
import { ProjectInspectPanel } from "@/components/ProjectInspectPanel";
import { PermissionRulesPanel } from "@/components/PermissionRulesPanel";
import { ContextSettingsPanel } from "@/components/ContextSettingsPanel";
import { UsageProfilePage } from "@/components/UsageProfilePage";
import { SpeechSettingsPanel } from "@/components/SpeechSettingsPanel";
import { GlassModal } from "@/components/GlassModal";
import {
  createT,
  resolveLocale,
  type MessageKey,
  type Vars,
} from "@/i18n";

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "context"
  | "usage"
  | "speech"
  | "archived"
  | "providers-models"
  | "extensions"
  | "skills"
  | "runtime"
  | "shortcuts"
  | "about";

export type ArchivedSessionRow = {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
};

export type ArchivedProjectGroup = {
  id: string | null;
  name: string;
  sessions: ArchivedSessionRow[];
};

export interface SettingsPageProps {
  section: SettingsSectionId;
  onSection: (id: SettingsSectionId) => void;
  onBack: () => void;
  labels: Record<string, string>;
  locale: string;
  theme: Theme;
  onTheme: (v: Theme) => void;
  userName?: string;
  onUserName?: (value: string) => void;
  /** Color skin pack on top of light/dark (optional for older callers). */
  skin?: ThemeSkinId;
  onSkin?: (v: ThemeSkinId) => void;
  /** Active built-in or custom wallpaper URL. */
  wallpaperUrl?: string | null;
  /** Kind of the current wallpaper, to pick <video> vs <img> in the preview. */
  wallpaperKind?: WallpaperKind | null;
  /** Whether the current wallpaper came from a user upload. */
  wallpaperIsCustom?: boolean;
  onWallpaper?: (record: WallpaperRecord | null) => void | Promise<void>;
  /** Wallpaper scrim strength 0–100 (only the dimming overlay; not chrome). */
  wallpaperScrim?: number;
  onWallpaperScrim?: (value: number) => void;
  sessionDataMode: string;
  onSessionDataMode: (v: string) => void;
  /** After importing CLI sessions (shared mode) — refresh sidebar. */
  onCliSessionsImported?: () => void;
  policy: string;
  onPolicy: (v: PermissionPolicyId) => void;
  /** Where model / permission choices are remembered. */
  prefsScope?: ComposerPrefsScope | string;
  onPrefsScope?: (v: ComposerPrefsScope) => void;
  /** Live valid models (for display only in settings). */
  availableModels?: ModelOption[];
  /** Stable routing roles such as fast/deep/review. */
  modelRoles?: Record<string, string>;
  onModelRoles?: (value: Record<string, string>) => void;
  /** Optional transient fallbacks, ordered after each role's primary model. */
  fallbackChains?: Record<string, string[]>;
  onFallbackChains?: (value: Record<string, string[]>) => void;
  budgetMonthlyByTier?: Record<string, number>;
  budgetSessionByTier?: Record<string, number>;
  onBudgetChange?: (monthly: Record<string, number>, session: Record<string, number>) => void;
  compactionThresholdPercent?: number;
  onCompactionThresholdPercent?: (value: number) => void;
  manualCliPath: string;
  onManualCliPath: (v: string) => void;
  onCliBlur: (v: string) => void;
  /** API mode: remote ACP server `host:port` (empty = local CLI spawn). */
  acpServerAddr: string;
  onAcpServerAddr: (v: string) => void;
  remoteRuntime: api.RemoteRuntimeSettings;
  onRemoteRuntime: (value: api.RemoteRuntimeSettings) => void;
  /** Max warm/live agent processes (I02). */
  maxConcurrentAgents?: number;
  onMaxConcurrentAgents?: (v: number) => void;
  /** Idle recycle minutes (I03). */
  agentIdleMinutes?: number;
  onAgentIdleMinutes?: (v: number) => void;
  /** Stream stall silence timeout seconds (I06). */
  streamStallSeconds?: number;
  onStreamStallSeconds?: (v: number) => void;
  /** Cap agent turns per process (`pi --max-turns`). 0/undefined = unlimited. */
  maxAgentTurns?: number;
  onMaxAgentTurns?: (v: number) => void;
  /** Preferred agent definition name for spawn (`""` = CLI default). */
  preferredAgent?: string;
  onPreferredAgent?: (v: string) => void;
  /** Catalog rows for preferred-agent select. */
  agentCatalog?: Array<{ name: string; source: string }>;
  /** Cross-session memory toggle. */
  experimentalMemory?: boolean;
  onExperimentalMemory?: (v: boolean) => void;
  disableWebSearch?: boolean;
  onDisableWebSearch?: (v: boolean) => void;
  reopenLastSession?: boolean;
  onReopenLastSession?: (v: boolean) => void;
  planEnabled?: boolean;
  onPlanEnabled?: (v: boolean) => void;
  subagentsEnabled?: boolean;
  onSubagentsEnabled?: (v: boolean) => void;
  useLeader?: boolean;
  onUseLeader?: (v: boolean) => void;
  /** Store App API keys in OS keychain (default off → secrets.json). */
  storeApiKeysInKeychain?: boolean;
  onStoreApiKeysInKeychain?: (v: boolean) => void;
  crashReportingEnabled?: boolean;
  onCrashReportingEnabled?: (v: boolean) => void;
  /** OS sandbox for agent spawn: off | workspace | read-only | strict | devbox. */
  sandboxProfile?: string;
  onSandboxProfile?: (v: string) => void;
  cliInfo: {
    found: boolean;
    path: string | null;
    version: string | null;
    source: string;
    cliAuthPresent: boolean;
  };
  onDoctor: () => void;
  versionFooter: string;
  /** Default open target: finder | editor id */
  defaultOpenTarget?: string;
  onDefaultOpenTarget?: (v: string) => void;
  /** Archived chats grouped by project (settings → archived). */
  archivedGroups?: ArchivedProjectGroup[];
  /** Restore one or more archived sessions (ids). */
  onRestoreArchivedSessions?: (ids: string[]) => void;
  /** Delete one or more archived sessions after confirm (ids). */
  onDeleteArchivedSessions?: (ids: string[]) => void;
  /** Active project path for Skills/MCP inspect cwd. */
  projectPath?: string | null;
  /** Start a focused chat that can find, configure, or build a Pi capability. */
  onAskPiForCapability?: (request?: string) => void;
  /** Reconnect the active Pi process after changing its provider route. */
  onProviderActivated?: () => void;
  /** After skill enable toggle — refresh slash palette in App. */
  onSkillsPrefsChanged?: () => void;
  /** Open the same shortcuts help modal as ⌘/ / Ctrl+/. */
  onOpenShortcutsHelp?: () => void;
}

const NAV: {
  id: SettingsSectionId;
  icon:
    | "settings"
    | "appearance"
    | "context"
    | "usage"
    | "speech"
    | "archive"
    | "providers"
    | "extensions"
    | "skills"
    | "doctor"
    | "keyboard"
    | "info";
  labelKey: string;
  group: "personal" | "system";
}[] = [
  { id: "general", icon: "settings", labelKey: "settings.nav.general", group: "personal" },
  { id: "appearance", icon: "appearance", labelKey: "settings.nav.appearance", group: "personal" },
  { id: "context", icon: "context", labelKey: "settings.nav.context", group: "personal" },
  { id: "usage", icon: "usage", labelKey: "settings.nav.usage", group: "personal" },
  { id: "speech", icon: "speech", labelKey: "settings.nav.speech", group: "personal" },
  { id: "archived", icon: "archive", labelKey: "settings.nav.archived", group: "personal" },
  {
    id: "providers-models",
    icon: "providers",
    labelKey: "settings.nav.providersModels",
    group: "system",
  },
  {
    id: "extensions",
    icon: "extensions",
    labelKey: "settings.nav.extensions",
    group: "system",
  },
  {
    id: "skills",
    icon: "skills",
    labelKey: "settings.nav.skills",
    group: "system",
  },
  { id: "runtime", icon: "doctor", labelKey: "settings.nav.runtime", group: "system" },
  {
    id: "shortcuts",
    icon: "keyboard",
    labelKey: "settings.nav.shortcuts",
    group: "system",
  },
  { id: "about", icon: "info", labelKey: "settings.nav.about", group: "system" },
];

function NavIcon({
  name,
  size = 18,
}: {
  name: (typeof NAV)[number]["icon"];
  size?: number;
}) {
  if (name === "appearance") return <IconAppearance size={size} />;
  if (name === "context") return <IconInstructions size={size} />;
  if (name === "usage") return <IconActivity size={size} />;
  if (name === "speech") return <IconMic size={size} />;
  if (name === "archive") return <IconArchive size={size} />;
  if (name === "providers") return <IconShare size={size} />;
  if (name === "keyboard") return <IconKeyboard size={size} />;
  if (name === "extensions") return <IconPuzzle size={size} />;
  if (name === "skills") return <IconSkills size={size} />;
  if (name === "doctor") return <IconDoctor size={size} />;
  if (name === "info") return <IconInfo size={size} />;
  return <IconSettings size={size} />;
}

function formatSessionWhen(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * ACP API-mode field with Test + server-side setup one-liner (from PR #23).
 * Remote agents may run anywhere — verify reachability instead of auto-start.
 */
function AcpServerField({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  t: (k: string, vars?: Vars) => string;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<api.AcpProbeResult | null>(null);
  const [copied, setCopied] = useState(false);
  const addr = value.trim();
  const port = (addr.split(":")[1] || "").replace(/[^0-9]/g, "") || "8799";
  const setupCmd = `socat TCP-LISTEN:${port},reuseaddr,fork EXEC:'pi agent --no-leader stdio'`;

  const runTest = async () => {
    if (!addr || !api.isTauri()) return;
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.acpTestConnection(addr));
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };
  const copyCmd = async () => {
    try {
      await navigator.clipboard.writeText(setupCmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.acpServer")}</div>
        <div className="settings-row__desc">{t("settings.acpServerDesc")}</div>
      </div>
      <div className="settings-acp-field">
        <input
          className="settings-input"
          value={value}
          placeholder="e.g. 127.0.0.1:8799"
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!addr || testing}
          onClick={() => void runTest()}
        >
          {testing ? t("settings.acpTesting") : t("settings.acpTest")}
        </button>
      </div>
      {result ? (
        <div
          className={
            "settings-row__hint" + (result.ok ? "" : " is-danger")
          }
        >
          {result.ok
            ? t("settings.acpTestOk", {
                version: result.agentVersion || "?",
                model: result.model || "?",
              })
            : t("settings.acpTestFail", {
                error: result.error || "unknown",
              })}
        </div>
      ) : null}
      {addr ? (
        <div className="settings-row__hint">
          <div>{t("settings.acpSetupHint")}</div>
          <code className="settings-acp-cmd">{setupCmd}</code>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void copyCmd()}
          >
            {copied ? t("message.copied") : t("message.copy")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function RemoteRuntimePanel({
  value,
  onSave,
  t,
}: {
  value: api.RemoteRuntimeSettings;
  onSave: (value: api.RemoteRuntimeSettings) => void;
  t: (key: string, vars?: Vars) => string;
}) {
  const [draft, setDraft] = useState(value);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<api.RemoteRuntimeProbe | null>(null);
  const [saved, setSaved] = useState(false);
  const [directToken, setDirectToken] = useState("");

  useEffect(() => {
    setDraft(value);
    setDirectToken("");
  }, [value]);

  const update = <K extends keyof api.RemoteRuntimeSettings>(
    key: K,
    next: api.RemoteRuntimeSettings[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: next, verified: false }));
    setSaved(false);
    setResult(null);
  };

  const updateToken = (next: string) => {
    setDirectToken(next);
    setDraft((current) => ({
      ...current,
      verified: false,
      directTokenConfigured: next.trim()
        ? true
        : current.directTokenConfigured,
    }));
    setSaved(false);
    setResult(null);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const probe =
        draft.transport === "direct"
          ? await api.remoteDirectTest(draft, directToken)
          : await api.remoteRuntimeTest(draft);
      setResult(probe);
      if (probe.ok) {
        setDraft((current) => ({ ...current, verified: true }));
      }
    } catch (error) {
      setResult({ ok: false, error: String(error) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    try {
      if (draft.transport === "direct" && directToken.trim()) {
        await api.remoteRuntimeTokenSet(directToken);
      }
      onSave({
        ...draft,
        directTokenConfigured:
          draft.transport === "direct"
            ? draft.directTokenConfigured || !!directToken.trim()
            : draft.directTokenConfigured,
      });
      setDirectToken("");
      setSaved(true);
    } catch (error) {
      setResult({ ok: false, error: String(error) });
    }
  };

  return (
    <div className="settings-card remote-runtime">
      <div className="settings-row">
        <div className="settings-row__text">
          <div className="settings-row__label">{t("remoteRuntime.title")}</div>
          <div className="settings-row__desc">{t("remoteRuntime.description")}</div>
        </div>
        <UiCheck
          checked={draft.enabled}
          onChange={() => update("enabled", !draft.enabled)}
          ariaLabel={t("remoteRuntime.enable")}
        />
      </div>
      <label className="remote-runtime__transport">
        <span>{t("remoteRuntime.transport")}</span>
        <select
          className="settings-input"
          value={draft.transport}
          onChange={(event) =>
            update("transport", event.target.value as "ssh" | "direct")
          }
        >
          <option value="ssh">{t("remoteRuntime.transportSsh")}</option>
          <option value="direct">{t("remoteRuntime.transportDirect")}</option>
        </select>
      </label>
      <div className="remote-runtime__fields">
        {draft.transport === "direct" ? (
          <>
            <label>
              <span>{t("remoteRuntime.directUrl")}</span>
              <input
                className="settings-input"
                type="url"
                value={draft.directUrl}
                onChange={(event) => update("directUrl", event.target.value)}
                placeholder={t("remoteRuntime.directUrlPlaceholder")}
                spellCheck={false}
              />
            </label>
            <label>
              <span>{t("remoteRuntime.directToken")}</span>
              <input
                className="settings-input"
                type="password"
                value={directToken}
                onChange={(event) => updateToken(event.target.value)}
                placeholder={
                  draft.directTokenConfigured
                    ? t("remoteRuntime.directTokenStored")
                    : t("remoteRuntime.directTokenPlaceholder")
                }
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              <span>{t("remoteRuntime.cwd")}</span>
              <input
                className="settings-input"
                value={draft.cwd}
                onChange={(event) => update("cwd", event.target.value)}
                placeholder={t("remoteRuntime.cwdPlaceholder")}
                spellCheck={false}
              />
            </label>
          </>
        ) : (
          <>
        <label>
          <span>{t("remoteRuntime.host")}</span>
          <input
            className="settings-input"
            value={draft.host}
            onChange={(event) => update("host", event.target.value)}
            placeholder={t("remoteRuntime.hostPlaceholder")}
            spellCheck={false}
          />
        </label>
        <label>
          <span>{t("remoteRuntime.user")}</span>
          <input
            className="settings-input"
            value={draft.user}
            onChange={(event) => update("user", event.target.value)}
            placeholder={t("remoteRuntime.userPlaceholder")}
            spellCheck={false}
          />
        </label>
        <label>
          <span>{t("remoteRuntime.port")}</span>
          <input
            className="settings-input"
            type="number"
            min={1}
            max={65535}
            value={draft.port}
            onChange={(event) =>
              update("port", Math.min(65535, Math.max(1, Number(event.target.value) || 22)))
            }
          />
        </label>
        <label>
          <span>{t("remoteRuntime.cwd")}</span>
          <input
            className="settings-input"
            value={draft.cwd}
            onChange={(event) => update("cwd", event.target.value)}
            placeholder={t("remoteRuntime.cwdPlaceholder")}
            spellCheck={false}
          />
        </label>
        <label>
          <span>{t("remoteRuntime.piPath")}</span>
          <input
            className="settings-input"
            value={draft.piPath}
            onChange={(event) => update("piPath", event.target.value)}
            placeholder={t("remoteRuntime.piPathPlaceholder")}
            spellCheck={false}
          />
        </label>
        <label>
          <span>{t("remoteRuntime.identity")}</span>
          <input
            className="settings-input"
            value={draft.identityFile}
            onChange={(event) => update("identityFile", event.target.value)}
            placeholder={t("remoteRuntime.identityPlaceholder")}
            spellCheck={false}
          />
        </label>
          </>
        )}
      </div>
      <p className="settings-row__hint">
        {t(
          draft.transport === "direct"
            ? "remoteRuntime.directSecurity"
            : "remoteRuntime.security",
        )}
      </p>
      <p className="settings-row__hint">{t("remoteRuntime.scope")}</p>
      {result ? (
        <p
          className={"settings-row__hint" + (result.ok ? " is-success" : " is-danger")}
          role="status"
        >
          {result.ok
            ? t("remoteRuntime.testOk", { version: result.version || "Pi" })
            : t("remoteRuntime.testFail", { error: result.error || "Unknown error" })}
        </p>
      ) : null}
      <div className="remote-runtime__actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={
            testing ||
            (draft.transport === "direct"
              ? !draft.directUrl.trim() ||
                (!directToken.trim() && !draft.directTokenConfigured) ||
                !draft.cwd.trim()
              : !draft.host.trim() || !draft.user.trim())
          }
          onClick={() => void test()}
        >
          {testing ? t("remoteRuntime.testing") : t("remoteRuntime.test")}
        </button>
        <button
          type="button"
          className="btn btn--solid"
          disabled={draft.enabled && !draft.verified}
          onClick={() => void save()}
        >
          {saved ? t("remoteRuntime.saved") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

/** App-styled checkbox (no native OS control). */
function UiCheck({
  checked,
  indeterminate = false,
  onChange,
  label,
  ariaLabel,
  className = "",
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label?: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const on = indeterminate || checked;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      className={
        "ui-check" +
        (checked && !indeterminate ? " is-on" : "") +
        (indeterminate ? " is-mixed" : "") +
        (className ? ` ${className}` : "")
      }
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onChange();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="ui-check__box" aria-hidden>
        {indeterminate ? (
          <IconMinimize size={12} stroke={2.4} />
        ) : on ? (
          <IconCheck size={12} stroke={2.4} />
        ) : null}
      </span>
      {label != null ? <span className="ui-check__label">{label}</span> : null}
    </button>
  );
}

type MarqueeBox = { x0: number; y0: number; x1: number; y1: number };

function marqueeClientRect(m: MarqueeBox) {
  const left = Math.min(m.x0, m.x1);
  const top = Math.min(m.y0, m.y1);
  const right = Math.max(m.x0, m.x1);
  const bottom = Math.max(m.y0, m.y1);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: DOMRect,
): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

export function SettingsPage({
  section,
  onSection,
  onBack,
  labels: _legacyLabels,
  locale,
  theme,
  onTheme,
  userName = "",
  onUserName,
  skin = "default",
  onSkin,
  wallpaperUrl = null,
  wallpaperKind = null,
  wallpaperIsCustom = false,
  wallpaperScrim = DEFAULT_WALLPAPER_SCRIM,
  onWallpaperScrim,
  onWallpaper,
  sessionDataMode,
  onSessionDataMode,
  onCliSessionsImported,
  policy,
  onPolicy,
  prefsScope = "global",
  onPrefsScope,
  availableModels = [],
  modelRoles = {},
  onModelRoles,
  fallbackChains = {},
  onFallbackChains,
  budgetMonthlyByTier = {},
  budgetSessionByTier = {},
  onBudgetChange,
  compactionThresholdPercent = 85,
  onCompactionThresholdPercent,
  manualCliPath,
  onManualCliPath,
  onCliBlur,
  acpServerAddr,
  onAcpServerAddr,
  remoteRuntime,
  onRemoteRuntime,
  maxConcurrentAgents = 3,
  onMaxConcurrentAgents,
  agentIdleMinutes = 30,
  onAgentIdleMinutes,
  streamStallSeconds = 120,
  onStreamStallSeconds,
  storeApiKeysInKeychain = false,
  onStoreApiKeysInKeychain,
  crashReportingEnabled = false,
  onCrashReportingEnabled,
  sandboxProfile = "off",
  onSandboxProfile,
  maxAgentTurns = 0,
  onMaxAgentTurns,
  preferredAgent = "",
  onPreferredAgent,
  agentCatalog = [],
  experimentalMemory = false,
  onExperimentalMemory,
  subagentsEnabled = true,
  onSubagentsEnabled,
  planEnabled = true,
  onPlanEnabled,
  disableWebSearch = false,
  onDisableWebSearch,
  useLeader = false,
  onUseLeader,
  reopenLastSession = true,
  onReopenLastSession,
  cliInfo,
  onDoctor,
  versionFooter,
  defaultOpenTarget = "finder",
  onDefaultOpenTarget,
  archivedGroups = [],
  onRestoreArchivedSessions,
  onDeleteArchivedSessions,
  projectPath = null,
  onAskPiForCapability,
  onProviderActivated,
  onSkillsPrefsChanged,
  onOpenShortcutsHelp,
}: SettingsPageProps) {
  const [query, setQuery] = useState("");
  const roleNames = ["fast", "deep", "cheap", "review", "local"] as const;
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [clearMemoryOpen, setClearMemoryOpen] = useState(false);
  const [clearMemoryBusy, setClearMemoryBusy] = useState(false);
  const [settingsToast, setSettingsToast] = useState<string | null>(null);
  /** Selected archived session ids (settings → archived multi-select). */
  const [archivedSelected, setArchivedSelected] = useState<Set<string>>(
    () => new Set(),
  );
  /** Rubber-band marquee (client coords) while dragging on the list surface. */
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const archivedSurfaceRef = useRef<HTMLDivElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const marqueeRef = useRef<{
    active: boolean;
    dragging: boolean;
    additive: boolean;
    base: Set<string>;
    box: MarqueeBox;
    pointerId: number;
  } | null>(null);
  // Full catalog via createT — do not depend on App's partial `labels` whitelist
  // (missing keys used to render raw "settings.acpServer" etc.).
  const tr = useMemo(() => createT(resolveLocale(locale)), [locale]);
  const t = useCallback(
    (k: string, vars?: Vars) => tr(k as MessageKey, vars),
    [tr],
  );

  const workspaceCwd = (projectPath || "").trim() || null;
  const showSettingsToast = useCallback((msg: string, ms = 3500) => {
    setSettingsToast(msg);
    window.setTimeout(() => setSettingsToast(null), ms);
  }, []);
  const runClearWorkspaceMemory = useCallback(async () => {
    if (!workspaceCwd || clearMemoryBusy) return;
    setClearMemoryBusy(true);
    try {
      await api.memoryClear({ cwd: workspaceCwd, scope: "workspace" });
      setClearMemoryOpen(false);
      showSettingsToast(t("settings.clearWorkspaceMemoryDone"), 3500);
    } catch (e) {
      showSettingsToast(String(e), 4500);
    } finally {
      setClearMemoryBusy(false);
    }
  }, [workspaceCwd, clearMemoryBusy, showSettingsToast, t]);

  const wallpaperErrorMessage = useCallback(
    (err: unknown): string => {
      if (err instanceof WallpaperPrepareError) {
        const key = `settings.wallpaper.err.${err.code}` as MessageKey;
        const msg = t(key);
        return msg === key ? t("settings.wallpaper.err.generic") : msg;
      }
      return t("settings.wallpaper.err.generic");
    },
    [t],
  );

  const onWallpaperFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file || !onWallpaper) return;
      setWallpaperBusy(true);
      setWallpaperError(null);
      try {
        const record = await prepareWallpaperFromFile(file);
        await onWallpaper(record);
      } catch (e) {
        setWallpaperError(wallpaperErrorMessage(e));
      } finally {
        setWallpaperBusy(false);
        if (wallpaperInputRef.current) wallpaperInputRef.current.value = "";
      }
    },
    [onWallpaper, wallpaperErrorMessage],
  );

  useEffect(() => {
    if (!api.isTauri()) return;
    void api.editorsList().then((r) => setEditors(r.editors ?? [])).catch(() => {});
  }, []);

  const nav = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV;
    return NAV.filter((n) => t(n.labelKey).toLowerCase().includes(q));
  }, [query, t]);

  const archivedAllIds = useMemo(
    () => archivedGroups.flatMap((g) => g.sessions.map((s) => s.id)),
    [archivedGroups],
  );

  const archivedTotal = archivedAllIds.length;

  // Drop stale selection when list changes (restore/delete/refresh).
  useEffect(() => {
    setArchivedSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(archivedAllIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [archivedAllIds]);

  const archivedSelectedCount = archivedSelected.size;
  const archivedAllSelected =
    archivedTotal > 0 && archivedSelectedCount === archivedTotal;
  const archivedSomeSelected =
    archivedSelectedCount > 0 && !archivedAllSelected;

  const toggleArchivedId = (id: string) => {
    setArchivedSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleArchivedAll = () => {
    if (archivedAllSelected) {
      setArchivedSelected(new Set());
    } else {
      setArchivedSelected(new Set(archivedAllIds));
    }
  };

  const toggleArchivedGroup = (ids: string[]) => {
    setArchivedSelected((prev) => {
      const next = new Set(prev);
      const allOn = ids.length > 0 && ids.every((id) => next.has(id));
      if (allOn) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  };

  const collectMarqueeHits = useCallback((box: MarqueeBox): string[] => {
    const root = archivedSurfaceRef.current;
    if (!root) return [];
    const r = marqueeClientRect(box);
    // Ignore tiny jitter before true drag.
    if (r.width < 4 && r.height < 4) return [];
    const hits: string[] = [];
    root.querySelectorAll<HTMLElement>("[data-archived-id]").forEach((el) => {
      const id = el.dataset.archivedId;
      if (!id) return;
      if (rectsOverlap(r, el.getBoundingClientRect())) hits.push(id);
    });
    return hits;
  }, []);

  const applyMarqueeSelection = useCallback(
    (box: MarqueeBox, additive: boolean, base: Set<string>) => {
      const hits = collectMarqueeHits(box);
      if (hits.length === 0 && !additive) {
        // Still dragging — keep empty if not additive.
        setArchivedSelected(new Set());
        return;
      }
      if (additive) {
        const next = new Set(base);
        for (const id of hits) next.add(id);
        setArchivedSelected(next);
      } else {
        setArchivedSelected(new Set(hits));
      }
    },
    [collectMarqueeHits],
  );

  const onArchivedPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Don't start marquee from action controls / custom checks.
    if (
      target.closest("button") ||
      target.closest("a") ||
      target.closest(".ui-check") ||
      target.closest(".settings-archived-toolbar")
    ) {
      return;
    }
    const additive = e.metaKey || e.ctrlKey || e.shiftKey;
    const box: MarqueeBox = {
      x0: e.clientX,
      y0: e.clientY,
      x1: e.clientX,
      y1: e.clientY,
    };
    marqueeRef.current = {
      active: true,
      dragging: false,
      additive,
      base: new Set(archivedSelected),
      box,
      pointerId: e.pointerId,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onArchivedPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = marqueeRef.current;
    if (!st?.active || st.pointerId !== e.pointerId) return;
    const box: MarqueeBox = {
      ...st.box,
      x1: e.clientX,
      y1: e.clientY,
    };
    st.box = box;
    const r = marqueeClientRect(box);
    if (!st.dragging && (r.width > 5 || r.height > 5)) {
      st.dragging = true;
      setMarquee(box);
    }
    if (st.dragging) {
      setMarquee(box);
      applyMarqueeSelection(box, st.additive, st.base);
    }
  };

  const onArchivedPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = marqueeRef.current;
    if (!st?.active || st.pointerId !== e.pointerId) return;
    marqueeRef.current = null;
    setMarquee(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (st.dragging) {
      applyMarqueeSelection(st.box, st.additive, st.base);
      return;
    }
    // Click without drag: toggle row under pointer (if any).
    const el = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-archived-id]",
    );
    const id = el?.dataset.archivedId;
    if (id) toggleArchivedId(id);
  };

  const onArchivedPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = marqueeRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    marqueeRef.current = null;
    setMarquee(null);
  };

  const title =
    section === "general"
      ? t("settings.nav.general")
      : section === "appearance"
        ? t("settings.nav.appearance")
        : section === "context"
          ? t("settings.nav.context")
          : section === "usage"
            ? t("settings.nav.usage")
          : section === "speech"
            ? t("settings.nav.speech")
          : section === "archived"
            ? t("settings.nav.archived")
            : section === "providers-models"
              ? t("settings.nav.providersModels")
            : section === "extensions"
              ? t("settings.nav.extensions")
              : section === "skills"
                ? t("settings.nav.skills")
              : section === "runtime"
                ? t("settings.nav.runtime")
                : section === "shortcuts"
                  ? t("settings.nav.shortcuts")
                  : t("settings.nav.about");

  const modelGroups = Array.from(
    (availableModels ?? []).reduce((groups, model) => {
      const slash = model.id.indexOf("/");
      const provider =
        slash > 0
          ? model.id.slice(0, slash)
          : model.source?.trim() || "pi";
      const current = groups.get(provider) ?? [];
      current.push(model);
      groups.set(provider, current);
      return groups;
    }, new Map<string, ModelOption[]>()),
  ).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="settings-page" data-testid="settings-page">
      {/* Full-width overlay drag band (does not break glass nav continuity) */}
      <div
        className="settings-page__chrome"
        data-tauri-drag-region
        aria-hidden
        onDoubleClick={() => {
          void import("@tauri-apps/api/window")
            .then(({ getCurrentWindow }) => getCurrentWindow().toggleMaximize())
            .catch(() => {});
        }}
      />
      <aside className="settings-page__nav">
        <div className="settings-page__nav-inner">
        <button
          type="button"
          className="settings-page__back"
          onClick={onBack}
        >
          <IconArrowLeft size={16} />
          <span className="settings-page__nav-label">
            {t("settings.backToApp")}
          </span>
        </button>

        <div className="settings-page__search">
          <IconSearch size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("settings.searchPlaceholder")}
          />
        </div>

        <div className="settings-page__group-label">
          {t("settings.group.personal")}
        </div>
        {nav
          .filter((n) => n.group === "personal")
          .map((n) => (
            <button
              key={n.id}
              type="button"
              className={
                "settings-page__nav-item" +
                (section === n.id ? " is-active" : "")
              }
              onClick={() => onSection(n.id)}
            >
              <NavIcon name={n.icon} />
              <span className="settings-page__nav-label">
                {t(n.labelKey)}
              </span>
            </button>
          ))}

        <div className="settings-page__group-label">
          {t("settings.group.system")}
        </div>
        {nav
          .filter((n) => n.group === "system")
          .map((n) => (
            <button
              key={n.id}
              type="button"
              className={
                "settings-page__nav-item" +
                (section === n.id ? " is-active" : "")
              }
              onClick={() => onSection(n.id)}
            >
              <NavIcon name={n.icon} />
              <span className="settings-page__nav-label">
                {t(n.labelKey)}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <div className="settings-page__content">
      <main className="settings-page__main">
        <h1 className="settings-page__title">{title}</h1>

        {section === "general" && (
          <div className="settings-section pi-home">
            <div className="settings-card pi-home__lead">
              <h2 className="settings-page__h2">{t("piHome.title")}</h2>
              <p>{t("piHome.description")}</p>
              <p className="settings-row__desc">{t("piHome.runtime")}</p>
            </div>
            <div className="settings-card pi-home__principle">
              <p>{t("piHome.philosophy")}</p>
              <button
                type="button"
                className="btn btn--solid"
                onClick={() => onSection("extensions")}
              >
                {t("piHome.openExtensions")}
              </button>
            </div>
          </div>
        )}

        {section === "context" && (
          <>
            <ContextSettingsPanel t={t} />
            <div className="settings-card budget-settings">
              <h2 className="settings-page__h2">{t("budget.title")}</h2>
              <p className="settings-row__desc">{t("budget.description")}</p>
              <div className="budget-settings__grid">
                {(["cheap", "default", "premium", "local"] as const).map((tier) => (
                  <div className="budget-settings__row" key={tier}>
                    <strong>{t(`budget.tier.${tier}`)}</strong>
                    <label>
                      <span>{t("budget.monthly")}</span>
                      <input
                        className="settings-input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={budgetMonthlyByTier[tier] ?? ""}
                        placeholder={t("budget.unlimited")}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          const next = { ...budgetMonthlyByTier };
                          if (Number.isFinite(value) && value > 0) next[tier] = value;
                          else delete next[tier];
                          onBudgetChange?.(next, budgetSessionByTier);
                        }}
                      />
                    </label>
                    <label>
                      <span>{t("budget.session")}</span>
                      <input
                        className="settings-input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={budgetSessionByTier[tier] ?? ""}
                        placeholder={t("budget.unlimited")}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          const next = { ...budgetSessionByTier };
                          if (Number.isFinite(value) && value > 0) next[tier] = value;
                          else delete next[tier];
                          onBudgetChange?.(budgetMonthlyByTier, next);
                        }}
                      />
                    </label>
                  </div>
                ))}
              </div>
              <label className="settings-row settings-row--stack">
                <span className="settings-row__label">{t("budget.compaction")}</span>
                <span className="settings-row__desc">{t("budget.compactionDescription")}</span>
                <input
                  className="settings-input"
                  type="number"
                  min={50}
                  max={98}
                  value={compactionThresholdPercent}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) onCompactionThresholdPercent?.(Math.min(98, Math.max(50, Math.round(value))));
                  }}
                />
              </label>
            </div>
          </>
        )}
        {section === "usage" && onUserName && (
          <UsageProfilePage
            t={t}
            userName={userName}
            onUserName={onUserName}
          />
        )}
        {section === "speech" && <SpeechSettingsPanel t={t} />}

        {section === "general" && (
          <div hidden>
            <h2 className="settings-page__h2">{t("settings.section.composer")}</h2>
            <div className="settings-card">
              {onPrefsScope && (
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.prefsScope")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.prefsScopeDesc")}
                    </div>
                  </div>
                  <Select
                    value={prefsScope}
                    onChange={(v) => onPrefsScope(v as ComposerPrefsScope)}
                    options={COMPOSER_PREFS_SCOPES.map((s) => ({
                      value: s,
                      label: t(
                        (
                          {
                            global: "settings.prefsScope.global",
                            project: "settings.prefsScope.project",
                            session: "settings.prefsScope.session",
                          } as const
                        )[s],
                      ),
                    }))}
                  />
                </div>
              )}
              <div className="settings-row settings-row--stack">
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.availableModels")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.availableModelsDesc")}
                  </div>
                </div>
                <div className="settings-models-list" role="list">
                  {availableModels.length === 0 ? (
                    <span className="settings-row__desc">
                      {t("settings.availableModelsEmpty")}
                    </span>
                  ) : (
                    availableModels.map((m) => (
                      <div
                        key={m.id}
                        className="settings-models-list__item"
                        role="listitem"
                      >
                        <span className="settings-models-list__name">
                          {m.label}
                        </span>
                        <span className="settings-models-list__id">{m.id}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <h2 className="settings-page__h2">{t("settings.section.permissions")}</h2>
            <div className="settings-card">
              <div className="settings-row settings-row--stack">
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    <IconShield size={16} />
                    {t("settings.permissionDeep")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.permissionDeepDesc")}
                  </div>
                </div>
                <Select
                  value={policy}
                  onChange={(v) => onPolicy(v as PermissionPolicyId)}
                  options={PERMISSION_POLICIES.map((p) => ({
                    value: p.id,
                    label: t(
                      (
                        {
                          ask: "policy.ask",
                          accept_edits: "policy.accept_edits",
                          allow_for_session: "policy.allow_for_session",
                          dont_ask: "policy.dont_ask",
                          always_approve: "policy.always_approve",
                        } as const
                      )[p.id],
                    ),
                  }))}
                />
              </div>
              {onSandboxProfile ? (
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.sandboxProfile")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.sandboxProfileDesc")}
                    </div>
                  </div>
                  <Select
                    value={sandboxProfile || "off"}
                    onChange={(v) => onSandboxProfile(v)}
                    options={[
                      {
                        value: "off",
                        label: t("settings.sandbox.off"),
                      },
                      {
                        value: "workspace",
                        label: t("settings.sandbox.workspace"),
                      },
                      {
                        value: "read-only",
                        label: t("settings.sandbox.readOnly"),
                      },
                      {
                        value: "strict",
                        label: t("settings.sandbox.strict"),
                      },
                      {
                        value: "devbox",
                        label: t("settings.sandbox.devbox"),
                      },
                    ]}
                  />
                </div>
              ) : null}
              <PermissionRulesPanel t={t} />
            </div>

                        <h2 className="settings-page__h2">{t("settings.section.agent")}</h2>
            <div className="settings-card" id="settings-agent-card">
              {onMaxAgentTurns ? (
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.maxAgentTurns")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.maxAgentTurnsDesc")}
                    </div>
                  </div>
                  <input
                    className="settings-input"
                    type="number"
                    min={0}
                    max={200}
                    step={1}
                    placeholder={t("settings.maxAgentTurnsPlaceholder")}
                    value={maxAgentTurns > 0 ? maxAgentTurns : ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) {
                        onMaxAgentTurns(0);
                        return;
                      }
                      const n = Number(raw);
                      if (!Number.isFinite(n)) return;
                      onMaxAgentTurns(Math.min(200, Math.max(0, Math.round(n))));
                    }}
                  />
                </div>
              ) : null}
              {onPreferredAgent ? (
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.preferredAgent")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.preferredAgentDesc")}
                    </div>
                  </div>
                  <Select
                    value={preferredAgent || ""}
                    onChange={(v) => onPreferredAgent(v)}
                    options={[
                      {
                        value: "",
                        label: t("settings.preferredAgent.default"),
                      },
                      ...agentCatalog.map((a) => {
                        const srcKey = (
                          {
                            builtin: "settings.preferredAgent.source.builtin",
                            bundled: "settings.preferredAgent.source.bundled",
                            user: "settings.preferredAgent.source.user",
                            project: "settings.preferredAgent.source.project",
                          } as const
                        )[a.source as "builtin" | "bundled" | "user" | "project"];
                        const srcLabel = srcKey ? t(srcKey) : a.source || "other";
                        return {
                          value: a.name,
                          label: `${a.name} · ${srcLabel}`,
                        };
                      }),
                    ]}
                  />
                </div>
              ) : null}
              {onExperimentalMemory ? (
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.experimentalMemory")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.experimentalMemoryDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!experimentalMemory}
                    onChange={() => onExperimentalMemory(!experimentalMemory)}
                    ariaLabel={t("settings.experimentalMemory")}
                  />
                </div>
              ) : null}
              {onSubagentsEnabled ? (
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.subagentsEnabled")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.subagentsEnabledDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!subagentsEnabled}
                    onChange={() => onSubagentsEnabled(!subagentsEnabled)}
                    ariaLabel={t("settings.subagentsEnabled")}
                  />
                </div>
              ) : null}
              {onPlanEnabled ? (
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.planEnabled")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.planEnabledDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!planEnabled}
                    onChange={() => onPlanEnabled(!planEnabled)}
                    ariaLabel={t("settings.planEnabled")}
                  />
                </div>
              ) : null}
              {onDisableWebSearch ? (
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.disableWebSearch")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.disableWebSearchDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!disableWebSearch}
                    onChange={() => onDisableWebSearch(!disableWebSearch)}
                    ariaLabel={t("settings.disableWebSearch")}
                  />
                </div>
              ) : null}
              {onUseLeader ? (
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.useLeader")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.useLeaderDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!useLeader}
                    onChange={() => onUseLeader(!useLeader)}
                    ariaLabel={t("settings.useLeader")}
                  />
                </div>
              ) : null}
            </div>


<h2 className="settings-page__h2">{t("settings.section.general")}</h2>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    {t("settings.sessionDataMode")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.sessionDataModeDesc")}
                  </div>
                </div>
                <Select
                  value={sessionDataMode}
                  onChange={onSessionDataMode}
                  options={[
                    {
                      value: "independent",
                      label: t("settings.modeIndependent"),
                    },
                    { value: "shared", label: t("settings.modeShared") },
                  ]}
                />
              </div>
              {sessionDataMode === "shared" ? (
                <CliSessionsPanel
                  t={t}
                  onImported={onCliSessionsImported}
                />
              ) : null}
              {onStoreApiKeysInKeychain ? (
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.storeApiKeysInKeychain")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.storeApiKeysInKeychainDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={storeApiKeysInKeychain}
                    onChange={() =>
                      onStoreApiKeysInKeychain(!storeApiKeysInKeychain)
                    }
                    ariaLabel={t("settings.storeApiKeysInKeychain")}
                  />
                </div>
              ) : null}
              {onCrashReportingEnabled ? (
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.crashReporting")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.crashReportingDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={crashReportingEnabled}
                    onChange={() => onCrashReportingEnabled(!crashReportingEnabled)}
                    ariaLabel={t("settings.crashReporting")}
                  />
                </div>
              ) : null}
              {workspaceCwd ? (
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.clearWorkspaceMemory")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.clearWorkspaceMemoryDesc")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn--ghost btn--danger settings-row__action"
                    disabled={clearMemoryBusy}
                    onClick={() => setClearMemoryOpen(true)}
                  >
                    {clearMemoryBusy
                      ? t("settings.clearWorkspaceMemoryBusy")
                      : t("settings.clearWorkspaceMemory")}
                  </button>
                </div>
              ) : null}
              {onReopenLastSession ? (
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.reopenLastSession")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.reopenLastSessionDesc")}
                    </div>
                  </div>
                  <UiCheck
                    checked={!!reopenLastSession}
                    onChange={() => onReopenLastSession(!reopenLastSession)}
                    ariaLabel={t("settings.reopenLastSession")}
                  />
                </div>
              ) : null}
              {onDefaultOpenTarget && (
                <div className="settings-row">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.openTarget")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.openTargetDesc")}
                    </div>
                  </div>
                  <Select
                    value={defaultOpenTarget}
                    onChange={onDefaultOpenTarget}
                    options={[
                      { value: "finder", label: t("settings.openFinder") },
                      ...editors.map((e) => ({
                        value: e.id,
                        label: e.label,
                      })),
                    ]}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {section === "appearance" && (
          <>
            <div className="settings-card">
              <div className="settings-row">
                <div className="settings-row__text">
                  <div className="settings-row__label">
                    <IconAppearance size={16} />
                    {t("settings.theme")}
                  </div>
                  <div className="settings-row__desc">
                    {t("settings.themeDesc")}
                  </div>
                </div>
                <div className="settings-seg">
                  <button
                    type="button"
                    className={
                      "settings-seg__btn" + (theme === "light" ? " is-on" : "")
                    }
                    onClick={() => onTheme("light")}
                  >
                    {t("settings.themeLight")}
                  </button>
                  <button
                    type="button"
                    className={
                      "settings-seg__btn" + (theme === "dark" ? " is-on" : "")
                    }
                    onClick={() => onTheme("dark")}
                  >
                    {t("settings.themeDark")}
                  </button>
                </div>
              </div>
            </div>
            {onSkin ? (
              <div className="settings-card">
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.skin")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.skinDesc")}
                    </div>
                  </div>
                  <div
                    className="settings-skin-grid"
                    role="listbox"
                    aria-label={t("settings.skin")}
                  >
                    {THEME_SKINS.map((pack) => {
                      const selected = skin === pack.id;
                      const label = t(
                        `settings.skin.${pack.id}` as "settings.skin.default",
                      );
                      return (
                        <button
                          key={pack.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={
                            "settings-skin-card" + (selected ? " is-on" : "")
                          }
                          onClick={() => onSkin(pack.id)}
                        >
                          <span
                            className="settings-skin-card__swatch"
                            style={{
                              background: `linear-gradient(135deg, ${pack.swatch} 0%, ${pack.swatchAlt} 100%)`,
                            }}
                            aria-hidden
                          />
                          <span className="settings-skin-card__name">
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
            {onWallpaper ? (
              <div className="settings-card">
                <div className="settings-row settings-row--stack">
                  <div className="settings-row__text">
                    <div className="settings-row__label">
                      {t("settings.wallpaper")}
                    </div>
                    <div className="settings-row__desc">
                      {t("settings.wallpaperDesc")}
                    </div>
                  </div>
                  <div className="settings-wallpaper">
                    <div className="settings-wallpaper__preview">
                      {wallpaperUrl ? (
                        wallpaperKind === "video" ? (
                          <video
                            src={wallpaperUrl}
                            muted
                            loop
                            autoPlay
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          <img src={wallpaperUrl} alt="" />
                        )
                      ) : (
                        <div className="settings-wallpaper__preview-empty">
                          {t("settings.wallpaperEmpty")}
                        </div>
                      )}
                    </div>
                    <div className="settings-wallpaper__actions">
                      <input
                        ref={wallpaperInputRef}
                        type="file"
                        accept={WALLPAPER_ACCEPT}
                        hidden
                        onChange={(e) => {
                          void onWallpaperFile(e.target.files?.[0]);
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--solid btn--sm"
                        disabled={wallpaperBusy}
                        onClick={() => wallpaperInputRef.current?.click()}
                      >
                        {wallpaperBusy
                          ? t("settings.wallpaperWorking")
                          : wallpaperUrl
                            ? t("settings.wallpaperReplace")
                            : t("settings.wallpaperUpload")}
                      </button>
                      <button
                        type="button"
                        className="btn btn--solid btn--sm"
                        onClick={() => {
                          void (async () => {
                            try {
                              if (api.isTauri()) {
                                await api.openExternalUrl(
                                  "https://haowallpaper.com/",
                                );
                                return;
                              }
                            } catch {
                              /* fall through */
                            }
                            window.open(
                              "https://haowallpaper.com/",
                              "_blank",
                              "noopener,noreferrer",
                            );
                          })();
                        }}
                      >
                        {t("settings.wallpaperFind")}
                      </button>
                      {wallpaperIsCustom ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={wallpaperBusy}
                          onClick={() => {
                            setWallpaperError(null);
                            void onWallpaper(null);
                          }}
                        >
                          {t("settings.wallpaperClear")}
                        </button>
                      ) : null}
                    </div>
                    {wallpaperUrl && onWallpaperScrim ? (
                      <div className="settings-wallpaper__scrim">
                        <div className="settings-wallpaper__scrim-head">
                          <label
                            className="settings-wallpaper__scrim-label"
                            htmlFor="settings-wallpaper-scrim"
                          >
                            {t("settings.wallpaperScrim")}
                          </label>
                          <span
                            className="settings-wallpaper__scrim-value"
                            aria-hidden
                          >
                            {Math.round(wallpaperScrim)}%
                          </span>
                        </div>
                        <input
                          id="settings-wallpaper-scrim"
                          type="range"
                          className="settings-wallpaper__scrim-range"
                          min={0}
                          max={100}
                          step={1}
                          value={wallpaperScrim}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(wallpaperScrim)}
                          aria-label={t("settings.wallpaperScrim")}
                          onChange={(e) => {
                            onWallpaperScrim(Number(e.target.value));
                          }}
                        />
                        <p className="settings-wallpaper__scrim-hint">
                          {t("settings.wallpaperScrimDesc")}
                        </p>
                      </div>
                    ) : null}
                    {wallpaperError ? (
                      <p className="settings-wallpaper__error" role="alert">
                        {wallpaperError}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}

        {section === "archived" && (
          <>
            <p className="settings-page__lead">
              {t("settings.archived.desc")}
            </p>
            {archivedTotal === 0 ? (
              <div className="settings-card">
                <div className="settings-archived-empty">
                  {t("settings.archived.empty")}
                </div>
              </div>
            ) : (
              <>
                <div className="settings-archived-toolbar">
                  <UiCheck
                    className="ui-check--all"
                    checked={archivedAllSelected}
                    indeterminate={archivedSomeSelected}
                    onChange={toggleArchivedAll}
                    ariaLabel={t("settings.archived.selectAll")}
                    label={
                      archivedAllSelected
                        ? t("settings.archived.deselectAll")
                        : t("settings.archived.selectAll")
                    }
                  />
                  <span className="settings-archived-toolbar__count">
                    {archivedSelectedCount > 0
                      ? t("settings.archived.selectedCount", {
                          n: archivedSelectedCount,
                        })
                      : t("settings.archived.totalCount", {
                          n: archivedTotal,
                        })}
                  </span>
                  <div className="settings-archived-toolbar__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={archivedSelectedCount === 0}
                      onClick={() => {
                        const ids = [...archivedSelected];
                        if (!ids.length) return;
                        onRestoreArchivedSessions?.(ids);
                        setArchivedSelected(new Set());
                      }}
                    >
                      {t("settings.archived.restore")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm btn--danger"
                      disabled={archivedSelectedCount === 0}
                      onClick={() => {
                        const ids = [...archivedSelected];
                        if (!ids.length) return;
                        onDeleteArchivedSessions?.(ids);
                      }}
                    >
                      <IconTrash size={14} />
                      {t("settings.archived.delete")}
                    </button>
                  </div>
                </div>
                <div
                  ref={archivedSurfaceRef}
                  className={
                    "settings-archived-surface" +
                    (marquee ? " is-marqueeing" : "")
                  }
                  onPointerDown={onArchivedPointerDown}
                  onPointerMove={onArchivedPointerMove}
                  onPointerUp={onArchivedPointerUp}
                  onPointerCancel={onArchivedPointerCancel}
                >
                  {marquee
                    ? (() => {
                        const r = marqueeClientRect(marquee);
                        if (r.width < 2 && r.height < 2) return null;
                        return (
                          <div
                            className="settings-archived-marquee"
                            style={{
                              left: r.left,
                              top: r.top,
                              width: r.width,
                              height: r.height,
                            }}
                            aria-hidden
                          />
                        );
                      })()
                    : null}
                  {archivedGroups.map((group) => {
                    const groupIds = group.sessions.map((s) => s.id);
                    const groupAll =
                      groupIds.length > 0 &&
                      groupIds.every((id) => archivedSelected.has(id));
                    const groupSome =
                      !groupAll &&
                      groupIds.some((id) => archivedSelected.has(id));
                    return (
                      <div
                        key={group.id ?? "__orphan__"}
                        className="settings-archived-group"
                      >
                        <h2 className="settings-page__h2">
                          <UiCheck
                            className="ui-check--group"
                            checked={groupAll}
                            indeterminate={groupSome}
                            onChange={() => toggleArchivedGroup(groupIds)}
                            ariaLabel={group.name}
                          />
                          <IconArchive size={15} />
                          <span>{group.name}</span>
                          <span className="settings-archived-group__count">
                            {group.sessions.length}
                          </span>
                        </h2>
                        <div className="settings-card settings-card--flush">
                          {group.sessions.map((s) => {
                            const selected = archivedSelected.has(s.id);
                            return (
                              <div
                                key={s.id}
                                data-archived-id={s.id}
                                className={
                                  "settings-archived-row" +
                                  (selected ? " is-selected" : "")
                                }
                              >
                                <UiCheck
                                  checked={selected}
                                  onChange={() => toggleArchivedId(s.id)}
                                  ariaLabel={
                                    s.title || t("session.untitled")
                                  }
                                />
                                <div className="settings-archived-row__text">
                                  <div className="settings-archived-row__title">
                                    {s.title || t("session.untitled")}
                                  </div>
                                  <div className="settings-archived-row__meta">
                                    {formatSessionWhen(s.updatedAt, locale)}
                                  </div>
                                </div>
                                <div className="settings-archived-row__actions">
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    onClick={() =>
                                      onRestoreArchivedSessions?.([s.id])
                                    }
                                  >
                                    {t("settings.archived.restore")}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm btn--danger"
                                    onClick={() =>
                                      onDeleteArchivedSessions?.([s.id])
                                    }
                                  >
                                    <IconTrash size={14} />
                                    {t("settings.archived.delete")}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {section === "skills" && (
          <SkillsPanel
            projectPath={projectPath}
            tr={t as Parameters<typeof SkillsPanel>[0]["tr"]}
            onSkillsPrefsChanged={onSkillsPrefsChanged}
          />
        )}

        {section === "extensions" && (
          <PiExtensionsPanel
            locale={resolveLocale(locale)}
            projectPath={projectPath}
            onAskPi={onAskPiForCapability}
          />
        )}

        {section === "providers-models" && (
          <div className="settings-section providers-models">
            <ProviderConnectionsPanel
              locale={resolveLocale(locale)}
              projectPath={projectPath}
            />
            <ProvidersPanel
              locale={resolveLocale(locale)}
              onProviderActivated={onProviderActivated}
            />
            <div className="settings-card providers-models__models">
              <h2 className="settings-page__h2">
                {t("providersModels.modelsTitle")}
              </h2>
              <p className="settings-row__desc">
                {t("providersModels.modelsDescription")}
              </p>
              <div className="providers-models__model-groups">
                {modelGroups.map(([provider, models]) => (
                  <section
                    className="providers-models__model-group"
                    key={provider}
                    aria-labelledby={`model-provider-${provider}`}
                  >
                    <div className="providers-models__provider-head">
                      <h3 id={`model-provider-${provider}`}>{provider}</h3>
                      <span>
                        {t("providersModels.modelCount", {
                          count: models.length,
                        })}
                      </span>
                    </div>
                    <div className="providers-models__model-list">
                      {models.map((model) => {
                        const slash = model.id.indexOf("/");
                        const modelId =
                          slash > 0 ? model.id.slice(slash + 1) : model.id;
                        return (
                          <div
                            className="providers-models__model-row"
                            key={model.id}
                          >
                            <div>
                              <strong>{model.label || modelId}</strong>
                              {model.isDefault && (
                                <span>
                                  {t("providersModels.defaultModel")}
                                </span>
                              )}
                            </div>
                            <code>{modelId}</code>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {!modelGroups.length && (
                  <p className="settings-row__desc">
                    {t("providersModels.modelsEmpty")}
                  </p>
                )}
              </div>
            </div>
            <div className="settings-card providers-models__roles">
              <h2 className="settings-page__h2">{t("modelRoles.title")}</h2>
              <p className="settings-row__desc">{t("modelRoles.description")}</p>
              <div className="model-roles__grid">
                {roleNames.map((role) => (
                  <div className="model-roles__row" key={role}>
                    <label>
                      <span>{t(`modelRoles.${role}`)}</span>
                      <select
                        value={modelRoles[role] ?? ""}
                        onChange={(event) => {
                          const next = { ...modelRoles };
                          if (event.target.value) next[role] = event.target.value;
                          else delete next[role];
                          onModelRoles?.(next);
                        }}
                      >
                        <option value="">{t("modelRoles.unassigned")}</option>
                        {availableModels.map((model) => (
                          <option value={model.id} key={model.id}>
                            {model.label || model.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="model-roles__fallback">
                      <span>{t("modelRoles.fallback")}</span>
                      <input
                        value={(fallbackChains[role] ?? []).join(", ")}
                        placeholder={t("modelRoles.fallbackPlaceholder")}
                        onChange={(event) => {
                          const values = event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean);
                          const next = { ...fallbackChains };
                          if (values.length) next[role] = values;
                          else delete next[role];
                          onFallbackChains?.(next);
                        }}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
            <div className="settings-card providers-models__packages">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("providersModels.packagesTitle")}
                </div>
                <div className="settings-row__desc">
                  {t("providersModels.packagesDescription")}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => onSection("extensions")}
              >
                {t("providersModels.openExtensions")}
              </button>
            </div>
          </div>
        )}

        {false && section === "extensions" && (
          <ExtensionsPanel
            locale={resolveLocale(locale)}
            projectPath={projectPath}
            cliFound={cliInfo.found}
            onOpenRuntime={() => onSection("runtime")}
            onSkillsPrefsChanged={onSkillsPrefsChanged}
          />
        )}

        {section === "runtime" && (
          <div className="settings-section pi-runtime">
            <div className="settings-card">
              <h2 className="settings-page__h2">{t("piRuntime.title")}</h2>
              <p>{t("piRuntime.description")}</p>
              <div className="settings-row settings-row--stack">
                <div className="settings-row__text">
                  <div className="settings-row__label">{t("piRuntime.path")}</div>
                  <div className="settings-row__desc">
                    {cliInfo.found
                      ? `${t("piRuntime.detected")}: ${cliInfo.version || cliInfo.path || "pi"}`
                      : t("piRuntime.missing")}
                  </div>
                </div>
                <input
                  className="settings-input"
                  value={manualCliPath}
                  onChange={(e) => onManualCliPath(e.target.value)}
                  onBlur={(e) => onCliBlur(e.target.value.trim())}
                  placeholder={t("piRuntime.placeholder")}
                  spellCheck={false}
                />
              </div>
            </div>
            <RemoteRuntimePanel
              value={remoteRuntime}
              onSave={onRemoteRuntime}
              t={t}
            />
            <div className="settings-card pi-runtime__protocol">
              <div>
                <h3>{t("piRuntime.protocol")}</h3>
                <p>{t("piRuntime.protocolBody")}</p>
              </div>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void api.openExternalUrl("https://pi.dev/docs/latest")}
              >
                {t("piRuntime.docs")}
              </button>
            </div>
          </div>
        )}

        {section === "runtime" && (
          <div className="settings-card" hidden>
            <div className="settings-row settings-row--stack">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.cliPath")}{" "}
                  {cliInfo.found
                    ? `(${cliInfo.source || "ok"})`
                    : t("settings.cliNotFound")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.cliPathDesc")}
                </div>
              </div>
              <input
                className="settings-input"
                value={manualCliPath}
                placeholder={cliInfo.path || "e.g. ~/.pi/bin/pi"}
                onChange={(e) => onManualCliPath(e.target.value)}
                onBlur={(e) => onCliBlur(e.target.value.trim())}
              />
              {cliInfo.version && (
                <div className="settings-row__hint">
                  {cliInfo.version}
                  {cliInfo.path ? ` · ${cliInfo.path}` : ""}
                  {cliInfo.cliAuthPresent
                    ? ` · ${t("account.cliAuthOk")}`
                    : ` · ${t("account.cliAuthMissing")}`}
                </div>
              )}
            </div>
            <AcpServerField
              value={acpServerAddr}
              onChange={onAcpServerAddr}
              t={t}
            />
            <div className="settings-row settings-row--stack">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.maxConcurrentAgents")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.maxConcurrentAgentsDesc")}
                </div>
              </div>
              <input
                className="settings-input"
                type="number"
                min={1}
                max={8}
                step={1}
                value={maxConcurrentAgents}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  onMaxConcurrentAgents?.(Math.min(8, Math.max(1, Math.round(n))));
                }}
              />
            </div>
            <div className="settings-row settings-row--stack">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.agentIdleMinutes")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.agentIdleMinutesDesc")}
                </div>
              </div>
              <input
                className="settings-input"
                type="number"
                min={1}
                max={1440}
                step={1}
                value={agentIdleMinutes}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  onAgentIdleMinutes?.(
                    Math.min(1440, Math.max(1, Math.round(n))),
                  );
                }}
              />
            </div>
            <div className="settings-row settings-row--stack">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  {t("settings.streamStallSeconds")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.streamStallSecondsDesc")}
                </div>
              </div>
              <input
                className="settings-input"
                type="number"
                min={15}
                max={900}
                step={15}
                value={streamStallSeconds}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  onStreamStallSeconds?.(
                    Math.min(900, Math.max(15, Math.round(n))),
                  );
                }}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  <IconDoctor size={16} />
                  {t("doctor.title")}
                </div>
                <div className="settings-row__desc">
                  {t("settings.doctorDesc")}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--ghost settings-row__action"
                onClick={onDoctor}
              >
                {t("settings.runDoctor")}
              </button>
            </div>
            <div className="settings-card settings-card--nested pi-settings-block">
              <ProjectInspectPanel
                locale={resolveLocale(locale)}
                projectPath={projectPath}
                cliFound={cliInfo.found}
              />
            </div>
          </div>
        )}

        {section === "shortcuts" && (
          <ShortcutsSettingsPanel
            t={t}
            onOpenHelp={onOpenShortcutsHelp}
          />
        )}

        {section === "about" && (
          <div className="settings-card">
            <div className="settings-row settings-row--stack">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  <IconInfo size={16} />
                  {t("settings.aboutApp")}
                </div>
                <div className="settings-row__desc">{versionFooter}</div>
              </div>
            </div>
            <AboutUpdateRow t={t} />
          </div>
        )}
      </main>
      </div>

      {settingsToast ? (
        <div className="app-toast" role="status">
          {settingsToast}
        </div>
      ) : null}

      <GlassModal
        open={clearMemoryOpen}
        onClose={() => {
          if (!clearMemoryBusy) setClearMemoryOpen(false);
        }}
        title={t("settings.clearWorkspaceMemoryConfirmTitle")}
        size="sm"
        closeLabel={t("common.close")}
        closeOnOverlay={!clearMemoryBusy}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={clearMemoryBusy}
              onClick={() => setClearMemoryOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={clearMemoryBusy || !workspaceCwd}
              onClick={() => void runClearWorkspaceMemory()}
            >
              {clearMemoryBusy
                ? t("settings.clearWorkspaceMemoryBusy")
                : t("settings.clearWorkspaceMemory")}
            </button>
          </>
        }
      >
        <p className="settings-row__desc" style={{ margin: 0 }}>
          {t("settings.clearWorkspaceMemoryConfirmMsg")}
        </p>
      </GlassModal>
    </div>
  );
}

function ShortcutsSettingsPanel({
  t,
  onOpenHelp,
}: {
  t: (key: MessageKey, vars?: Vars) => string;
  onOpenHelp?: () => void;
}) {
  const platform = useMemo(() => detectShortcutPlatform(), []);
  const groups = useMemo(() => shortcutsByGroup(), []);

  const groupLabel = (g: ShortcutGroup) =>
    t(`settings.shortcuts.group.${g}` as MessageKey);

  return (
    <div className="settings-card">
      <div className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <div className="settings-row__label">
            <IconKeyboard size={16} />
            {t("settings.shortcuts.title")}
          </div>
          <div className="settings-row__desc">{t("settings.shortcuts.desc")}</div>
        </div>
        {onOpenHelp ? (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => onOpenHelp()}
          >
            {t("settings.shortcuts.openHelp")}
          </button>
        ) : null}
      </div>
      {groups.map(({ group, rows }) => (
        <div key={group} className="settings-shortcuts-group">
          <div className="settings-shortcuts-group__title">{groupLabel(group)}</div>
          <table className="settings-shortcuts-table">
            <thead>
              <tr>
                <th scope="col">{t("settings.shortcuts.colAction")}</th>
                <th
                  scope="col"
                  className={
                    platform === "mac" ? "is-platform-active" : undefined
                  }
                >
                  {t("settings.shortcuts.colMac")}
                </th>
                <th
                  scope="col"
                  className={
                    platform === "win" || platform === "other"
                      ? "is-platform-active"
                      : undefined
                  }
                >
                  {t("settings.shortcuts.colWin")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{t(row.labelKey as MessageKey)}</td>
                  <td>
                    <kbd className="settings-shortcuts-kbd">{row.mac}</kbd>
                  </td>
                  <td>
                    <kbd className="settings-shortcuts-kbd">{row.win}</kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p className="settings-shortcuts-note">{t("settings.shortcuts.note")}</p>
    </div>
  );
}

/** Shared-mode: list / import Pi CLI CLI sessions from PI_AGENT_HOME. */
function CliSessionsPanel({
  t,
  onImported,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  onImported?: () => void;
}) {
  const [rows, setRows] = useState<api.CliSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api.isTauri()) return;
    setLoading(true);
    setError(null);
    try {
      const list = await api.cliSessionsList();
      setRows(list);
    } catch (e) {
      setError(String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importOne = async (row: api.CliSessionSummary) => {
    setBusyId(row.agentSessionId);
    setError(null);
    setStatus(null);
    try {
      await api.cliSessionImport(row.agentSessionId, { dir: row.dir });
      setStatus(t("settings.cliSessionsImportedOne", { title: row.title }));
      await refresh();
      onImported?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const importAll = async () => {
    setBusyId("__all__");
    setError(null);
    setStatus(null);
    try {
      const imported = await api.cliSessionsImportAll(50);
      setStatus(
        t("settings.cliSessionsImportedN", { n: String(imported.length) }),
      );
      await refresh();
      onImported?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const pending = rows.filter((r) => !r.alreadyLinked).length;

  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.cliSessions")}</div>
        <div className="settings-row__desc">{t("settings.cliSessionsDesc")}</div>
      </div>
      <div className="settings-cli-sessions">
        <div className="settings-cli-sessions__actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={loading || !!busyId}
            onClick={() => void refresh()}
          >
            {t("resources.refresh")}
          </button>
          <button
            type="button"
            className="btn btn--solid"
            disabled={loading || !!busyId || pending === 0}
            onClick={() => void importAll()}
          >
            {busyId === "__all__"
              ? t("settings.cliSessionsImporting")
              : t("settings.cliSessionsImportAll", { n: String(pending) })}
          </button>
        </div>
        {error ? (
          <div className="settings-cli-sessions__err" role="alert">
            {error}
          </div>
        ) : null}
        {status ? (
          <div className="settings-cli-sessions__ok" role="status">
            {status}
          </div>
        ) : null}
        {loading && rows.length === 0 ? (
          <div className="settings-cli-sessions__empty">
            {t("settings.cliSessionsLoading")}
          </div>
        ) : rows.length === 0 ? (
          <div className="settings-cli-sessions__empty">
            {t("settings.cliSessionsEmpty")}
          </div>
        ) : (
          <ul className="settings-cli-sessions__list">
            {rows.slice(0, 40).map((r) => (
              <li key={r.agentSessionId} className="settings-cli-sessions__item">
                <div className="settings-cli-sessions__meta">
                  <div className="settings-cli-sessions__title">{r.title}</div>
                  <div className="settings-cli-sessions__sub">
                    {r.cwd || r.agentSessionId.slice(0, 12)}
                    {r.numMessages
                      ? ` · ${t("settings.cliSessionsMsgs", { n: String(r.numMessages) })}`
                      : ""}
                  </div>
                </div>
                {r.alreadyLinked ? (
                  <span className="settings-cli-sessions__badge">
                    {t("settings.cliSessionsLinked")}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={!!busyId}
                    onClick={() => void importOne(r)}
                  >
                    {busyId === r.agentSessionId
                      ? t("settings.cliSessionsImporting")
                      : t("settings.cliSessionsImport")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AboutUpdateRow({
  t,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [installPercent, setInstallPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.AppUpdateCheck | null>(null);

  const check = async () => {
    if (!api.isTauri()) {
      setError("not in Tauri");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.appCheckUpdate();
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    setInstallPercent(0);
    setError(null);
    try {
      await api.appInstallUpdate(({ downloaded, total }) => {
        setInstallPercent(
          total && total > 0
            ? Math.min(100, Math.round((downloaded / total) * 100))
            : 0,
        );
      });
    } catch (e) {
      setInstallPercent(null);
      setError(String(e));
    }
  };

  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.checkUpdate")}</div>
        <div className="settings-row__desc">{t("settings.checkUpdateDesc")}</div>
      </div>
      <div className="settings-about-update">
        <div className="settings-about-update__actions">
          {result?.updateAvailable ? (
            <button
              type="button"
              className="btn btn--solid"
              disabled={installPercent !== null}
              onClick={() => void install()}
            >
              {installPercent === null
                ? t("settings.checkUpdateOpen")
                : t("settings.checkUpdateInstalling", {
                    percent: installPercent,
                  })}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy}
              onClick={() => void check()}
            >
              {busy
                ? t("settings.checkUpdateChecking")
                : t("settings.checkUpdate")}
            </button>
          )}
        </div>
        {error ? (
          <div className="settings-about-update__err" role="alert">
            {t("settings.checkUpdateFailed", { error })}
          </div>
        ) : null}
        {result && !error ? (
          <div
            className={
              "settings-about-update__status" +
              (result.updateAvailable ? " is-available" : "")
            }
            role="status"
          >
            {result.updateAvailable
              ? t("settings.checkUpdateAvailable", {
                  latest: result.latestVersion,
                  current: result.currentVersion,
                })
              : t("settings.checkUpdateLatest", {
                  version: result.currentVersion,
                })}
          </div>
        ) : null}
        {result?.updateAvailable && result.assetNames.length > 0 ? (
          <div className="settings-about-update__assets">
            {result.assetNames.slice(0, 6).join(" · ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}
