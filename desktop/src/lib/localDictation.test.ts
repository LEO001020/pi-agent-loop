import { describe, expect, it } from "vitest";
import { appendTranscript, encodeWav } from "./localDictation";

describe("local dictation helpers", () => {
  it("appends editable transcription without collapsing existing text", () => {
    expect(appendTranscript("", "  hello  ")).toBe("hello");
    expect(appendTranscript("Fix this", "please")).toBe("Fix this please");
    expect(appendTranscript("Fix this ", "please")).toBe("Fix this please");
  });

  it("encodes mono PCM as a valid WAV payload", () => {
    const encoded = encodeWav([new Float32Array([0, 0.5, -0.5])], 16_000);
    const bytes = Buffer.from(encoded, "base64");
    expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString()).toBe("WAVE");
    expect(bytes.readUInt32LE(24)).toBe(16_000);
    expect(bytes.readUInt32LE(40)).toBe(6);
  });
});
