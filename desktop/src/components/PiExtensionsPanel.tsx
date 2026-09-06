import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createT, resolveLocale, type MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import {
  PI_FOUNDATION_PACKAGES,
  PI_PACKAGE_CATALOG,
  installedPiPackageIds,
  isPinnedPiPackageSource,
  type PiPackageAccess,
  type PiPackageCatalogEntry,
} from "@/lib/piPackageCatalog";

type Props = {
  locale: string;
  projectPath?: string | null;
  onAskPi?: (request?: string) => void;
};

type InstallCandidate = {
  id: string;
  source: string;
  title: string;
  access: PiPackageAccess[];
  pinned: boolean;
};

const ACCESS_KEYS: Record<PiPackageAccess, MessageKey> = {
  conversation: "piExt.access.conversation",
  workspace: "piExt.access.workspace",
  system: "piExt.access.system",
  provider: "piExt.access.provider",
  network: "piExt.access.network",
  browser: "piExt.access.browser",
};

export function PiExtensionsPanel({
  locale,
  projectPath,
  onAskPi,
}: Props) {
  const tr = useMemo(() => createT(resolveLocale(locale)), [locale]);
  const [result, setResult] = useState<api.PiPackagesResult | null>(null);
  const [source, setSource] = useState("");
  const [local, setLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<InstallCandidate[]>([]);
  const [capabilityRequest, setCapabilityRequest] = useState("");
  const reviewRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    if (!api.isTauri()) {
      setResult({ packages: [], configDir: "~/.pi/agent" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api.piPackagesList(projectPath));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pendingInstall.length) return;
    const frame = window.requestAnimationFrame(() => {
      reviewRef.current?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingInstall]);

  const installedIds = useMemo(
    () => installedPiPackageIds(result?.packages.map((pkg) => pkg.source) ?? []),
    [result],
  );
  const foundationMissing = useMemo(
    () => PI_FOUNDATION_PACKAGES.filter((entry) => !installedIds.has(entry.id)),
    [installedIds],
  );

  const candidateFor = useCallback(
    (entry: PiPackageCatalogEntry): InstallCandidate => ({
      id: entry.id,
      source: entry.source,
      title: tr(entry.titleKey),
      access: [...entry.access],
      pinned: true,
    }),
    [tr],
  );

  const reviewCatalogInstall = (entries: readonly PiPackageCatalogEntry[]) => {
    if (busy) return;
    const candidates = entries
      .filter((entry) => !installedIds.has(entry.id))
      .map(candidateFor);
    if (!candidates.length) return;
    setError(null);
    setPendingInstall(candidates);
  };

  const reviewManualInstall = () => {
    const value = source.trim();
    if (!value || busy) return;
    setError(null);
    setPendingInstall([
      {
        id: "manual",
        source: value,
        title: value,
        access: ["conversation", "workspace", "system"],
        pinned: isPinnedPiPackageSource(value),
      },
    ]);
  };

  const installReviewed = async () => {
    if (!pendingInstall.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      let nextResult = result;
      for (const candidate of pendingInstall) {
        try {
          nextResult = await api.piPackageInstall({
            source: candidate.source,
            local,
            projectPath,
          });
          setResult(nextResult);
        } catch (e) {
          throw new Error(`${candidate.title}: ${String(e)}`);
        }
      }
      setPendingInstall([]);
      if (pendingInstall.some((candidate) => candidate.id === "manual")) {
        setSource("");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (pkg: api.PiPackage) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.piPackageRemove({
          source: pkg.source,
          local: pkg.scope === "project",
          projectPath,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const update = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.piPackagesUpdate(projectPath));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const accessText = (access: readonly PiPackageAccess[]) =>
    access.map((item) => tr(ACCESS_KEYS[item])).join(" · ");

  const renderCatalogRow = (entry: PiPackageCatalogEntry) => {
    const installed = installedIds.has(entry.id);
    return (
      <div className="pi-ext__catalog-row" key={entry.id}>
        <div className="pi-ext__catalog-copy">
          <div className="pi-ext__catalog-title">
            <strong>{tr(entry.titleKey)}</strong>
            <span>
              {entry.packageName} · {entry.version}
            </span>
          </div>
          <p>{tr(entry.descriptionKey)}</p>
          <p className="pi-ext__access">
            {tr("piExt.accessLabel")}: {accessText(entry.access)}
          </p>
        </div>
        {installed ? (
          <span className="pi-ext__installed-mark">
            {tr("piExt.installedMark")}
          </span>
        ) : (
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => reviewCatalogInstall([entry])}
          >
            {tr("piExt.review")}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="settings-section pi-ext">
      <div className="pi-ext__intro">
        <h2 className="settings-page__h2">{tr("piExt.title")}</h2>
        <p>{tr("piExt.description")}</p>
        <p className="settings-row__desc">
          {tr("piExt.config", {
            path: result?.configDir ?? "~/.pi/agent",
          })}
        </p>
      </div>

      <section className="pi-ext__ask" aria-labelledby="pi-ext-ask-title">
        <div>
          <h3 id="pi-ext-ask-title">{tr("piExt.askTitle")}</h3>
          <p>{tr("piExt.askDescription")}</p>
        </div>
        <textarea
          className="settings-input pi-ext__ask-input"
          value={capabilityRequest}
          onChange={(event) => setCapabilityRequest(event.target.value)}
          placeholder={tr("piExt.askPlaceholder")}
          rows={3}
        />
        <div className="pi-ext__ask-action">
          <button
            type="button"
            className="btn btn--solid"
            disabled={!onAskPi || !capabilityRequest.trim()}
            onClick={() => onAskPi?.(capabilityRequest.trim())}
          >
            {tr("piExt.askAction")}
          </button>
        </div>
      </section>

      <section className="pi-ext__native" aria-labelledby="pi-native-title">
        <div className="pi-ext__section-head">
          <div>
            <h3 id="pi-native-title">{tr("piExt.native.title")}</h3>
            <p>{tr("piExt.native.description")}</p>
          </div>
          <span>{tr("piExt.native.ready")}</span>
        </div>
        <div className="pi-ext__native-grid">
          <div>
            <strong>{tr("piExt.native.images.title")}</strong>
            <p>{tr("piExt.native.images.description")}</p>
          </div>
          <div>
            <strong>{tr("piExt.native.handoff.title")}</strong>
            <p>{tr("piExt.native.handoff.description")}</p>
          </div>
        </div>
      </section>

      <section
        className="settings-card pi-ext__foundation"
        aria-labelledby="pi-foundation-title"
      >
        <div className="pi-ext__section-head">
          <div>
            <h3 id="pi-foundation-title">{tr("piExt.foundation.title")}</h3>
            <p>{tr("piExt.foundation.description")}</p>
          </div>
          <div className="pi-ext__foundation-action">
            <span>
              {tr("piExt.foundation.progress", {
                installed: String(
                  PI_FOUNDATION_PACKAGES.length - foundationMissing.length,
                ),
                total: String(PI_FOUNDATION_PACKAGES.length),
              })}
            </span>
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy || foundationMissing.length === 0}
              onClick={() => reviewCatalogInstall(foundationMissing)}
            >
              {foundationMissing.length
                ? tr("piExt.foundation.review")
                : tr("piExt.foundation.complete")}
            </button>
          </div>
        </div>
        <div className="pi-ext__catalog-list">
          {PI_FOUNDATION_PACKAGES.map(renderCatalogRow)}
        </div>
      </section>

      <section aria-labelledby="pi-optional-title">
        <div className="pi-ext__section-head pi-ext__section-head--plain">
          <div>
            <h3 id="pi-optional-title">{tr("piExt.optional.title")}</h3>
            <p>{tr("piExt.optional.description")}</p>
          </div>
        </div>
        <div className="pi-ext__catalog-list pi-ext__catalog-list--separate">
          {PI_PACKAGE_CATALOG.filter(
            (entry) => entry.group === "optional",
          ).map(renderCatalogRow)}
        </div>
      </section>

      <section aria-labelledby="pi-cache-title">
        <div className="pi-ext__section-head pi-ext__section-head--plain">
          <div>
            <h3 id="pi-cache-title">{tr("piExt.cache.title")}</h3>
            <p>{tr("piExt.cache.description")}</p>
          </div>
        </div>
        <div className="pi-ext__catalog-list pi-ext__catalog-list--separate">
          {PI_PACKAGE_CATALOG.filter(
            (entry) => entry.group === "cache",
          ).map(renderCatalogRow)}
        </div>
      </section>

      {pendingInstall.length ? (
        <section
          ref={reviewRef}
          className="settings-card pi-ext__review"
          aria-labelledby="pi-install-review-title"
          aria-live="polite"
        >
          <div>
            <h3 id="pi-install-review-title">{tr("piExt.confirm.title")}</h3>
            <p>{tr("piExt.confirm.description")}</p>
          </div>
          <dl>
            <div>
              <dt>{tr("piExt.confirm.scope")}</dt>
              <dd>
                {local
                  ? tr("piExt.scope.project")
                  : tr("piExt.scope.user")}
              </dd>
            </div>
            <div>
              <dt>{tr("piExt.confirm.runtime")}</dt>
              <dd>{tr("piExt.confirm.runtimeBody")}</dd>
            </div>
          </dl>
          <div className="pi-ext__review-list">
            {pendingInstall.map((candidate) => (
              <div key={`${candidate.id}:${candidate.source}`}>
                <strong>{candidate.title}</strong>
                <code>{candidate.source}</code>
                <span>
                  {tr("piExt.accessLabel")}: {accessText(candidate.access)}
                </span>
                {!candidate.pinned ? (
                  <span className="pi-ext__unpinned">
                    {tr("piExt.confirm.unpinned")}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <div className="pi-ext__review-actions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => setPendingInstall([])}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              disabled={busy}
              onClick={() => void installReviewed()}
            >
              {busy ? tr("piExt.installing") : tr("piExt.confirm.install")}
            </button>
          </div>
        </section>
      ) : null}

      <div className="settings-card pi-ext__install">
        <label className="settings-row__label" htmlFor="pi-package-source">
          {tr("piExt.install")}
        </label>
        <p className="settings-row__desc">{tr("piExt.installDescription")}</p>
        <div className="pi-ext__install-row">
          <input
            id="pi-package-source"
            className="settings-input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") reviewManualInstall();
            }}
            placeholder={tr("piExt.placeholder")}
            autoComplete="off"
          />
          <button
            type="button"
            className="btn btn--solid"
            disabled={busy || !source.trim()}
            onClick={reviewManualInstall}
          >
            {tr("piExt.review")}
          </button>
        </div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={local}
            disabled={!projectPath || busy}
            onChange={(e) => setLocal(e.target.checked)}
          />
          <span>{tr("piExt.projectScope")}</span>
        </label>
        {!projectPath ? (
          <p className="settings-row__desc">{tr("piExt.projectHint")}</p>
        ) : null}
      </div>

      <div className="pi-ext__toolbar">
        <h3>{tr("piExt.installed")}</h3>
        <div>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {tr("common.refresh")}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || !result?.packages.length}
            onClick={() => void update()}
          >
            {tr("piExt.update")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="settings-inline-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="pi-ext__list" aria-busy={busy}>
        {result?.packages.length ? (
          result.packages.map((pkg) => (
            <div
              className="settings-card pi-ext__row"
              key={`${pkg.scope}:${pkg.source}`}
            >
              <div>
                <strong>{pkg.source}</strong>
                <p className="settings-row__desc">
                  {pkg.scope === "project"
                    ? tr("piExt.scope.project")
                    : tr("piExt.scope.user")}
                  {pkg.path ? ` · ${pkg.path}` : ""}
                </p>
                <p className="settings-row__desc pi-ext__integrity">
                  {tr("piExt.manifestStatus")}: {pkg.manifestStatus ?? "unknown"}
                  {pkg.manifestDigest ? (
                    <>
                      {" · "}
                      <code title={pkg.manifestDigest}>
                        {pkg.manifestDigest.slice(0, 19)}…
                      </code>
                    </>
                  ) : null}
                  {pkg.contributions?.nativeCapabilities.length ? (
                    <>
                      {" · "}
                      {tr("piExt.capabilities", {
                        count: String(pkg.contributions.nativeCapabilities.length),
                      })}
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => void remove(pkg)}
              >
                {tr("common.remove")}
              </button>
            </div>
          ))
        ) : (
          <div className="settings-empty">
            {busy ? tr("common.loading") : tr("piExt.empty")}
          </div>
        )}
      </div>

    </div>
  );
}
