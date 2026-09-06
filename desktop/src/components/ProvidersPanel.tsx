/**
 * Settings → Providers & Models.
 * Left list + right detail/form.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import * as api from "@/lib/api";
import { createT, type Locale } from "@/i18n";
import { Select } from "@/components/Select";
import { GlassModal } from "@/components/GlassModal";
import {
  IconCheck,
  IconClose,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@/components/icons";

export interface ProvidersPanelProps {
  locale: Locale;
  /** Official OAuth / CLI auth / official API key present. */
  officialAvailable?: boolean;
  /** Called after switching official/custom so host can reconnect Pi. */
  onProviderActivated?: () => void;
}

type FormState = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiBackend: string;
  setAsDefault: boolean;
};

type RightMode = "empty" | "create" | "edit" | "official";
type Selection = null | "official" | string;

const emptyForm = (): FormState => ({
  id: "",
  name: "",
  baseUrl: "",
  model: "",
  apiKey: "",
  apiBackend: "responses",
  setAsDefault: true,
});

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function ProvidersPanel({
  locale,
  officialAvailable = true,
  onProviderActivated,
}: ProvidersPanelProps) {
  const tr = useMemo(() => createT(locale), [locale]);
  const [list, setList] = useState<api.ProvidersListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [rightMode, setRightMode] = useState<RightMode>("empty");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [hintTone, setHintTone] = useState<"ok" | "err" | "muted">("muted");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const protocolOptions = useMemo(
    () => [
      { value: "responses", label: tr("prov.protocol.responses") },
      {
        value: "chat_completions",
        label: tr("prov.protocol.chatCompletions"),
      },
      { value: "messages", label: tr("prov.protocol.messages") },
    ],
    [tr],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!api.isTauri()) {
        setList({
          providers: [],
          defaultModel: null,
          activeSource: "official",
          activeProviderId: null,
          configPath: "",
          agentHome: "",
        });
        return;
      }
      const r = await api.providersList();
      setList(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Drop official selection if auth disappears.
  useEffect(() => {
    if (!officialAvailable && selection === "official") {
      setSelection(null);
      setRightMode("empty");
    }
  }, [officialAvailable, selection]);

  const providers = list?.providers ?? [];
  const activeSource = list?.activeSource ?? "official";
  const activeProviderId = list?.activeProviderId ?? null;
  const officialActive = activeSource === "official";

  const openCreate = () => {
    setSelection(null);
    setEditingId(null);
    setForm(emptyForm());
    setRemoteModels([]);
    setHint(null);
    setShowKey(false);
    setRightMode("create");
  };

  const openOfficial = () => {
    if (!officialAvailable) return;
    setSelection("official");
    setEditingId(null);
    setRightMode("official");
    setHint(null);
  };

  const openEdit = (p: api.CustomProvider) => {
    setSelection(p.id);
    setEditingId(p.id);
    setForm({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      apiKey: "",
      apiBackend: p.apiBackend || "responses",
      setAsDefault: p.isDefault,
    });
    setRemoteModels([]);
    setHint(null);
    setShowKey(false);
    setRightMode("edit");
  };

  const closeRight = () => {
    setRightMode("empty");
    setSelection(null);
    setEditingId(null);
    setHint(null);
    setRemoteModels([]);
  };

  const save = async () => {
    if (!form.baseUrl.trim()) {
      setHint(tr("prov.err.needBase"));
      setHintTone("err");
      return;
    }
    if (!editingId && !form.apiKey.trim()) {
      setHint(tr("prov.err.needKey"));
      setHintTone("err");
      return;
    }
    setBusy(true);
    setHint(tr("prov.saving"));
    setHintTone("muted");
    try {
      const id =
        editingId ??
        (slugify(form.id || form.name || form.baseUrl) ||
          `provider-${Date.now().toString(36)}`);
      const r = await api.providersUpsert({
        id,
        model: form.model.trim() || id,
        baseUrl: form.baseUrl.trim(),
        name: form.name.trim() || id,
        apiKey: form.apiKey.trim() || undefined,
        apiBackend: form.apiBackend,
        setAsDefault: form.setAsDefault,
        createOnly: !editingId,
      });
      setList(r);
      const saved = r.providers.find((p) => p.id === id);
      if (saved) {
        openEdit(saved);
      } else {
        setRightMode("empty");
        setSelection(null);
      }
      setHint(null);
      if (form.setAsDefault) {
        onProviderActivated?.();
      }
    } catch (e) {
      setHint(String(e));
      setHintTone("err");
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async () => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    setBusy(true);
    setDeleteTarget(null);
    try {
      const r = await api.providersRemove(id);
      setList(r);
      if (editingId === id || selection === id) {
        closeRight();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const activateOfficial = async (e?: MouseEvent) => {
    e?.stopPropagation();
    setBusy(true);
    try {
      const r = await api.providersActivate("official");
      setList(r);
      onProviderActivated?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const activateCustom = async (id: string, e?: MouseEvent) => {
    e?.stopPropagation();
    setBusy(true);
    try {
      const r = await api.providersActivate("custom", id);
      setList(r);
      onProviderActivated?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async () => {
    if (!form.baseUrl.trim()) {
      setHint(tr("prov.err.needBase"));
      setHintTone("err");
      return;
    }
    setHint(tr("prov.fetching"));
    setHintTone("muted");
    try {
      const r = await api.providersListModels({
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim() || undefined,
        providerId: editingId ?? undefined,
      });
      setRemoteModels(r.models.map((m) => m.id));
      if (r.models.length) {
        setHint(tr("prov.loaded", { n: r.models.length }));
        setHintTone("ok");
        if (!form.model && r.models[0]?.id) {
          setForm((f) => ({ ...f, model: r.models[0].id }));
        }
      } else {
        setHint(tr("prov.emptyList"));
        setHintTone("muted");
      }
    } catch (e) {
      setHint(String(e));
      setHintTone("err");
    }
  };

  if (loading) {
    return (
      <div className="prov-panel" data-testid="providers-panel">
        <div className="prov-loading">{tr("prov.loading")}</div>
      </div>
    );
  }

  const listEmpty = !officialAvailable && providers.length === 0;

  return (
    <div className="prov-panel" data-testid="providers-panel">
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

      <div
        className={
          "prov-split" + (rightMode === "empty" ? " is-idle" : "")
        }
      >
        {/* ── Left: list ───────────────────────────────────────────── */}
        <aside className="prov-split__list">
          <button
            type="button"
            className="btn btn--solid prov-add-btn"
            onClick={openCreate}
            disabled={busy}
          >
            <IconPlus size={16} />
            {tr("prov.new")}
          </button>

          <div className="prov-rail" role="list">
            {officialAvailable && (
              <div
                role="listitem"
                className={
                  "prov-item" +
                  (selection === "official" ? " is-selected" : "") +
                  (officialActive ? " is-active" : "")
                }
              >
                <button
                  type="button"
                  className="prov-item__main"
                  onClick={openOfficial}
                >
                  <span className="prov-item__text">
                    <span className="prov-item__name">
                      {tr("prov.officialName")}
                    </span>
                  </span>
                </button>
                {!officialActive ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm prov-item__use"
                    disabled={busy}
                    onClick={(e) => void activateOfficial(e)}
                  >
                    {tr("prov.useThis")}
                  </button>
                ) : (
                  <span
                    className="prov-item__using"
                    title={tr("prov.active")}
                    aria-label={tr("prov.active")}
                  >
                    <IconCheck size={14} />
                  </span>
                )}
              </div>
            )}

            {providers.map((p) => {
              const active =
                activeSource === "custom" && activeProviderId === p.id;
              const selected = selection === p.id;
              return (
                <div
                  key={p.id}
                  role="listitem"
                  className={
                    "prov-item" +
                    (selected ? " is-selected" : "") +
                    (active ? " is-active" : "")
                  }
                >
                  <button
                    type="button"
                    className="prov-item__main"
                    onClick={() => openEdit(p)}
                  >
                    <span className="prov-item__text">
                      <span className="prov-item__name">{p.name || p.id}</span>
                      <span className="prov-item__sub">
                        {hostOf(p.baseUrl)}
                        {p.model ? ` · ${p.model}` : ""}
                      </span>
                    </span>
                  </button>
                  {!active ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm prov-item__use"
                      disabled={busy}
                      onClick={(e) => void activateCustom(p.id, e)}
                    >
                      {tr("prov.useThis")}
                    </button>
                  ) : (
                    <span
                      className="prov-item__using"
                      title={tr("prov.active")}
                      aria-label={tr("prov.active")}
                    >
                      <IconCheck size={14} />
                    </span>
                  )}
                </div>
              );
            })}

            {listEmpty && (
              <div className="prov-rail-empty">{tr("prov.emptyTitle")}</div>
            )}
          </div>
        </aside>

        {/* ── Right: detail / form ─────────────────────────────────── */}
        <section className="prov-split__detail">
          {rightMode === "empty" && (
            <div className="prov-detail-empty">
              <p>{tr("prov.detailEmpty")}</p>
            </div>
          )}

          {rightMode === "official" && (
            <div className="prov-detail settings-card">
              <div className="prov-detail__head">
                <div>
                  <h3 className="prov-detail__title">
                    {tr("prov.officialName")}
                  </h3>
                  <p className="prov-detail__sub">
                    {tr("prov.officialDesc")}
                  </p>
                </div>
                {officialActive ? (
                  <span className="account-badge account-badge--ok">
                    {tr("prov.active")}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--solid"
                    disabled={busy}
                    onClick={() => void activateOfficial()}
                  >
                    {tr("prov.useThis")}
                  </button>
                )}
              </div>
            </div>
          )}

          {(rightMode === "create" || rightMode === "edit") && (
            <div
              className="prov-detail settings-card prov-form"
              data-testid="provider-form"
            >
              <div className="prov-form__head">
                <h3 className="prov-detail__title">
                  {editingId ? tr("prov.editTitle") : tr("prov.addTitle")}
                </h3>
                <button
                  type="button"
                  className="chrome-btn"
                  onClick={closeRight}
                  aria-label={tr("common.close")}
                >
                  <IconClose size={16} />
                </button>
              </div>

              <div className="prov-form__grid">
                <label className="prov-field">
                  <span className="prov-field__label">{tr("prov.name")}</span>
                  <input
                    className="settings-input"
                    value={form.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((f) => ({
                        ...f,
                        name,
                        id: editingId ? f.id : slugify(name) || f.id,
                      }));
                    }}
                    placeholder={tr("prov.namePh")}
                    autoComplete="off"
                  />
                </label>

                {!editingId && (
                  <label className="prov-field">
                    <span className="prov-field__label">
                      {tr("prov.displayName")}
                    </span>
                    <input
                      className="settings-input"
                      value={form.id}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          id: slugify(e.target.value),
                        }))
                      }
                      placeholder={tr("prov.idPh")}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                )}

                <label className="prov-field prov-field--full">
                  <span className="prov-field__label">{tr("prov.baseUrl")}</span>
                  <input
                    className="settings-input"
                    value={form.baseUrl}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, baseUrl: e.target.value }))
                    }
                    placeholder={tr("prov.baseUrlPh")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>

                <div className="prov-field">
                  <span className="prov-field__label">{tr("prov.protocol")}</span>
                  <Select
                    value={form.apiBackend}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, apiBackend: v }))
                    }
                    options={protocolOptions}
                    aria-label={tr("prov.protocol")}
                  />
                </div>

                <label className="prov-field">
                  <span className="prov-field__label">{tr("prov.apiKey")}</span>
                  <div className="prov-key-row">
                    <input
                      className="settings-input"
                      type={showKey ? "text" : "password"}
                      value={form.apiKey}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, apiKey: e.target.value }))
                      }
                      placeholder={
                        editingId ? tr("prov.keyKeep") : tr("prov.keyPh")
                      }
                      autoComplete="new-password"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setShowKey((v) => !v)}
                    >
                      {showKey ? tr("prov.keyHide") : tr("prov.keyShow")}
                    </button>
                  </div>
                </label>

                <label className="prov-field prov-field--full">
                  <span className="prov-field__label-row">
                    <span className="prov-field__label">
                      {tr("prov.requestModel")}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void fetchModels()}
                      disabled={busy}
                    >
                      <IconRefresh size={14} />
                      {tr("prov.fetchModels")}
                    </button>
                  </span>
                  <input
                    className="settings-input"
                    value={form.model}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, model: e.target.value }))
                    }
                    placeholder={tr("prov.modelPh")}
                    list="prov-model-suggestions"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <datalist id="prov-model-suggestions">
                    {remoteModels.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </label>
              </div>

              <label className="prov-check">
                <input
                  type="checkbox"
                  checked={form.setAsDefault}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      setAsDefault: e.target.checked,
                    }))
                  }
                />
                <span className="prov-check__title">
                  {tr("prov.setDefault")}
                </span>
              </label>

              {hint && (
                <div
                  className={
                    "prov-form__hint" +
                    (hintTone === "ok"
                      ? " is-ok"
                      : hintTone === "err"
                        ? " is-err"
                        : "")
                  }
                >
                  {hint}
                </div>
              )}

              <div className="prov-form__actions">
                {editingId && (
                  <button
                    type="button"
                    className="btn btn--danger"
                    disabled={busy}
                    onClick={() =>
                      setDeleteTarget({
                        id: editingId,
                        name: form.name || editingId,
                      })
                    }
                  >
                    <IconTrash size={14} />
                    {tr("prov.delete")}
                  </button>
                )}
                <div className="prov-form__actions-end">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={closeRight}
                    disabled={busy}
                  >
                    {tr("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="btn btn--solid"
                    onClick={() => void save()}
                    disabled={busy}
                  >
                    {editingId ? (
                      <>
                        <IconEdit size={14} />
                        {tr("prov.save")}
                      </>
                    ) : (
                      <>
                        <IconPlus size={14} />
                        {tr("prov.add")}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <GlassModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={tr("prov.delete")}
        size="sm"
        closeLabel={tr("common.close")}
        footer={
          <>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setDeleteTarget(null)}
            >
              {tr("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void confirmRemove()}
            >
              {tr("prov.delete")}
            </button>
          </>
        }
      >
        <p className="prov-delete-msg">
          {tr("prov.confirmDelete", {
            id: deleteTarget?.name || deleteTarget?.id || "",
          })}
        </p>
      </GlassModal>
    </div>
  );
}
