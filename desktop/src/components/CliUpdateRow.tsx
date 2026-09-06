/**
 * Check / install Pi CLI CLI updates (`pi update --check --json`).
 * Used in Settings → Runtime and Doctor → Advanced.
 */

import { useState } from "react";
import type { MessageKey } from "@/i18n";
import * as api from "@/lib/api";

export function CliUpdateRow({
  t,
  cliFound,
  onAfterInstall,
  compact,
}: {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  cliFound?: boolean;
  onAfterInstall?: () => void;
  /** Tighter layout for Doctor advanced section. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<"check" | "install" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  const check = async () => {
    if (!api.isTauri()) {
      setError("not in Tauri");
      return;
    }
    if (cliFound === false) {
      setError(t("settings.cliUpdateNeedCli"));
      setResult(null);
      return;
    }
    setBusy("check");
    setError(null);
    setInstallMsg(null);
    setResult(null);
    try {
      const r = await api.cliUpdateCheck();
      setResult(r);
      if (r.error) {
        setError(r.error);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const install = async () => {
    if (!api.isTauri()) {
      setError("not in Tauri");
      return;
    }
    setBusy("install");
    setError(null);
    setInstallMsg(null);
    try {
      const r = await api.cliUpdateInstall();
      if (!r.ok) {
        setError(r.message || "update failed");
        return;
      }
      setInstallMsg(
        t("settings.cliUpdateDone", {
          version: r.version || result?.latestVersion || "—",
        }),
      );
      // Refresh check status after install.
      try {
        const next = await api.cliUpdateCheck();
        setResult(next);
      } catch {
        if (result) {
          setResult({
            ...result,
            currentVersion: r.version || result.latestVersion,
            updateAvailable: false,
          });
        }
      }
      onAfterInstall?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={
        compact
          ? "settings-row settings-row--stack settings-cli-update--compact"
          : "settings-row settings-row--stack"
      }
    >
      <div className="settings-row__text">
        <div className="settings-row__label">{t("settings.cliUpdate")}</div>
        <div className="settings-row__desc">{t("settings.cliUpdateDesc")}</div>
      </div>
      <div className="settings-cli-update">
        <div className="settings-cli-update__actions">
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy !== null}
            onClick={() => void check()}
          >
            {busy === "check"
              ? t("settings.cliUpdateChecking")
              : t("settings.cliUpdateCheck")}
          </button>
          {result?.updateAvailable ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy !== null}
              onClick={() => void install()}
            >
              {busy === "install"
                ? t("settings.cliUpdateInstalling")
                : t("settings.cliUpdateInstall")}
            </button>
          ) : null}
        </div>
        {error ? (
          <div className="settings-cli-update__err" role="alert">
            {result?.updateAvailable
              ? t("settings.cliUpdateInstallFailed", { error })
              : t("settings.cliUpdateFailed", { error })}
          </div>
        ) : null}
        {installMsg && !error ? (
          <div className="settings-cli-update__status" role="status">
            {installMsg}
          </div>
        ) : null}
        {result && !error && !installMsg ? (
          <div
            className={
              "settings-cli-update__status" +
              (result.updateAvailable ? " is-available" : "")
            }
            role="status"
          >
            {result.updateAvailable
              ? t("settings.cliUpdateAvailable", {
                  latest: result.latestVersion,
                  current: result.currentVersion,
                })
              : t("settings.cliUpdateLatest", {
                  version: result.currentVersion,
                })}
            {result.channel ? ` · ${result.channel}` : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}
