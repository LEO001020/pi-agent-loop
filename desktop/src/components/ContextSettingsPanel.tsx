import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { Vars } from "@/i18n";

type ContextDraft = {
  agents: string;
  system: string;
};

export function ContextSettingsPanel({
  t,
}: {
  t: (key: string, vars?: Vars) => string;
}) {
  const [draft, setDraft] = useState<ContextDraft>({ agents: "", system: "" });
  const [saved, setSaved] = useState<ContextDraft>({ agents: "", system: "" });
  const [home, setHome] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"agents" | "system" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const applyResult = useCallback((result: api.AgentContextResult) => {
    const next = {
      agents: result.agents.content,
      system: result.system.content,
    };
    setDraft(next);
    setSaved(next);
    setHome(result.home);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void api
      .agentContextGet()
      .then((result) => {
        if (!cancelled) applyResult(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyResult]);

  const save = async (kind: "agents" | "system") => {
    setSaving(kind);
    setError("");
    setStatus("");
    try {
      const result = await api.agentContextSet(kind, draft[kind]);
      applyResult(result);
      setStatus(t("settings.context.saved", { name: result[kind].name }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(null);
    }
  };

  const editor = (
    kind: "system" | "agents",
    title: string,
    description: string,
    placeholder: string,
  ) => {
    const dirty = draft[kind] !== saved[kind];
    return (
      <div className="settings-card context-settings__file">
        <div className="context-settings__head">
          <div className="settings-row__text">
            <div className="settings-row__label">{title}</div>
            <div className="settings-row__desc">{description}</div>
          </div>
          <span className="context-settings__state">
            {loading
              ? t("settings.context.loading")
              : dirty
                ? t("settings.context.unsaved")
                : t("settings.context.savedState")}
          </span>
        </div>
        <textarea
          className="context-settings__editor"
          value={draft[kind]}
          disabled={loading || saving !== null}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) =>
            setDraft((current) => ({ ...current, [kind]: event.target.value }))
          }
        />
        <div className="context-settings__actions">
          <span className="context-settings__count">
            {t("settings.context.characters", { n: draft[kind].length })}
          </span>
          <button
            type="button"
            className="btn btn--solid"
            disabled={loading || saving !== null || !dirty}
            onClick={() => void save(kind)}
          >
            {saving === kind
              ? t("settings.context.saving")
              : t("settings.context.save", { name: title })}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="settings-section context-settings">
      <p className="settings-page__lead">{t("settings.context.intro")}</p>
      <div className="context-settings__scope">
        <span>{t("settings.context.activeProfile")}</span>
        <code>{home || t("settings.context.loading")}</code>
      </div>
      {editor(
        "system",
        "SYSTEM.md",
        t("settings.context.systemDesc"),
        t("settings.context.systemPlaceholder"),
      )}
      {editor(
        "agents",
        "AGENTS.md",
        t("settings.context.agentsDesc"),
        t("settings.context.agentsPlaceholder"),
      )}
      {error ? (
        <div className="context-settings__message is-error" role="alert">
          {t("settings.context.error", { error })}
        </div>
      ) : null}
      {status ? (
        <div className="context-settings__message" role="status">
          {status}
        </div>
      ) : null}
      <p className="context-settings__note">{t("settings.context.nextTurn")}</p>
    </div>
  );
}
