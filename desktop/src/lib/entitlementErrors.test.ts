import { describe, expect, it } from "vitest";
import { formatTurnErrorBody } from "./session";

describe("model entitlement errors", () => {
  it("uses the sign-in guidance for unpurchased models", () => {
    expect(
      formatTurnErrorBody({ content: "AccessDenied.Unpurchased: model is not purchased" }, "en"),
    ).toMatch(/auth|sign.?in|credential/i);
  });
});
