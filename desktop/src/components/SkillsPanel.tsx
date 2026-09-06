/**
 * Settings → Skills: what the agent can be asked to do by name.
 *
 * Lists the skills Pi discovers (user, project, plugin), lets each be switched
 * off for the slash palette, and installs new ones. Installation goes through
 * `pi install` — skills ship inside packages, so the CLI stays the one thing
 * that writes to the agent home.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import { skillMetaLine } from "@/lib/extensionsUi";
import { parseSkillSource } from "@/lib/skillsInstall";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

export function SkillsPanel({
  projectPath,
  tr,
  onSkillsPrefsChanged,
}: {
  projectPath: string | null;
  tr: TFn;
  onSkillsPrefsChanged?: () => void;
}) {
  const [skills, setSkills] = useState<api.SkillDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [source, setSource] = useState("");
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installedNote, setInstalledNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.skillsList(projectPath);
      setSkills(res.skills ?? []);
      setListError(res.error?.trim() ? res.error : null);
    } catch (e) {
      setSkills([]);
      setListError(String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(
    async (name: string, enabled: boolean) => {
      // Optimistic: the palette filter is a preference, not a build step.
      setSkills((prev) =>
        prev.map((s) => (s.name === name ? { ...s, enabled } : s)),
      );
      try {
        await api.extensionsSetSkill(name, enabled);
        onSkillsPrefsChanged?.();
      } catch {
        setSkills((prev) =>
          prev.map((s) => (s.name === name ? { ...s, enabled: !enabled } : s)),
        );
      }
    },
    [onSkillsPrefsChanged],
  );

  const install = useCallback(async () => {
    const parsed = parseSkillSource(source);
    if (!parsed) {
      setInstallError(tr("skills.badSource"));
      return;
    }
    setInstallBusy(true);
    setInstallError(null);
    setInstalledNote(null);
    try {
      await api.piPackageInstall({
        source: parsed.source,
        local: false,
        projectPath,
      });
      setSource("");
      setInstalledNote(tr("skills.installed", { source: parsed.source }));
      await refresh();
      onSkillsPrefsChanged?.();
    } catch (e) {
      setInstallError(String(e));
    } finally {
      setInstallBusy(false);
    }
  }, [onSkillsPrefsChanged, projectPath, refresh, source, tr]);

  return (
    <div className="settings-section skills-panel">
      <div className="settings-card">
        <div className="settings-row settings-row--stack">
          <div className="settings-row__text">
            <div className="settings-row__label">{tr("skills.installTitle")}</div>
            <div className="settings-row__desc">{tr("skills.installDesc")}</div>
          </div>
          <form
            className="skills-panel__install"
            onSubmit={(e) => {
              e.preventDefault();
              void install();
            }}
          >
            <input
              className="settings-input"
              value={source}
              placeholder={tr("skills.sourcePlaceholder")}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={installBusy}
              onChange={(e) => {
                setSource(e.target.value);
                setInstallError(null);
                setInstalledNote(null);
              }}
            />
            <button
              type="submit"
              className="btn btn--solid"
              disabled={installBusy || !source.trim()}
            >
              {installBusy ? tr("skills.installing") : tr("skills.install")}
            </button>
          </form>
          {installError ? (
            <p className="skills-panel__error">{installError}</p>
          ) : null}
          {installedNote ? (
            <p className="skills-panel__ok">{installedNote}</p>
          ) : null}
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-row settings-row--stack">
          <div className="skills-panel__list-head">
            <div className="settings-row__text">
              <div className="settings-row__label">{tr("skills.listTitle")}</div>
              <div className="settings-row__desc">{tr("skills.listDesc")}</div>
            </div>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => void refresh()}
              disabled={loading || installBusy}
            >
              {tr("common.refresh")}
            </button>
          </div>

          {loading ? (
            <p className="skills-panel__empty">{tr("common.loading")}</p>
          ) : listError ? (
            <p className="skills-panel__error">{listError}</p>
          ) : skills.length === 0 ? (
            <p className="skills-panel__empty">{tr("skills.empty")}</p>
          ) : (
            <ul className="skills-panel__list">
              {skills.map((s) => (
                <li key={s.name} className="skills-panel__row">
                  <div className="skills-panel__text">
                    <span className="skills-panel__name">{s.name}</span>
                    <span className="skills-panel__meta">
                      {skillMetaLine(s)}
                    </span>
                    {s.description ? (
                      <span className="skills-panel__desc">
                        {s.description}
                      </span>
                    ) : null}
                  </div>
                  <label className="skills-panel__toggle">
                    <input
                      type="checkbox"
                      checked={s.enabled !== false}
                      onChange={(e) => void toggle(s.name, e.target.checked)}
                      aria-label={tr("skills.toggleAria", { name: s.name })}
                    />
                    <span>
                      {s.enabled !== false
                        ? tr("skills.enabled")
                        : tr("skills.disabled")}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
