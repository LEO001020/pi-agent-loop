export type SpeechEngine = "auto" | "parakeet" | "whisper";

export interface SpeechPreferences {
  engine: SpeechEngine;
  language: string;
}

const STORAGE_KEY = "pi.speech.preferences.v1";

export const DEFAULT_SPEECH_PREFERENCES: SpeechPreferences = {
  engine: "auto",
  language: "auto",
};

export function loadSpeechPreferences(): SpeechPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SPEECH_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<SpeechPreferences>;
    const engine =
      parsed.engine === "parakeet" || parsed.engine === "whisper"
        ? parsed.engine
        : "auto";
    return {
      engine,
      language:
        typeof parsed.language === "string" && parsed.language.trim()
          ? parsed.language
          : "auto",
    };
  } catch {
    return DEFAULT_SPEECH_PREFERENCES;
  }
}

export function saveSpeechPreferences(value: SpeechPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function appendTranscript(draft: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return draft;
  if (!draft.trim()) return text;
  const separator = /\s$/.test(draft) ? "" : " ";
  return `${draft}${separator}${text}`;
}

export function encodeWav(
  chunks: Float32Array[],
  sampleRate: number,
): string {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true,
      );
      offset += 2;
    }
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  const stride = 0x8000;
  for (let index = 0; index < bytes.length; index += stride) {
    binary += String.fromCharCode(...bytes.subarray(index, index + stride));
  }
  return btoa(binary);
}
