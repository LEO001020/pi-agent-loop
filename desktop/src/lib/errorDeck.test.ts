import { describe, expect, it } from "vitest";
import {
  buildErrorDeck,
  deckCodeFromAgent,
  isReconnectAction,
} from "./errorDeck";

describe("buildErrorDeck", () => {
  it("returns problem/cause/actions for the four product classes (en)", () => {
    const cli = buildErrorDeck("CLI_NOT_FOUND", "en");
    expect(cli.problem.toLowerCase()).toMatch(/cli/);
    expect(cli.cause.length).toBeGreaterThan(8);
    expect(cli.primary.id).toBe("open_doctor");
    expect(cli.secondary?.id).toBe("open_runtime");

    const auth = buildErrorDeck("AUTH_FAILED", "en");
    expect(auth.problem.toLowerCase()).toMatch(/auth|login|key/);
    expect(auth.primary.id).toBe("open_account");

    const net = buildErrorDeck("NETWORK_PROVIDER", "en");
    expect(net.problem.toLowerCase()).toMatch(/network|provider|model/);
    expect(isReconnectAction(net.primary.id)).toBe(true);

    const crash = buildErrorDeck("AGENT_CRASHED", "en");
    expect(crash.problem.toLowerCase()).toMatch(/agent|crash|process/);
    expect(crash.primary.id).toBe("reconnect");
  });

  it("maps timeout / disconnect specials", () => {
    expect(deckCodeFromAgent("NETWORK_PROVIDER", { timeout: true })).toBe(
      "TURN_TIMEOUT",
    );
    expect(deckCodeFromAgent(null, { disconnected: true })).toBe(
      "AGENT_DISCONNECTED",
    );
    expect(deckCodeFromAgent("AUTH_FAILED")).toBe("AUTH_FAILED");
  });
});
