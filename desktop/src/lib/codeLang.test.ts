import { describe, expect, it } from "vitest";
import { languageFromFileName } from "./codeLang";

describe("languageFromFileName", () => {
  it("maps common extensions", () => {
    expect(languageFromFileName("app.tsx")).toBe("typescript");
    expect(languageFromFileName("index.js")).toBe("javascript");
    expect(languageFromFileName("main.rs")).toBe("rust");
    expect(languageFromFileName("data.json")).toBe("json");
    expect(languageFromFileName("style.css")).toBe("css");
    expect(languageFromFileName("script.py")).toBe("python");
  });

  it("maps special filenames", () => {
    expect(languageFromFileName("Dockerfile")).toBe("dockerfile");
    expect(languageFromFileName("Makefile")).toBe("makefile");
    expect(languageFromFileName("package.json")).toBe("json");
  });

  it("falls back to plaintext", () => {
    expect(languageFromFileName("notes.xyz")).toBe("plaintext");
    expect(languageFromFileName("README")).toBe("plaintext");
  });
});
