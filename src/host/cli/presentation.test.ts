import { describe, expect, it } from "vitest";
import { safeLines, safeText } from "./presentation.js";

describe("terminal presentation safety", () => {
  it.each([
    ["line breaks", "before\r\nafter", "before  after"],
    ["ANSI CSI", "before\u001b[31mred\u001b[0mafter", "before red after"],
    ["ANSI OSC", "before\u001b]0;owned\u0007after", "before after"],
    ["bidi controls", "left\u202eright", "left right"],
    ["C1 controls", "left\u0085right", "left right"],
  ])("neutralizes %s", (_name, source, expected) => {
    expect(safeText(source)).toBe(expected);
  });

  it("preserves printable Unicode and line identity", () => {
    expect(safeLines(["שלום", "Привет", "日本語"])).toEqual(["שלום", "Привет", "日本語"]);
  });
});
