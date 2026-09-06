import { describe, expect, it } from "vitest";
import { isOutsideProject, scopeKey } from "./scopeKey";

describe("scope_key (shipped pure helper)", () => {
  it("uses executable name for shell commands", () => {
    expect(scopeKey("shell", "npm install x")).toBe("shell:npm");
    expect(scopeKey("shell", "cargo test --all")).toBe("shell:cargo");
  });

  it("normalizes fs paths", () => {
    expect(scopeKey("fs.write", "/a//b/c.rs")).toBe("fs.write:/a/b/c.rs");
  });

  it("detects paths outside project", () => {
    expect(isOutsideProject("/Users/me/proj", "/Users/me/proj/src/a.ts")).toBe(false);
    expect(isOutsideProject("/Users/me/proj", "/etc/passwd")).toBe(true);
  });
});
