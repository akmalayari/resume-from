import { describe, expect, it } from "vitest";
import { REFERENCE_TURNS } from "../../../test/fixtures/reference-session.js";
import type { EstimatorFamily } from "./contract.js";
import { createEstimatorFactory, estimatorFactory } from "./estimator.js";

const FAMILIES: EstimatorFamily[] = ["claude", "gpt", "generic"];

const PARAGRAPH =
  "So far: the refresh call succeeded but the new token was never written back. " +
  "Fixed the write path in src/auth.ts and added a regression test. " +
  "One test still fails: the clock is not injected, so expiry cannot be forced.";

const CODE_BLOCK =
  "export function refresh(clock: Clock): Promise<Token> {\n\n" +
  "  const now = clock.now();\n" +
  "  if (token.expiresAt > now) {\n" +
  "    return token;\n" +
  "  }\n\n" +
  "  return fetchToken().then((t) => store.write(t));\n}\n";

const EMOJI_LINE =
  "\u{1F600}\u{1F389}\u{1F680}\u{1F525}\u{1F4A1}\u{1F4E6}\u{1F9EA}\u{1F440}\u{1F41B}\u{1F527}";
const CJK = "認証トークンの更新が動作するようにしてください。";
const CYRILLIC = "Обновление токена не сохраняется на диск.";
const TOOL_OUTCOME_LINE =
  "Grep('refreshToken', 'src/') -> 7 matches in 3 files (content dropped: imported session, may be stale)";
const JSON_LINE =
  '{"role":"assistant","content":[{"type":"text","text":"hello"}],"usage":{"input_tokens":12}}';
const PROSE_50 = "the quick brown fox jumps over the lazy dog. ".repeat(50);
const PROSE_100KB = "the quick brown fox jumps over the lazy dog. ".repeat(2300);

/**
 * T-TOK-7 corpus. `reference` is the token count the text really has in the gpt family,
 * produced once with gpt-tokenizer's o200k_base encoder over the whole string and frozen
 * here as a literal: a reference the estimator regenerated would assert nothing.
 *
 * The claude family has no public JavaScript tokenizer, so the same counts stand in as its
 * reference too. That proxy is why its documented margin is the wide one — see the accuracy
 * margin in module.md.
 *
 * `script` selects the margin: "ascii" is what a session actually carries (English prose,
 * code, tool outcome lines, JSON); "wide" is emoji-dense or non-Latin text.
 */
const CORPUS: {
  name: string;
  text: string;
  reference: number;
  script: "ascii" | "wide";
}[] = [
  { name: "word", text: "refactor", reference: 2, script: "ascii" },
  {
    name: "sentence",
    text: "The refresh runs but never persists the new token. I'll fix the write path.",
    reference: 16,
    script: "ascii",
  },
  { name: "paragraph", text: PARAGRAPH, reference: 47, script: "ascii" },
  { name: "code", text: CODE_BLOCK, reference: 50, script: "ascii" },
  {
    name: "toolOutcomeLine",
    text: TOOL_OUTCOME_LINE,
    reference: 28,
    script: "ascii",
  },
  { name: "json", text: JSON_LINE, reference: 24, script: "ascii" },
  { name: "prose", text: PROSE_50, reference: 501, script: "ascii" },
  { name: "emoji", text: EMOJI_LINE, reference: 19, script: "wide" },
  { name: "cjk", text: CJK, reference: 15, script: "wide" },
  { name: "cyrillic", text: CYRILLIC, reference: 11, script: "wide" },
];

/** The documented margins of module.md, as numbers. */
const MARGIN = {
  /** The gpt estimate counts a monotone envelope: never under the reference, at most this far over. */
  gptOver: 0.1,
  /** The character heuristic on the text a session actually carries. */
  heuristicAscii: 0.25,
  /** The character heuristic on emoji-dense or non-Latin text. */
  heuristicWide: 1.0,
} as const;

const TEXTS: [name: string, text: string][] = [
  ["word", "refactor"],
  ["paragraph", PARAGRAPH],
  ["code block", CODE_BLOCK],
  ["emoji line", EMOJI_LINE],
  ["100 kB of prose", PROSE_100KB],
];

