import { describe, expect, it } from "vitest";
import {
  aiCreateSeedPrompt,
  extractAutomationPayload,
  looksLikeScheduleIntent,
  parseAutomationConfigJson,
  wrapAutomationSetupAgentText,
} from "./automationSetup";

describe("automationSetup", () => {
  it("seed prompt has no json schema", () => {
    const s = aiCreateSeedPrompt();
    expect(s).not.toMatch(/```/);
    expect(s.toLowerCase()).not.toContain("frequency");
    // Plain guidance: says what to run and how often, without schema wording.
    expect(s.toLowerCase()).toMatch(/how often|what should run/);
  });

  it("wraps user text with silent prefix without user-facing schema words in body only", () => {
    const w = wrapAutomationSetupAgentText("每天 9 点查天气");
    expect(w).toContain("User request:");
    expect(w).toContain("每天 9 点查天气");
    expect(w).toContain("pi-automation");
  });

  it("parses valid fence and strips from display", () => {
    const text = [
      "好的，我会每天早上 9 点查询动态。",
      "",
      "```pi-automation",
      JSON.stringify({
        title: "查 cgnot996",
        prompt: "查询 X 上 @cgnot996 最近动态并摘要",
        frequency: "daily",
        time: "09:00",
        weekdays: [],
        enabled: true,
      }),
      "```",
    ].join("\n");
    const { cleanText, input } = extractAutomationPayload(text);
    expect(cleanText).toContain("每天早上 9 点");
    expect(cleanText).not.toContain("pi-automation");
    expect(cleanText).not.toContain('"title"');
    expect(input?.title).toBe("查 cgnot996");
    expect(input?.frequency).toBe("daily");
    expect(input?.time).toBe("09:00");
    expect(input?.nextRunAt).toBeTruthy();
  });

  it("accepts json fence fallback", () => {
    const text = `确认一下\n\`\`\`json\n{"title":"t","prompt":"p","frequency":"once","time":"20:30","enabled":true}\n\`\`\``;
    const { input, cleanText } = extractAutomationPayload(text);
    expect(input?.title).toBe("t");
    expect(input?.frequency).toBe("once");
    expect(cleanText).toBe("确认一下");
  });

  it("parses real failed-session style fence", () => {
    const text = `好的，已设好。\n\n\`\`\`pi-automation\n{"title":"知识库美女提示词检索","prompt":"在用户的知识库检索","frequency":"once","time":"20:56","weekdays":[],"enabled":true}\n\`\`\``;
    const { input, cleanText } = extractAutomationPayload(text);
    expect(input?.title).toBe("知识库美女提示词检索");
    expect(input?.frequency).toBe("once");
    expect(cleanText).not.toContain("pi-automation");
  });

  it("detects schedule intent", () => {
    expect(
      looksLikeScheduleIntent(
        "过 3 分钟帮我从知识库里找一个关于美女的图片提示词",
      ),
    ).toBe(true);
    expect(looksLikeScheduleIntent("帮我改一下登录按钮颜色")).toBe(false);
  });

  it("rejects incomplete config", () => {
    expect(parseAutomationConfigJson('{"title":"only"}')).toBeNull();
    expect(parseAutomationConfigJson("not json")).toBeNull();
  });
});
