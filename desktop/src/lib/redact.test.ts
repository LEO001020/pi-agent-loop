import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("scrubs sk- and Bearer tokens", () => {
    const s = redact("key sk-abcdefghijklmnop and Bearer abcdefghijklmnopqr");
    expect(s).toContain("[REDACTED]");
    expect(s).not.toContain("sk-abcdefghijklmnop");
  });
});