/** The pieces the random monotonicity walk appends: whitespace runs, scripts, emoji, word stems. */
const ADVERSARIAL = [
  "a",
  " ",
  "  ",
  "\n",
  EMOJI_LINE,
  "日",
  "\t",
  "z",
  "!",
  "  \n  ",
  "def ",
  "()",
  "本",
  "語",
  "\r\n",
  "    ",
  "'",
  "```",
  "élan",
  "the ",
  "x",
  "Обн",
  "اجعل",
  "refre",
  "s",
  "persist",
  " ",
  "\uD800",
  "…",
  "→",
  "\v",
  "\f",
  "0123456789",
  "-".repeat(70),
];

/** xorshift32 — a repeatable walk, so a failure names the text that broke it. */
const seededRandom = (seed: number): ((bound: number) => number) => {
  let state = seed;
  return (bound) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state) % bound;
  };
};

/** 20 steps of appended text, ending far longer than it started. */
const APPEND_STEPS: string[] = [
  "make",
  " the auth token refresh work",
  "\n",
  "\n",
  "  indented continuation",
  "   ",
  "\t",
  "trailing tab then a word",
  "\n\n",
  CJK,
  " ",
  EMOJI_LINE,
  "\r\n",
  CYRILLIC,
  "  \n  ",
  CODE_BLOCK,
  "s",
  "u",
  "ffix",
  PROSE_50,
];

