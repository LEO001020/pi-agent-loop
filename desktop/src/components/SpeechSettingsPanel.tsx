import { useEffect, useState } from "react";
import { Select } from "@/components/Select";
import * as api from "@/lib/api";
import {
  loadSpeechPreferences,
  saveSpeechPreferences,
  type SpeechEngine,
} from "@/lib/localDictation";
import type { MessageKey, Vars } from "@/i18n";

type T = (key: MessageKey | string, vars?: Vars) => string;

export function SpeechSettingsPanel({ t }: { t: T }) {
  const [preferences, setPreferences] = useState(loadSpeechPreferences);
  const [status, setStatus] = useState<api.SpeechStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<SpeechEngine | null>(null);
  const [error, setError] = useState<string | null>(null);

  const friendlyError = (reason: unknown) => {
    const message = String(reason);
    if (message.includes("SPEECH_UV_MISSING")) return t("speech.uvMissing");
    if (message.includes("SPEECH_UNSUPPORTED")) return t("speech.unsupported");
    return t("speech.installFailed");
  };

  const refresh = () => {
    setLoading(true);
    setError(null);
    void api
      .speechStatus()
      .then(setStatus)
      .catch((reason) => setError(friendlyError(reason)))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const update = (next: typeof preferences) => {
    setPreferences(next);
    saveSpeechPreferences(next);
  };

  const install = (engine: "parakeet" | "whisper") => {
    setInstalling(engine);
    setError(null);
    void api
      .speechInstall(engine)
      .then(setStatus)
      .catch((reason) => setError(friendlyError(reason)))
      .finally(() => setInstalling(null));
  };

  const engineReady =
    !!status?.ffmpegAvailable &&
    (preferences.engine === "auto"
      ? !!status?.parakeetAvailable || !!status?.whisperAvailable
      : preferences.engine === "parakeet"
        ? !!status?.parakeetAvailable
        : !!status?.whisperAvailable);

  return (
    <div className="speech-settings">
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">{t("speech.engine")}</div>
            <div className="settings-row__desc">{t("speech.engineDesc")}</div>
          </div>
          <Select
            value={preferences.engine}
            aria-label={t("speech.engine")}
            onChange={(value) =>
              update({ ...preferences, engine: value as SpeechEngine })
            }
            options={[
              { value: "auto", label: t("speech.engine.auto") },
              { value: "parakeet", label: t("speech.engine.parakeet") },
              { value: "whisper", label: t("speech.engine.whisper") },
            ]}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row__text">
            <div className="settings-row__label">{t("speech.language")}</div>
            <div className="settings-row__desc">{t("speech.languageDesc")}</div>
          </div>
          <Select
            value={preferences.language}
            aria-label={t("speech.language")}
            onChange={(language) => update({ ...preferences, language })}
            options={[
              { value: "auto", label: t("speech.language.auto") },
              { value: "en", label: "English" },
              { value: "it", label: "Italiano" },
              { value: "fr", label: "Français" },
              { value: "de", label: "Deutsch" },
              { value: "es", label: "Español" },
            ]}
          />
        </div>
      </div>

      <h2 className="settings-page__h2">{t("speech.localModels")}</h2>
      <div className="settings-card">
        <div className="speech-engine-row">
          <div>
            <strong>Parakeet</strong>
            <p>{t("speech.parakeetDesc")}</p>
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={
              loading || installing !== null || status?.parakeetAvailable
            }
            onClick={() => install("parakeet")}
          >
            {status?.parakeetAvailable
              ? t("speech.installed")
              : installing === "parakeet"
                ? t("speech.installing")
                : t("speech.install")}
          </button>
        </div>
        <div className="speech-engine-row">
          <div>
            <strong>Whisper</strong>
            <p>{t("speech.whisperDesc")}</p>
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={
              loading || installing !== null || status?.whisperAvailable
            }
            onClick={() => install("whisper")}
          >
            {status?.whisperAvailable
              ? t("speech.installed")
              : installing === "whisper"
                ? t("speech.installing")
                : t("speech.install")}
          </button>
        </div>
      </div>

      <div
        className={"speech-status" + (engineReady ? " is-ready" : "")}
        role="status"
      >
        {loading
          ? t("common.loading")
          : engineReady
            ? t("speech.ready")
            : status && !status.supported
              ? t("speech.unsupported")
              : status && !status.ffmpegAvailable
                ? t("speech.ffmpegMissing")
              : !status?.uvAvailable
                ? t("speech.uvMissing")
                : t("speech.notInstalled")}
      </div>
      {error ? <p className="speech-settings__error">{error}</p> : null}
      <p className="speech-settings__privacy">{t("speech.privacy")}</p>
      <p className="speech-settings__privacy">{t("speech.firstUse")}</p>
    </div>
  );
}
