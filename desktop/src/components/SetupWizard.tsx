/**
 * Full-screen first-run gate:
 * 1) Install / detect Pi CLI
 * 2) Ensure models are available (or skip with guidance)
 * 3) Enter workbench
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { PiLogo } from "@/components/PiLogo";
import { Spinner } from "@/components/ui/spinner";
import * as api from "@/lib/api";
import type { createT } from "@/i18n";

type Tr = ReturnType<typeof createT>;

export type SetupCliInfo = {
  found: boolean;
  path: string | null;
  version: string | null;
  source: string;
  cliAuthPresent: boolean;
};

type Step = "runtime" | "models" | "ready";

type Props = {
  tr: Tr;
  platform: "mac" | "win" | "other";
  useCustomWindowChrome: boolean;
  initialCli: SetupCliInfo;
  initialRemote: api.RemoteRuntimeSettings;
  onRemoteConfigured: (value: api.RemoteRuntimeSettings) => void;
  onComplete: (cli: SetupCliInfo, userName: string) => void;
};

function mirrorHost(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || url;
  }
}

export function SetupWizard({
  tr,
  platform,
  useCustomWindowChrome,
  initialCli,
  initialRemote,
  onRemoteConfigured,
  onComplete,
}: Props) {
  const [step, setStep] = useState<Step>(initialCli.found ? "models" : "runtime");
  const [cli, setCli] = useState<SetupCliInfo>(initialCli);
  const [probing, setProbing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<api.CliInstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [installCmds, setInstallCmds] = useState<api.CliInstallCommands | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [modelsSkipped, setModelsSkipped] = useState(false);
  const [userName, setUserName] = useState("");
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remote, setRemote] = useState(initialRemote);
  const [remoteToken, setRemoteToken] = useState("");
  const [remoteTesting, setRemoteTesting] = useState(false);

  useEffect(() => {
    void api.cliInstallCommands().then(setInstallCmds).catch(() => null);
  }, []);

  useEffect(() => {
    if (!api.isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<api.CliInstallProgress>(
          "setup://cli-install-progress",
          (ev) => {
            if (!cancelled) setProgress(ev.payload);
          },
        );
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const recheck = useCallback(async (manualPath?: string | null) => {
    setProbing(true);
    setError(null);
    try {
      const r = await api.probeCli(manualPath || undefined);
      const next: SetupCliInfo = {
        found: r.found,
        path: r.path,
        version: r.version,
        source: r.source || "",
        cliAuthPresent: !!r.cliAuthPresent,
      };
      setCli(next);
      if (next.found) setStatusMsg(null);
      return next;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setProbing(false);
    }
  }, []);

  const refreshModels = useCallback(async () => {
    setModelsBusy(true);
    setError(null);
    try {
      const res = await api.modelsListAvailable();
      const ids = (res.models || [])
        .map((m) => m.id)
        .filter((id) => id && id !== "auto");
      setModelIds(ids);
      return ids.length;
    } catch (e) {
      setError(String(e));
      setModelIds([]);
      return 0;
    } finally {
      setModelsBusy(false);
    }
  }, []);

  useEffect(() => {
    if (step !== "runtime" || cli.found) return;
    void recheck();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step !== "models" || !cli.found) return;
    void refreshModels();
  }, [step, cli.found, refreshModels]);

  const runInstall = useCallback(async () => {
    if (installing) return;
    setInstalling(true);
    setError(null);
    setProgress(null);
    try {
      await api.cliInstallLatest();
      const next = await recheck();
      if (next?.found) {
        setStep("models");
      } else {
        setError(tr("setup.error"));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  }, [installing, recheck, tr]);

  const pickBinary = useCallback(async () => {
    try {
      const p = await api.pickCliBinary();
      if (p) await recheck(p);
    } catch (e) {
      setError(String(e));
    }
  }, [recheck]);

  const testRemote = useCallback(async () => {
    setRemoteTesting(true);
    setError(null);
    try {
      const result =
        remote.transport === "direct"
          ? await api.remoteDirectTest(remote, remoteToken)
          : await api.remoteRuntimeTest(remote);
      if (!result.ok) {
        setError(result.error || tr("remoteRuntime.testFail", { error: "Unknown error" }));
        return;
      }
      const verified = { ...remote, enabled: true, verified: true };
      if (remote.transport === "direct" && remoteToken.trim()) {
        await api.remoteRuntimeTokenSet(remoteToken);
        verified.directTokenConfigured = true;
        setRemoteToken("");
      }
      setRemote(verified);
      onRemoteConfigured(verified);
      setCli({
        found: true,
        path: null,
        version:
          result.version ||
          (remote.transport === "direct" ? "Pi Direct RPC" : "Remote Pi over SSH"),
        source: remote.transport,
        cliAuthPresent: true,
      });
      setStep("models");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRemoteTesting(false);
    }
  }, [onRemoteConfigured, remote, remoteToken, tr]);

  const copyCmd = useCallback(async () => {
    const cmd =
      installCmds?.primary ||
      "npm install --global @earendil-works/pi-coding-agent@latest";
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(tr("setup.error"));
    }
  }, [installCmds, tr]);

  const openDocs = useCallback(() => {
    const url = installCmds?.docsUrl || "https://pi.dev/docs/latest";
    void api.openExternalUrl(url).catch((e) => setError(String(e)));
  }, [installCmds]);

  const openModelsDocs = useCallback(() => {
    void api
      .openExternalUrl("https://pi.dev/docs/latest")
      .catch((e) => setError(String(e)));
  }, []);

  const finishWizard = useCallback(async () => {
    const name = userName.trim().slice(0, 80);
    if (!name) return;
    try {
      const s = await api.settingsGet();
      await api.settingsSet({
        ...s,
        userName: name,
        setupWizardCompleted: true,
        authSetupDeferred: modelsSkipped || modelIds.length === 0,
        onboardingDone: true,
        setupSkipped: false,
      });
    } catch {
      /* still enter if probe succeeded */
    }
    onComplete(cli, name);
  }, [cli, modelIds.length, modelsSkipped, onComplete, userName]);

  const percent = useMemo(() => {
    const p = progress?.percent;
    if (p == null || Number.isNaN(p)) return installing ? 8 : 0;
    return Math.max(0, Math.min(100, Math.round(p)));
  }, [progress, installing]);

  const stepIndex = step === "runtime" ? 0 : step === "models" ? 1 : 2;
  const realModelCount = modelIds.length;

  return (
    <div
      className={
        "setup-gate" +
        (useCustomWindowChrome ? " setup-gate--custom-chrome" : "")
      }
      data-platform={platform}
      data-testid="setup-wizard"
    >
      <div className="setup-gate__drag" data-tauri-drag-region />

      <div className="setup-gate__center">
        <div className="setup-hero">
          <div
            className={
              "setup-logo" +
              (installing || probing || modelsBusy
                ? " setup-logo--spin"
                : "")
            }
          >
            <PiLogo size={44} />
          </div>
          <h1 className="setup-title">{tr("setup.title")}</h1>
          <p className="setup-subtitle">{tr("setup.subtitle")}</p>
        </div>

        <ol className="setup-steps" aria-label={tr("setup.stepsAria")}>
          {(
            [
              ["runtime", "setup.step.runtime"],
              ["models", "setup.step.models"],
              ["ready", "setup.step.ready"],
            ] as const
          ).map(([id, key], i) => (
            <li
              key={id}
              className={
                "setup-steps__item" +
                (i === stepIndex ? " is-active" : "") +
                (i < stepIndex ? " is-done" : "")
              }
            >
              <span className="setup-steps__dot" />
              <span className="setup-steps__label">{tr(key)}</span>
            </li>
          ))}
        </ol>

        <div className="setup-card">
          {step === "runtime" && (
            <>
              <div className="setup-card__head">
                <h2>
                  {cli.found
                    ? tr("setup.cli.found")
                    : tr("setup.cli.required")}
                </h2>
                <p>
                  {cli.found
                    ? tr("setup.cli.foundHint", {
                        version: cli.version || "—",
                      })
                    : tr("setup.cli.requiredHint")}
                </p>
                {cli.path && (
                  <p className="setup-mono">
                    {tr("setup.cli.path", { path: cli.path })}
                  </p>
                )}
              </div>

              {(installing || progress) && (
                <div className="setup-progress" aria-live="polite">
                  <div className="setup-progress__track">
                    <div
                      className="setup-progress__fill"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <div className="setup-progress__meta">
                    <span>
                      {progress?.message ||
                        (installing
                          ? tr("setup.installing")
                          : tr("setup.detecting"))}
                    </span>
                    <span>{tr("setup.progress", { percent })}</span>
                  </div>
                  {progress?.mirror && (
                    <div className="setup-progress__mirror">
                      {tr("setup.mirror", {
                        host: mirrorHost(progress.mirror),
                      })}
                    </div>
                  )}
                </div>
              )}

              {!cli.found && !installing && (
                <p className="setup-hint">{tr("setup.manualHint")}</p>
              )}

              {!cli.found && !installing && (
                <div className="setup-remote">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    aria-expanded={remoteOpen}
                    onClick={() => setRemoteOpen((open) => !open)}
                  >
                    {tr("setup.remote.toggle")}
                  </button>
                  {remoteOpen ? (
                    <div className="setup-remote__fields">
                      <label>
                        <span>{tr("remoteRuntime.transport")}</span>
                        <select
                          value={remote.transport}
                          onChange={(event) =>
                            setRemote((current) => ({
                              ...current,
                              transport: event.target.value,
                              verified: false,
                            }))
                          }
                        >
                          <option value="ssh">
                            {tr("remoteRuntime.transportSsh")}
                          </option>
                          <option value="direct">
                            {tr("remoteRuntime.transportDirect")}
                          </option>
                        </select>
                      </label>
                      {remote.transport === "direct" ? (
                        <>
                          <label>
                            <span>{tr("remoteRuntime.directUrl")}</span>
                            <input
                              type="url"
                              value={remote.directUrl}
                              placeholder={tr("remoteRuntime.directUrlPlaceholder")}
                              onChange={(event) =>
                                setRemote((current) => ({
                                  ...current,
                                  directUrl: event.target.value,
                                  verified: false,
                                }))
                              }
                            />
                          </label>
                          <label>
                            <span>{tr("remoteRuntime.directToken")}</span>
                            <input
                              type="password"
                              value={remoteToken}
                              placeholder={
                                remote.directTokenConfigured
                                  ? tr("remoteRuntime.directTokenStored")
                                  : tr("remoteRuntime.directTokenPlaceholder")
                              }
                              autoComplete="off"
                              onChange={(event) => {
                                setRemoteToken(event.target.value);
                                setRemote((current) => ({
                                  ...current,
                                  verified: false,
                                }));
                              }}
                            />
                          </label>
                          <label>
                            <span>{tr("remoteRuntime.cwd")}</span>
                            <input
                              value={remote.cwd}
                              placeholder={tr("remoteRuntime.cwdPlaceholder")}
                              onChange={(event) =>
                                setRemote((current) => ({
                                  ...current,
                                  cwd: event.target.value,
                                  verified: false,
                                }))
                              }
                            />
                          </label>
                          <p>{tr("remoteRuntime.directSecurity")}</p>
                        </>
                      ) : (
                        <>
                      <label>
                        <span>{tr("remoteRuntime.host")}</span>
                        <input
                          value={remote.host}
                          placeholder={tr("remoteRuntime.hostPlaceholder")}
                          onChange={(event) =>
                            setRemote((current) => ({
                              ...current,
                              host: event.target.value,
                              verified: false,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>{tr("remoteRuntime.user")}</span>
                        <input
                          value={remote.user}
                          placeholder={tr("remoteRuntime.userPlaceholder")}
                          onChange={(event) =>
                            setRemote((current) => ({
                              ...current,
                              user: event.target.value,
                              verified: false,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>{tr("remoteRuntime.cwd")}</span>
                        <input
                          value={remote.cwd}
                          placeholder={tr("remoteRuntime.cwdPlaceholder")}
                          onChange={(event) =>
                            setRemote((current) => ({
                              ...current,
                              cwd: event.target.value,
                              verified: false,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>{tr("remoteRuntime.identity")}</span>
                        <input
                          value={remote.identityFile}
                          placeholder={tr("remoteRuntime.identityPlaceholder")}
                          onChange={(event) =>
                            setRemote((current) => ({
                              ...current,
                              identityFile: event.target.value,
                              verified: false,
                            }))
                          }
                        />
                      </label>
                      <p>{tr("remoteRuntime.security")}</p>
                        </>
                      )}
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={
                          remoteTesting ||
                          (remote.transport === "direct"
                            ? !remote.directUrl.trim() ||
                              (!remoteToken.trim() &&
                                !remote.directTokenConfigured) ||
                              !remote.cwd.trim()
                            : !remote.host.trim() ||
                              !remote.user.trim() ||
                              !remote.cwd.trim())
                        }
                        onClick={() => void testRemote()}
                      >
                        {remoteTesting
                          ? tr("remoteRuntime.testing")
                          : tr("remoteRuntime.test")}
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="setup-actions">
                {cli.found ? (
                  <button
                    type="button"
                    className="btn btn--primary setup-btn-primary"
                    onClick={() => setStep("models")}
                  >
                    {tr("setup.continue")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary setup-btn-primary"
                    disabled={installing || probing}
                    onClick={() => void runInstall()}
                  >
                    {installing ? (
                      <>
                        <Spinner className="size-4" />
                        {tr("setup.installing")}
                      </>
                    ) : (
                      tr("setup.install")
                    )}
                  </button>
                )}
                <div className="setup-actions__row">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={installing || probing}
                    onClick={() => void recheck()}
                  >
                    {probing ? <Spinner className="size-3.5" /> : null}
                    {tr("setup.recheck")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={installing}
                    onClick={() => void pickBinary()}
                  >
                    {tr("setup.pickBinary")}
                  </button>
                </div>
                <div className="setup-actions__row">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={!installCmds?.primary}
                    onClick={() => void copyCmd()}
                  >
                    {copied ? tr("setup.copied") : tr("setup.copyCmd")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={openDocs}
                  >
                    {tr("setup.openDocs")}
                  </button>
                </div>
                {installCmds?.primary && (
                  <code className="setup-cmd">{installCmds.primary}</code>
                )}
              </div>
            </>
          )}

          {step === "models" && (
            <>
              <div className="setup-card__head">
                <h2>{tr("setup.models.title")}</h2>
                <p>{tr("setup.models.hint")}</p>
              </div>

              {modelsBusy ? (
                <p className="setup-hint">
                  <Spinner className="size-3.5" /> {tr("setup.models.working")}
                </p>
              ) : realModelCount > 0 ? (
                <p className="setup-hint setup-hint--success">
                  <span className="setup-check" />
                  {tr("setup.models.found", { n: String(realModelCount) })}
                </p>
              ) : (
                <>
                  <p className="setup-hint">
                    <strong>{tr("setup.models.empty")}</strong>
                    <br />
                    {tr("setup.models.emptyHint")}
                  </p>
                  <code className="setup-cmd">
                    npm install -g @earendil-works/pi-coding-agent@latest
                    {"\n"}
                    pi
                  </code>
                  <p className="setup-hint">{tr("setup.models.cmdAuthHint")}</p>
                </>
              )}

              <div className="setup-actions">
                {realModelCount > 0 ? (
                  <button
                    type="button"
                    className="btn btn--primary setup-btn-primary"
                    onClick={() => {
                      setModelsSkipped(false);
                      setStep("ready");
                    }}
                  >
                    {tr("setup.continue")}
                  </button>
                ) : null}
                <div className="setup-actions__row">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={modelsBusy}
                    onClick={() => void refreshModels()}
                  >
                    {modelsBusy ? <Spinner className="size-3.5" /> : null}
                    {tr("setup.models.recheck")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={openModelsDocs}
                  >
                    {tr("setup.models.openDocs")}
                  </button>
                </div>
                {realModelCount === 0 ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setModelsSkipped(true);
                      setStep("ready");
                    }}
                  >
                    {tr("setup.models.skip")}
                  </button>
                ) : null}
              </div>
            </>
          )}

          {step === "ready" && (
            <>
              <div className="setup-card__head">
                <h2>{tr("setup.ready.title")}</h2>
              </div>
              <ul className="setup-checklist">
                <li className="is-ok">
                  <span className="setup-check" />
                  {tr("setup.ready.cliOk")}
                  {cli.version ? (
                    <span className="setup-check-meta">{cli.version}</span>
                  ) : null}
                </li>
                <li className={realModelCount > 0 ? "is-ok" : ""}>
                  <span className="setup-check" />
                  {realModelCount > 0
                    ? tr("setup.ready.modelsOk")
                    : tr("setup.ready.modelsSkip")}
                  {realModelCount > 0 ? (
                    <span className="setup-check-meta">{realModelCount}</span>
                  ) : null}
                </li>
              </ul>
              <label className="setup-name">
                <span>{tr("setup.ready.name")}</span>
                <input
                  type="text"
                  value={userName}
                  maxLength={80}
                  autoComplete="name"
                  autoFocus
                  placeholder={tr("setup.ready.namePlaceholder")}
                  onChange={(event) => setUserName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && userName.trim()) {
                      void finishWizard();
                    }
                  }}
                />
                <small>{tr("setup.ready.nameHint")}</small>
              </label>
              <div className="setup-actions">
                <button
                  type="button"
                  className="btn btn--primary setup-btn-primary"
                  disabled={!cli.found || !userName.trim()}
                  onClick={() => void finishWizard()}
                >
                  {tr("setup.ready.enter")}
                </button>
              </div>
            </>
          )}

          {error && (
            <div className="setup-error" role="alert">
              <strong>{tr("setup.error")}</strong>
              <span>{error}</span>
              {/network|timeout|mirror|download|HTTP|failed/i.test(error) && (
                <span className="setup-error__hint">
                  {tr("setup.networkHint")}
                </span>
              )}
            </div>
          )}
          {statusMsg && !error && (
            <div className="setup-status" role="status">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
