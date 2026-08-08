import { describe, expect, it } from "vitest";
import type { AgentId, LandingResult } from "./contract.js";
import { createCliRunner } from "./index.js";
import {
  CONFIRMATION_TOKEN,
  descriptor,
  invocation,
  landing,
  listing,
  marker,
  report,
  rowLines,
  stubPipeline,
} from "./test-support.js";

describe("T-CLI-21 the FR-10 sequence", () => {
  it("lists, previews row 3, then lands row 3 — three runs with no shared state", async () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      descriptor({
        ref: {
          agent: "codex",
          home: "/Users/me/.codex",
          id: `sess-${index + 1}`,
        },
        title: `Session ${index + 1}`,
      }),
    );
    const chosen = rows[2];
    if (chosen === undefined) throw new Error("fixture is missing row 3");

    // 1. /resume-from
    const first = stubPipeline({ listing: listing({ rows }) });
    const listed = await createCliRunner().run(invocation({ argv: [] }), first.pipeline);
    expect(rowLines(listed.stdout)).toHaveLength(10);
    expect(rowLines(listed.stdout)[2]).toContain(chosen.title);

    // 2. /resume-from 3 — a separate run, nothing carried over
    const second = stubPipeline({
      report: report({
        lines: [`From codex ${chosen.ref.id}`, "12 turns cross, 4 dropped"],
      }),
    });
    const previewed = await createCliRunner().run(invocation({ argv: ["3"] }), second.pipeline);
    expect(second.calls.preview[0]?.selection).toEqual({ by: "row", row: 3 });
    expect(previewed.stdout[0]).toBe(`From codex ${chosen.ref.id}`);
    expect(second.calls.commit).toHaveLength(0);
    expect(previewed.exitCode).toBe(0);

    // 3. /resume-from 3 --confirm — a separate run; the pipeline recomputes
    const third = stubPipeline({
      landing: landing({
        ref: {
          agent: "claude-code",
          home: "/Users/me/.claude",
          id: "landed-from-3",
        },
        marker: marker({ sourceSessionId: chosen.ref.id }),
      }),
    });
    const landed = await createCliRunner().run(
      invocation({ argv: ["3", "--confirm", CONFIRMATION_TOKEN] }),
      third.pipeline,
    );
    expect(third.calls.order).toEqual(["preview", "commit"]);
    expect(third.calls.commit[0]?.request.selection).toEqual({
      by: "row",
      row: 3,
    });
    expect(third.calls.commit[0]?.request).toEqual(second.calls.preview[0]);
    expect(landed.stdout.join("\n")).toContain("landed-from-3");
    expect(landed.exitCode).toBe(0);
  });
});

describe("T-CLI-22 the same shape from Codex and from Claude Code", () => {
  async function commitWith(agent: AgentId, result: LandingResult) {
    const { pipeline } = stubPipeline({ landing: result });
    return createCliRunner().run(
      invocation({
        argv: ["1", "--confirm", CONFIRMATION_TOKEN],
        targetAgent: agent,
      }),
      pipeline,
    );
  }

  it("lists the same way from both agents", async () => {
    const rows = [descriptor({ title: "Shared" })];
    const fromCodex = await createCliRunner().run(
      invocation({ targetAgent: "codex" }),
      stubPipeline({ listing: listing({ rows }) }).pipeline,
    );
    const fromClaude = await createCliRunner().run(
      invocation({ targetAgent: "claude-code" }),
      stubPipeline({ listing: listing({ rows }) }).pipeline,
    );

    expect(fromCodex.stdout).toEqual(fromClaude.stdout);
  });

  it("previews the same way from both agents", async () => {
    const lines = ["From codex sess-1", "Budget: 34k of 200k"];
    const fromCodex = await createCliRunner().run(
      invocation({ argv: ["1"], targetAgent: "codex" }),
      stubPipeline({ report: report({ lines }) }).pipeline,
    );
    const fromClaude = await createCliRunner().run(
      invocation({ argv: ["1"], targetAgent: "claude-code" }),
      stubPipeline({ report: report({ lines }) }).pipeline,
    );

    expect(fromCodex.stdout).toEqual(fromClaude.stdout);
  });

  it("differs only in the values the adapter supplied", async () => {
    const codexResult = landing({
      ref: { agent: "codex", home: "/Users/me/.codex", id: "landed-1" },
      handover: { sessionId: "landed-1", command: "codex resume landed-1" },
    });
    const claudeResult = landing({
      ref: { agent: "claude-code", home: "/Users/me/.claude", id: "landed-1" },
      handover: { sessionId: "landed-1", command: "claude --resume landed-1" },
    });

    const fromCodex = await commitWith("codex", codexResult);
    const fromClaude = await commitWith("claude-code", claudeResult);

    expect(fromCodex.stdout).toHaveLength(fromClaude.stdout.length);
    expect(fromCodex.exitCode).toBe(fromClaude.exitCode);

    // Every line that differs carries a value the pipeline supplied, never a
    // different layout: the handover command and the target the adapter named.
    const differing = fromCodex.stdout.filter((line, index) => line !== fromClaude.stdout[index]);
    expect(differing.length).toBeGreaterThan(0);
    for (const line of differing) {
      expect(line.includes("codex")).toBe(true);
    }
    expect(differing.some((line) => line.includes("codex resume landed-1"))).toBe(true);
  });
});

describe("T-CLI-23 a new numbered-list agent needs no change here", () => {
  const fourth = "fixture-agent" as AgentId;

  it("gets the numbered list", async () => {
    const rows = [descriptor({ title: "Fixture session" })];
    const { pipeline, calls } = stubPipeline({ listing: listing({ rows }) });

    const outcome = await createCliRunner().run(invocation({ targetAgent: fourth }), pipeline);

    expect(calls.list[0]?.target.agent).toBe(fourth);
    expect(rowLines(outcome.stdout)).toHaveLength(1);
    expect(outcome.exitCode).toBe(0);
  });

  it("gets the handover with no edit to this module", async () => {
    const { pipeline } = stubPipeline({
      landing: landing({
        ref: { agent: fourth, home: "/Users/me/.fixture", id: "fixture-9" },
        switched: false,
        handover: {
          sessionId: "fixture-9",
          command: "fixture-agent open fixture-9",
        },
      }),
    });

    const outcome = await createCliRunner().run(
      invocation({
        argv: ["1", "--confirm", CONFIRMATION_TOKEN],
        targetAgent: fourth,
      }),
      pipeline,
    );

    expect(outcome.stdout.join("\n")).toContain("fixture-agent open fixture-9");
    expect(outcome.exitCode).toBe(0);
  });
});
