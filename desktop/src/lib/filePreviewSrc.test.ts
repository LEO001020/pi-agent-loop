import { describe, expect, it } from "vitest";
import { pathToFileUrl } from "./filePreviewSrc";

describe("pathToFileUrl", () => {
  it("encodes unix paths with spaces and CJK", () => {
    const u = pathToFileUrl(
      "/Users/me/Documents/AI HOT今日选题报告.html",
    );
    expect(u.startsWith("file:///Users/me/Documents/")).toBe(true);
    expect(u).toContain("AI%20HOT");
    expect(u).toContain("%E4%BB%8A%E6%97%A5"); // 今日
    expect(u.endsWith(".html")).toBe(true);
  });

  it("handles windows drive letters", () => {
    const u = pathToFileUrl("C:/Users/me/report.html");
    expect(u).toBe("file:///C:/Users/me/report.html");
  });
});
