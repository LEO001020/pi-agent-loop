import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassModal } from "@/components/GlassModal";
import { createT, type Locale, type MessageKey } from "@/i18n";
import * as api from "@/lib/api";
import {
  type PiPackageAccess,
  piPackageIdentity,
} from "@/lib/piPackageCatalog";

type ProviderConnection = {
  id: string;
  name: string;
  packageName: string;
  source: `npm:${string}@${string}`;
  version: string;
  loginProvider: string;
  auth: "oauth" | "api-key";
  descriptionKey:
    | "providerConnect.xai.description"
    | "providerConnect.anthropic.description"
    | "providerConnect.openai.description"
    | "providerConnect.google.description"
    | "providerConnect.kimi.description"
    | "providerConnect.qwen.description"
    | "providerConnect.glm.description"
    | "providerConnect.mimo.description";
  access: PiPackageAccess[];
};

const PROVIDERS: readonly ProviderConnection[] = [
  {
    id: "xai",
    name: "xAI",
    packageName: "pi-xai-oauth",
    source: "npm:pi-xai-oauth@1.4.0",
    version: "1.4.0",
    loginProvider: "xai-auth",
    auth: "oauth",
    descriptionKey: "providerConnect.xai.description",
    access: ["provider", "network", "system"],
  },
  {
    id: "anthropic",
    name: "Claude",
    packageName: "@gotgenes/pi-anthropic-auth",
    source: "npm:@gotgenes/pi-anthropic-auth@2.0.1",
    version: "2.0.1",
    loginProvider: "anthropic",
    auth: "oauth",
    descriptionKey: "providerConnect.anthropic.description",
    access: ["provider", "network", "system"],
  },
  {
    id: "openai",
    name: "OpenAI Codex",
    packageName: "@cortexkit/pi-openai-auth",
    source: "npm:@cortexkit/pi-openai-auth@0.4.3",
    version: "0.4.3",
    loginProvider: "openai-codex",
    auth: "oauth",
    descriptionKey: "providerConnect.openai.description",
    access: ["provider", "network", "system"],
  },
  {
    id: "google",
    name: "Google",
    packageName: "pi-antigravity",
    source: "npm:pi-antigravity@0.2.5",
    version: "0.2.5",
    loginProvider: "antigravity",
    auth: "oauth",
    descriptionKey: "providerConnect.google.description",
    access: ["provider", "network", "system"],
  },
  {
    id: "kimi",
    name: "Kimi",
    packageName: "@zgltyq/pi-provider-kimi-code",
    source: "npm:@zgltyq/pi-provider-kimi-code@0.4.1",
    version: "0.4.1",
    loginProvider: "kimi-coding",
    auth: "oauth",
    descriptionKey: "providerConnect.kimi.description",
    access: ["provider", "network", "system"],
  },
  {
    id: "qwen",
    name: "Qwen",
    packageName: "pi-qwen-provider",
    source: "npm:pi-qwen-provider@1.0.4",
    version: "1.0.4",
    loginProvider: "qwen-ai",
    auth: "oauth",
    descriptionKey: "providerConnect.qwen.description",
    access: ["provider", "network", "system"],
  },
  {
    id: "glm",
    name: "GLM",
    packageName: "@thesethrose/pi-zai-provider",
    source: "npm:@thesethrose/pi-zai-provider@1.0.0",
    version: "1.0.0",
    loginProvider: "zai",
    auth: "api-key",
    descriptionKey: "providerConnect.glm.description",
    access: ["provider", "network", "system"],
  },
  {
    id: "mimo",
    name: "MiMo",
    packageName: "pi-xiaomi-mimo-provider",
    source: "npm:pi-xiaomi-mimo-provider@1.2.0",
    version: "1.2.0",
    loginProvider: "xiaomi-mimo",
    auth: "api-key",
    descriptionKey: "providerConnect.mimo.description",
    access: ["provider", "network", "system"],
  },
] as const;

const ACCESS_KEYS: Record<PiPackageAccess, MessageKey> = {
  conversation: "piExt.access.conversation",
  workspace: "piExt.access.workspace",
  system: "piExt.access.system",
  provider: "piExt.access.provider",
  network: "piExt.access.network",
  browser: "piExt.access.browser",
};

