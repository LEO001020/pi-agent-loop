/**
 * Settings → Permissions: edit compact [permission] allow / deny / ask rules
 * in the active PI_AGENT_HOME config.toml.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "@/components/Select";
import { GlassModal } from "@/components/GlassModal";
import { IconPlus, IconShield, IconTrash } from "@/components/icons";
import * as api from "@/lib/api";
import {
  addRule,
  flattenRules,
  normalizeRules,
  PERMISSION_RULE_ACTIONS,
  removeRule,
  rulePlaceholder,
  ruleRowKey,
  type PermissionRuleAction,
  type PermissionRulesLike,
} from "@/lib/permissionRules";
import type { MessageKey } from "@/i18n";

type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export type PermissionRulesPanelProps = {
  t: TFn;
  /** Fired after a successful write (toast, etc.). */
  onSaved?: () => void;
  onError?: (message: string) => void;
};

const emptyRules = (): PermissionRulesLike => ({
  allow: [],
  deny: [],
  ask: [],
});

export function PermissionRulesPanel({
  t,
  onSaved,
  onError,
}: PermissionRulesPanelProps) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rules, setRules] = useState<PermissionRulesLike>(emptyRules);
  const [configPath, setConfigPath] = useState("");
  const [addAction, setAddAction] = useState<PermissionRuleAction>("allow");
  const [addText, setAddText] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{
    action: PermissionRuleAction;
    rule: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dto = await api.permissionRulesGet();
      setRules(
        normalizeRules({
          allow: dto.allow,
          deny: dto.deny,
          ask: dto.ask,
        }),
      );
      setConfigPath(dto.configPath || "");
    } catch (e) {
      onError?.(
        e instanceof Error ? e.message : t("settings.permissionRulesError"),
      );
    } finally {
      setLoading(false);
    }
  }, [onError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const flat = useMemo(() => flattenRules(rules), [rules]);

  const actionLabel = (action: PermissionRuleAction) =>
    t(
      (
        {
          allow: "settings.permissionRulesAction.allow",
          deny: "settings.permissionRulesAction.deny",
          ask: "settings.permissionRulesAction.ask",
        } as const
      )[action],
    );

  const persist = async (next: PermissionRulesLike) => {
    setBusy(true);
    try {
      const dto = await api.permissionRulesSet(next);
      setRules(
        normalizeRules({
          allow: dto.allow,
          deny: dto.deny,
          ask: dto.ask,
        }),
      );
      setConfigPath(dto.configPath || configPath);
      onSaved?.();
    } catch (e) {
      onError?.(
        e instanceof Error ? e.message : t("settings.permissionRulesError"),
      );
      // Reload from disk so UI matches failed write.
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onAdd = async () => {
    const next = addRule(rules, addAction, addText);
    if (!next) return;
    setAddText("");
    await persist(next);
  };

  const confirmRemove = async () => {
    const target = removeTarget;
    if (!target) return;
    setRemoveTarget(null);
    const next = removeRule(rules, target.action, target.rule);
    if (!next) return;
    await persist(next);
  };

  return (
    <div className="settings-card perm-rules">
      <div className="settings-row settings-row--stack">
        <div className="settings-row__text">
          <div className="settings-row__label">
            <IconShield size={16} />
            {t("settings.permissionRules")}
          </div>
          <div className="settings-row__desc">
            {t("settings.permissionRulesDesc")}
          </div>
          {configPath ? (
            <div className="settings-row__hint perm-rules__path" title={configPath}>
              {t("settings.permissionRulesPath", { path: configPath })}
            </div>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="perm-rules__empty">{t("settings.permissionRulesLoading")}</p>
      ) : (
        <>
          {flat.length === 0 ? (
            <p className="perm-rules__empty">
              {t("settings.permissionRulesEmpty")}
            </p>
          ) : (
            <ul className="perm-rules__list" role="list">
              {flat.map(({ action, rule }) => (
                <li
                  key={ruleRowKey(action, rule)}
                  className="perm-rules__item"
                >
                  <span
                    className={`perm-rules__badge perm-rules__badge--${action}`}
                  >
                    {actionLabel(action)}
                  </span>
                  <code className="perm-rules__rule" title={rule}>
                    {rule}
                  </code>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm perm-rules__remove"
                    disabled={busy}
                    onClick={() => setRemoveTarget({ action, rule })}
                    aria-label={t("settings.permissionRulesRemove")}
                  >
                    <IconTrash size={14} />
                    <span>{t("settings.permissionRulesRemove")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="perm-rules__add">
            <Select
              value={addAction}
              onChange={(v) =>
                setAddAction((normalizeActionSafe(v) ?? "allow") as PermissionRuleAction)
              }
              options={PERMISSION_RULE_ACTIONS.map((a) => ({
                value: a,
                label: actionLabel(a),
              }))}
            />
            <input
              className="perm-rules__input"
              type="text"
              value={addText}
              disabled={busy}
              placeholder={
                t("settings.permissionRulesPlaceholder") ||
                rulePlaceholder(addAction)
              }
              onChange={(e) => setAddText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onAdd();
                }
              }}
              aria-label={t("settings.permissionRulesPlaceholder")}
            />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || !addText.trim()}
              onClick={() => void onAdd()}
            >
              <IconPlus size={14} />
              <span>
                {busy
                  ? t("settings.permissionRulesAddWorking")
                  : t("settings.permissionRulesAdd")}
              </span>
            </button>
          </div>
        </>
      )}

      <GlassModal
        open={!!removeTarget}
        onClose={() => {
          if (!busy) setRemoveTarget(null);
        }}
        title={t("settings.permissionRulesRemoveTitle")}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => setRemoveTarget(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={() => void confirmRemove()}
            >
              {t("settings.permissionRulesRemove")}
            </button>
          </>
        }
      >
        <p className="perm-rules__confirm">
          {t("settings.permissionRulesRemoveConfirm", {
            action: removeTarget
              ? actionLabel(removeTarget.action)
              : "",
            rule: removeTarget?.rule ?? "",
          })}
        </p>
      </GlassModal>
    </div>
  );
}

function normalizeActionSafe(v: string): PermissionRuleAction | null {
  const t = v.trim().toLowerCase();
  if (t === "allow" || t === "deny" || t === "ask") return t;
  return null;
}
