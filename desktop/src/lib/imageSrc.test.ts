import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearImageSrcCache,
  isViewableSrc,
  resolveImageSrcSync,
} from "./imageSrc";

describe("isViewableSrc", () => {
  it("accepts http(s), data, blob, asset, media", () => {
    expect(isViewableSrc("https://example.com/a.png")).toBe(true);
    expect(isViewableSrc("http://example.com/a.png")).toBe(true);
    expect(isViewableSrc("data:image/png;base64,xx")).toBe(true);
    expect(isViewableSrc("blob:http://localhost/1")).toBe(true);
    expect(isViewableSrc("asset://localhost/foo")).toBe(true);
    expect(isViewableSrc("media://localhost/foo")).toBe(true);
    expect(isViewableSrc("https://media.localhost/foo")).toBe(true);
  });

  it("rejects bare paths", () => {
    expect(isViewableSrc("/Users/me/pic.png")).toBe(false);
    expect(isViewableSrc("C:\\Users\\me\\pic.png")).toBe(false);
  });
});

describe("resolveImageSrcSync", () => {
  afterEach(() => {
    clearImageSrcCache();
    vi.unstubAllGlobals();
  });

  it("passes through already-viewable URLs without caching side effects", () => {
    expect(resolveImageSrcSync("https://cdn.example/a.jpg")).toBe(
      "https://cdn.example/a.jpg",
    );
    expect(resolveImageSrcSync("media://localhost/x")).toBe(
      "media://localhost/x",
    );
  });

  it("returns null for empty / relative / ellipsis paths", () => {
    expect(resolveImageSrcSync("")).toBe(null);
    expect(resolveImageSrcSync("images/1.jpg")).toBe(null);
    expect(resolveImageSrcSync(".../foo/bar.png")).toBe(null);
  });

  it("returns null for absolute paths outside Tauri (no flash retry loop)", () => {
    // isTauri() is false in vitest — path must not throw, must resolve once.
    const a = resolveImageSrcSync("/Users/me/pic.png");
    const b = resolveImageSrcSync("/Users/me/pic.png");
    expect(a).toBe(null);
    expect(b).toBe(null);
  });
});
