/**
 * Catalogs aligned with Pi (`pi --list-models` and RPC thinking levels).
 * Historical export names are kept while the surrounding UI migrates.
 * Update docs/llm-wiki/catalog.md when defaults change.
 */

export interface EffortOption {
  /** Effort id passed to `--reasoning-effort` (e.g. low / medium / high). */
  id: string;
  /** CLI value when distinct from id; usually equals id. */
  value?: string;
  /** Display label from catalog when present. */
  label?: string;
  description?: string;
  isDefault?: boolean;
}

export interface ModelOption {
  id: string;
  /** Display name (language-neutral product name) */
  label: string;
  /** True if CLI lists as default */
  isDefault?: boolean;
  /** Catalog source; `custom` marks a configured provider in the composer. */
  source?: string;
  contextWindow?: number;
  /**
   * The last turn on this model was refused for balance or entitlement. A hint
   * about the present, not a verdict: the account may have been topped up since,
   * so the menu marks the model rather than refusing to select it.
   */
  blocked?: boolean;
  /** Per-model reasoning efforts from CLI cache; empty/undefined → static fallback. */
  reasoningEfforts?: EffortOption[];
}

export interface SessionModeOption {
  id: "agent" | "plan" | "ask";
}

/**
 * Permission policies (composer + settings), aligned with Pi CLI modes:
 * | Build mode           | App id            |
 * | default              | ask               |
 * | acceptEdits          | accept_edits      |
 * | (session grant UX)   | allow_for_session |
 * | dontAsk              | dont_ask          |
 * | bypassPermissions    | always_approve    |
 */
export type PermissionPolicyId =
  | "ask"
  | "accept_edits"
  | "allow_for_session"
  | "dont_ask"
  | "always_approve";

/** Where composer model / permission choices are remembered. */
export type ComposerPrefsScope = "global" | "project" | "session";

export const COMPOSER_PREFS_SCOPES: ComposerPrefsScope[] = [
  "global",
  "project",
  "session",
];

/**
 * Fallback catalog when Host has not returned live models yet.
 * Official OAuth currently exposes pi-4.5 only (2026-07 probe).
 * `pi-build` is NOT listed — CLI rejects it as unknown model id.
 */
export const PI_FALLBACK_MODELS: ModelOption[] = [
  { id: "auto", label: "Pi default", isDefault: true, source: "pi" },
];

export const DEFAULT_MODEL_ID =
  PI_FALLBACK_MODELS.find((m) => m.isDefault)?.id ?? "auto";

/** Static fallback when the selected model has no `reasoning_efforts` in cache. */
export const PI_FALLBACK_EFFORTS: EffortOption[] = [
  { id: "off" },
  { id: "minimal" },
  { id: "low" },
  { id: "medium", isDefault: true },
  { id: "high" },
  { id: "xhigh" },
  { id: "max" },
];

/**
 * Default reasoning depth. `medium` balances speed vs quality for agentic use;
 * users can lower (faster) or raise (deeper) via the composer chip.
 * When a model lists a default effort, prefer `pickDefaultEffort(model)`.
 */
export const DEFAULT_EFFORT = "medium";

/** Product session modes (desktop shell). */
export const SESSION_MODES: SessionModeOption[] = [
  { id: "agent" },
];

/**
 * Permission policies (composer + settings).
 * `always_approve` = YOLO / unrestricted (CLI `--always-approve`, config yolo).
 */
export const PERMISSION_POLICIES: {
  id: PermissionPolicyId;
  dangerous?: boolean;
}[] = [
  { id: "ask" },
  { id: "accept_edits" },
  { id: "allow_for_session" },
  { id: "dont_ask" },
  { id: "always_approve", dangerous: true },
];

export function isValidModelId(
  id: string,
  catalog: ModelOption[] = PI_FALLBACK_MODELS,
): boolean {
  return catalog.some((m) => m.id === id);
}

/**
 * Efforts list for a model: live catalog when non-empty, else static fallback.
 */
export function effortsForModel(
  model?: ModelOption | null,
  catalogEfforts?: EffortOption[] | null,
): EffortOption[] {
  const fromArg =
    catalogEfforts && catalogEfforts.length > 0 ? catalogEfforts : null;
  const fromModel =
    model?.reasoningEfforts && model.reasoningEfforts.length > 0
      ? model.reasoningEfforts
      : null;
  return fromArg ?? fromModel ?? PI_FALLBACK_EFFORTS;
}

/**
 * Validate an effort id against the selected model's efforts when known;
 * otherwise against the static PI_FALLBACK_EFFORTS fallback.
 */
export function isValidEffort(
  id: string,
  modelOrEfforts?: ModelOption | EffortOption[] | null,
): boolean {
  if (!id) return false;
  if (Array.isArray(modelOrEfforts)) {
    return effortsForModel(null, modelOrEfforts).some((e) => e.id === id);
  }
  return effortsForModel(modelOrEfforts).some((e) => e.id === id);
}

/** Default effort for a model (catalog default flag, else first, else medium). */
export function pickDefaultEffort(
  model?: ModelOption | null,
  catalogEfforts?: EffortOption[] | null,
): string {
  const list = effortsForModel(model, catalogEfforts);
  return (
    list.find((e) => e.isDefault)?.id ?? list[0]?.id ?? DEFAULT_EFFORT
  );
}

/**
 * Display label for an effort: prefer catalog label, else i18n via known ids.
 * `i18nLabels` maps high/medium/low (and optionally other ids).
 */
export function effortDisplayLabel(
  effort: EffortOption | string,
  i18nLabels?: {
    high?: string;
    medium?: string;
    low?: string;
  },
): string {
  if (typeof effort !== "string") {
    if (effort.label && effort.label.trim()) return effort.label;
    return effortDisplayLabel(effort.id, i18nLabels);
  }
  if (effort === "high" && i18nLabels?.high) return i18nLabels.high;
  if (effort === "medium" && i18nLabels?.medium) return i18nLabels.medium;
  if (effort === "low" && i18nLabels?.low) return i18nLabels.low;
  return effort;
}

export function isValidPolicy(id: string): id is PermissionPolicyId {
  return PERMISSION_POLICIES.some((p) => p.id === id);
}

export function isValidPrefsScope(id: string): id is ComposerPrefsScope {
  return COMPOSER_PREFS_SCOPES.includes(id as ComposerPrefsScope);
}

export function pickDefaultModelId(catalog: ModelOption[]): string {
  return (
    catalog.find((m) => m.isDefault)?.id ??
    catalog[0]?.id ??
    DEFAULT_MODEL_ID
  );
}

/** Find a model in catalog by id. */
export function findModel(
  id: string,
  catalog: ModelOption[] = PI_FALLBACK_MODELS,
): ModelOption | undefined {
  return catalog.find((m) => m.id === id);
}