export function ProviderConnectionsPanel({
  locale,
  projectPath,
}: {
  locale: Locale;
  projectPath?: string | null;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [packages, setPackages] = useState<api.PiPackagesResult | null>(null);
  const [selected, setSelected] = useState<ProviderConnection | null>(null);
  const [installed, setInstalled] = useState<ProviderConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!api.isTauri()) {
      setPackages({ packages: [], configDir: "~/.pi/agent" });
      return;
    }
    try {
      setPackages(await api.piPackagesList(projectPath));
    } catch (cause) {
      setError(String(cause));
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const installedSources = useMemo(
    () =>
      new Set(
        (packages?.packages ?? []).map((pkg) => piPackageIdentity(pkg.source)),
      ),
    [packages],
  );

  const install = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.piPackageInstall({
        source: selected.source,
        local: false,
        projectPath,
      });
      setPackages(result);
      setInstalled(selected);
      setSelected(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const copyLogin = async () => {
    if (!installed) return;
    await navigator.clipboard.writeText(`/login ${installed.loginProvider}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <section className="provider-connect" aria-labelledby="provider-connect-title">
      <div className="provider-connect__head">
        <div>
          <h2 id="provider-connect-title" className="settings-page__h2">
            {tr("providerConnect.title")}
          </h2>
          <p className="settings-row__desc">
            {tr("providerConnect.description")}
          </p>
        </div>
      </div>

      {error && (
        <div className="prov-alert" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setError(null)}
          >
            {tr("common.dismiss")}
          </button>
        </div>
      )}

      <div className="provider-connect__list">
        {PROVIDERS.map((provider) => {
          const isInstalled = installedSources.has(
            piPackageIdentity(provider.source),
          );
          return (
            <div className="provider-connect__row" key={provider.id}>
              <div className="provider-connect__identity">
                <strong>{provider.name}</strong>
                <span>
                  {provider.auth === "oauth"
                    ? tr("providerConnect.oauth")
                    : tr("providerConnect.apiKey")}
                </span>
              </div>
              <p>{tr(provider.descriptionKey)}</p>
              <div className="provider-connect__action">
                {isInstalled ? (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    aria-label={tr("providerConnect.configureProvider", {
                      name: provider.name,
                    })}
                    onClick={() => setInstalled(provider)}
                  >
                    {provider.auth === "oauth"
                      ? tr("providerConnect.finishLogin")
                      : tr("providerConnect.configureKey")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    aria-label={tr("providerConnect.reviewProvider", {
                      name: provider.name,
                    })}
                    onClick={() => setSelected(provider)}
                  >
                    {tr("providerConnect.review")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <GlassModal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={tr("providerConnect.reviewTitle", {
          name: selected?.name ?? "",
        })}
        size="md"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setSelected(null)}
              disabled={busy}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--solid"
              onClick={() => void install()}
              disabled={busy}
            >
              {busy
                ? tr("providerConnect.installing")
                : tr("providerConnect.install")}
            </button>
          </>
        }
      >
        {selected && (
          <div className="provider-connect__review">
            <p>{tr(selected.descriptionKey)}</p>
            <dl>
              <dt>{tr("providerConnect.package")}</dt>
              <dd>
                <code>{selected.packageName}@{selected.version}</code>
              </dd>
              <dt>{tr("providerConnect.authentication")}</dt>
              <dd>
                {selected.auth === "oauth"
                  ? tr("providerConnect.oauth")
                  : tr("providerConnect.apiKey")}
              </dd>
              <dt>{tr("piExt.accessLabel")}</dt>
              <dd>
                {selected.access
                  .map((access) => tr(ACCESS_KEYS[access]))
                  .join(" · ")}
              </dd>
            </dl>
            <p className="settings-row__desc">
              {tr("providerConnect.reviewNotice")}
            </p>
          </div>
        )}
      </GlassModal>

      <GlassModal
        open={installed !== null}
        onClose={() => setInstalled(null)}
        title={tr("providerConnect.readyTitle", {
          name: installed?.name ?? "",
        })}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <button
            type="button"
            className="btn btn--solid"
            onClick={() => void copyLogin()}
          >
            {copied
              ? tr("providerConnect.copied")
              : tr("providerConnect.copyLogin")}
          </button>
        }
      >
        <p>
          {tr("providerConnect.readyDescription", {
            command: `/login ${installed?.loginProvider ?? ""}`,
          })}
        </p>
      </GlassModal>
    </section>
  );
}
