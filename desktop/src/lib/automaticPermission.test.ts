import { describe, expect, it } from "vitest";
import {
  automaticPermissionButton,
  type MappedPermButton,
} from "./permissionOptions";

const buttons: MappedPermButton[] = [
  { decision: "allow_once", optionId: "once", label: "Allow once" },
  { decision: "allow_session", optionId: "session", label: "Allow for session" },
  { decision: "deny", optionId: "deny", label: "Deny" },
];

describe("automaticPermissionButton", () => {
  it("uses the persistent option for full access", () => {
    expect(automaticPermissionButton(buttons, "always_approve")?.optionId).toBe("session");
  });

  it("uses deny for dont ask", () => {
    expect(automaticPermissionButton(buttons, "dont_ask")?.optionId).toBe("deny");
  });
});
