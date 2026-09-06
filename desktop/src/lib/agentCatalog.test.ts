import { describe, expect, it } from "vitest";
import {
  DEFAULT_EFFORT,
  PI_FALLBACK_EFFORTS,
  effortDisplayLabel,
  effortsForModel,
  isValidEffort,
  pickDefaultEffort,
  type ModelOption,
} from "./agentCatalog";

const modelWithEfforts: ModelOption = {
  id: "pi-4.5",
  label: "Pi 4.5",
  reasoningEfforts: [
    {
      id: "high",
      value: "high",
      label: "High Effort",
      description: "Deep",
      isDefault: true,
    },
    {
      id: "medium",
      value: "medium",
      label: "Medium Effort",
      isDefault: false,
    },
    {
      id: "low",
      value: "low",
      label: "Low Effort",
      isDefault: false,
    },
  ],
};

const modelCustomOnly: ModelOption = {
  id: "custom-model",
  label: "Custom",
  reasoningEfforts: [
    { id: "max", value: "max", label: "Max", isDefault: true },
    { id: "min", value: "min", label: "Min" },
  ],
};

describe("effortsForModel", () => {
  it("returns static fallback when model has no efforts", () => {
    expect(effortsForModel({ id: "x", label: "X" })).toEqual(
      PI_FALLBACK_EFFORTS,
    );
    expect(effortsForModel(null)).toEqual(PI_FALLBACK_EFFORTS);
    expect(effortsForModel(undefined)).toEqual(PI_FALLBACK_EFFORTS);
  });

  it("returns model efforts when non-empty", () => {
    const list = effortsForModel(modelWithEfforts);
    expect(list).toHaveLength(3);
    expect(list[0].id).toBe("high");
    expect(list[0].label).toBe("High Effort");
  });

  it("prefers explicit catalogEfforts arg over model", () => {
    const override = [{ id: "only" }];
    expect(effortsForModel(modelWithEfforts, override)).toEqual(override);
  });
});

describe("isValidEffort", () => {
  it("accepts every Pi thinking level without model", () => {
    expect(isValidEffort("off")).toBe(true);
    expect(isValidEffort("minimal")).toBe(true);
    expect(isValidEffort("low")).toBe(true);
    expect(isValidEffort("medium")).toBe(true);
    expect(isValidEffort("high")).toBe(true);
    expect(isValidEffort("xhigh")).toBe(true);
    expect(isValidEffort("max")).toBe(true);
    expect(isValidEffort("")).toBe(false);
  });

  it("accepts efforts for the selected model when known", () => {
    expect(isValidEffort("high", modelWithEfforts)).toBe(true);
    expect(isValidEffort("max", modelCustomOnly)).toBe(true);
    expect(isValidEffort("min", modelCustomOnly)).toBe(true);
    expect(isValidEffort("medium", modelCustomOnly)).toBe(false);
  });

  it("accepts an efforts array directly", () => {
    expect(isValidEffort("max", modelCustomOnly.reasoningEfforts)).toBe(true);
    expect(isValidEffort("high", modelCustomOnly.reasoningEfforts)).toBe(
      false,
    );
  });
});

describe("pickDefaultEffort", () => {
  it("uses model default flag when present", () => {
    expect(pickDefaultEffort(modelWithEfforts)).toBe("high");
    expect(pickDefaultEffort(modelCustomOnly)).toBe("max");
  });

  it("falls back to medium static default", () => {
    expect(pickDefaultEffort(null)).toBe(DEFAULT_EFFORT);
    expect(pickDefaultEffort({ id: "x", label: "X" })).toBe("medium");
  });
});

describe("effortDisplayLabel", () => {
  it("prefers catalog label", () => {
    expect(
      effortDisplayLabel(
        { id: "high", label: "High Effort" },
        { high: "高" },
      ),
    ).toBe("High Effort");
  });

  it("uses i18n for known ids without catalog label", () => {
    expect(
      effortDisplayLabel("high", {
        high: "High",
        medium: "Medium",
        low: "Low",
      }),
    ).toBe("High");
    expect(effortDisplayLabel({ id: "medium" }, { medium: "中" })).toBe(
      "中",
    );
  });

  it("falls back to raw id", () => {
    expect(effortDisplayLabel("max")).toBe("max");
  });
});