describe.each(FAMILIES)("estimator for the %s family", (family) => {
  const estimator = estimatorFactory.forFamily(family);

  it("T-TOK-1: empty text costs nothing", () => {
    expect(estimator.estimate("")).toBe(0);
  });

  it.each(TEXTS)("T-TOK-2: the estimate of %s is a non-negative whole number", (_name, text) => {
    const count = estimator.estimate(text);
    expect(Number.isInteger(count)).toBe(true);
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("T-TOK-3: the estimate is deterministic", () => {
    const first = estimator.estimate(PARAGRAPH);
    for (let run = 0; run < 100; run++) {
      expect(estimator.estimate(PARAGRAPH)).toBe(first);
    }

    const other = createEstimatorFactory().forFamily(family);
    expect(other.estimate(PARAGRAPH)).toBe(first);
    for (const [, text] of TEXTS) {
      expect(other.estimate(text)).toBe(estimator.estimate(text));
    }
  });

  it("T-TOK-4: the estimate is monotone in length", () => {
    let text = "";
    let previous = estimator.estimate(text);
    for (const step of APPEND_STEPS) {
      text += step;
      const count = estimator.estimate(text);
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it("T-TOK-4: the estimate is monotone character by character", () => {
    const source = `${PARAGRAPH}\n\n  ${CJK}  \n${EMOJI_LINE} ${CYRILLIC}\tend\n\n${CODE_BLOCK}   `;
    let previous = 0;
    for (let end = 0; end <= source.length; end++) {
      const count = estimator.estimate(source.slice(0, end));
      expect(count).toBeGreaterThanOrEqual(previous);
      previous = count;
    }
  });

  it("T-TOK-4: the estimate is monotone over random appends", () => {
    // Encoding dips where tokens merge, and the dips hide in text no fixed table would think
    // to write down. The sequence is seeded, so a failure here is reproducible.
    const random = seededRandom(0x2f6e2b1);
    for (let trial = 0; trial < 40; trial++) {
      let text = "";
      let previous = 0;
      for (let step = 0; step < 60; step++) {
        text += ADVERSARIAL[random(ADVERSARIAL.length)];
        const count = estimator.estimate(text);
        expect(count, `after ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(previous);
        previous = count;
      }
    }
  }, 30_000);
});

describe("the estimator factory", () => {
  it.each(FAMILIES)("T-TOK-5: returns a working estimator for the %s family", (family) => {
    const estimator = estimatorFactory.forFamily(family);

    expect(typeof estimator.estimate).toBe("function");
    expect(estimator.estimate("")).toBe(0);

    let previous = 0;
    for (const [, text] of TEXTS) {
      const count = estimator.estimate(text);
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThan(0);
      expect(estimator.estimate(text)).toBe(count);
      previous = Math.max(previous, count);
    }
    expect(previous).toBeGreaterThan(0);
  });

  it("T-TOK-6: an unknown family falls back to generic", () => {
    const unknown = "klingon" as EstimatorFamily;
    const generic = estimatorFactory.forFamily("generic");

    expect(() => estimatorFactory.forFamily(unknown)).not.toThrow();
    expect(estimatorFactory.forFamily(unknown)).toBe(generic);
    for (const [, text] of TEXTS) {
      expect(estimatorFactory.forFamily(unknown).estimate(text)).toBe(generic.estimate(text));
    }
  });
});

describe("T-TOK-7: the estimate is within the documented margin of a reference count", () => {
  it.each(CORPUS)("gpt: $name", ({ text, reference }) => {
    const count = estimatorFactory.forFamily("gpt").estimate(text);

    expect(count).toBeGreaterThanOrEqual(reference);
    expect(count).toBeLessThanOrEqual(Math.ceil(reference * (1 + MARGIN.gptOver)) + 1);
  });

  it.each(CORPUS)("$script character heuristic: $name", ({ text, reference, script }) => {
    const margin = script === "ascii" ? MARGIN.heuristicAscii : MARGIN.heuristicWide;

    for (const family of ["claude", "generic"] as const) {
      const count = estimatorFactory.forFamily(family).estimate(text);
      expect(count).toBeGreaterThanOrEqual(Math.floor(reference * (1 - margin)));
      expect(count).toBeLessThanOrEqual(Math.ceil(reference * (1 + margin)) + 1);
    }
  });
});

describe("boundary behaviour", () => {
  const HOSTILE: [name: string, text: string][] = [
    ["a lone high surrogate", "\uD800"],
    ["a lone low surrogate", "\uDFFF"],
    ["a reversed surrogate pair", "\uDC00\uD800"],
    ["an unpaired surrogate inside text", `before \uD83D after`],
    ["null bytes", "\0".repeat(1024)],
    ["control characters", "[31m"],
    ["a byte order mark", "﻿text"],
    ["a 10 MB string", "lorem ipsum dolor sit amet\n".repeat(400_000)],
    ["a 10 MB string with no separators", "x".repeat(10_000_000)],
  ];

  it.each(HOSTILE)(
    "T-TOK-9: %s never throws",
    (_name, text) => {
      for (const family of FAMILIES) {
        const estimator = estimatorFactory.forFamily(family);
        let count = -1;
        expect(() => {
          count = estimator.estimate(text);
        }).not.toThrow();
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
      }
    },
    60_000,
  );

  it("T-TOK-10: a tokenizer failure falls back to a UTF-8 byte upper bound", () => {
    const broken = createEstimatorFactory(() => {
      throw new Error("encoder unavailable");
    });

    for (const [, text] of TEXTS) {
      expect(broken.forFamily("gpt").estimate(text)).toBe(Buffer.byteLength(text, "utf8"));
    }
    expect(broken.forFamily("gpt").estimate("")).toBe(0);
  });

  it("charges the GPT tail with a UTF-8 byte upper bound after the exact cutoff", () => {
    const exactPrefix = "x".repeat(262_144);
    const tail = "\0".repeat(128);
    const estimator = estimatorFactory.forFamily("gpt");

    const tailCost = estimator.estimate(exactPrefix + tail) - estimator.estimate(exactPrefix);

    expect(tailCost).toBeGreaterThanOrEqual(Buffer.byteLength(tail, "utf8"));
  });

  it("uses a UTF-8 byte upper bound when the GPT tokenizer fails", () => {
    const broken = createEstimatorFactory(() => {
      throw new Error("encoder unavailable");
    });
    const text = "\0".repeat(128);

    expect(broken.forFamily("gpt").estimate(text)).toBe(Buffer.byteLength(text, "utf8"));
  });
});

describe("T-TOK-12: a budget computed from these estimates is usable", () => {
  /** What a rendered turn costs: its text, or the outcome line of a tool call. */
  const rendered = REFERENCE_TURNS.map((turn) => turn.text || (turn.toolCall?.outcomeLine ?? ""));
  const whole = rendered.join("\n");

  it.each(FAMILIES)("summing %s turn costs stays within the margin of the whole", (family) => {
    const estimator = estimatorFactory.forFamily(family);

    const summed = rendered.reduce((total, text) => total + estimator.estimate(text), 0);
    const atOnce = estimator.estimate(whole);

    expect(summed).toBeGreaterThan(0);
    // One separator plus one rounding step per turn is the whole of the difference.
    expect(Math.abs(summed - atOnce)).toBeLessThanOrEqual(rendered.length);
    expect(Math.abs(summed - atOnce)).toBeLessThanOrEqual(atOnce * 0.1);
  });
});
