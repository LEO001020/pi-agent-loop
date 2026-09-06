import { describe, expect, it } from "vitest";
import { connPillForState } from "./connStatus";

describe("connPillForState", () => {
  it("maps ready / streaming / disconnected", () => {
    expect(connPillForState("ready")).toEqual({
      tone: "ok",
      labelKey: "conn.ready",
    });
    expect(connPillForState("streaming")).toEqual({
      tone: "ok",
      labelKey: "conn.streaming",
    });
    expect(connPillForState("disconnected")).toEqual({
      tone: "err",
      labelKey: "conn.disconnected",
    });
  });

  it("treats connecting flag as warn even if state lags", () => {
    expect(connPillForState("idle", true)).toEqual({
      tone: "warn",
      labelKey: "conn.connecting",
    });
  });

  it("maps permission wait", () => {
    expect(connPillForState("awaiting_permission").labelKey).toBe(
      "conn.permission",
    );
  });
});
