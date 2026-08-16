import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { AgentId } from "./contract.js";
import { createCliRunner } from "./index.js";
import {
  CONFIRMATION_TOKEN,
  descriptor,
  homeFailure,
  invocation,
  listing,
  REPO_ROOT,
  report,
  rowLines,
  stubPipeline,
} from "./test-support.js";

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));

function moduleFiles(): { name: string; source: string }[] {
  return readdirSync(MODULE_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({
      name,
      source: readFileSync(join(MODULE_DIR, name), "utf8"),
    }));
}

function importSpecifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
  let match = pattern.exec(source);
  while (match !== null) {
    if (match[1] !== undefined) found.push(match[1]);
    match = pattern.exec(source);
  }
  return found;
}

describe("T-CLI-13 nothing is written without the confirmation flag", () => {
  const cases: { name: string; argv: string[] }[] = [
    { name: "no argument", argv: [] },
    { name: "a row", argv: ["2"] },
    { name: "a session ID", argv: ["9f8e7d6c-4b2a"] },
    { name: "a path", argv: ["/Users/me/.codex/sessions/x.jsonl"] },
  ];

  it.each(cases)("$name never commits", async ({ argv }) => {
    const { pipeline, calls } = stubPipeline({
      listing: listing({ rows: [descriptor()] }),
    });

    await createCliRunner().run(invocation({ argv }), pipeline);

    expect(calls.commit).toHaveLength(0);
  });
});

describe("T-CLI-14 a blocked preview cannot be confirmed", () => {
  it("exits 1 and commits nothing", async () => {
    const { pipeline, calls } = stubPipeline({
      report: report({
        blocked: true,
        blockedReason: "The target home is missing",
      }),
    });

    const outcome = await createCliRunner().run(
      invocation({ argv: ["2", "--confirm", CONFIRMATION_TOKEN] }),
      pipeline,
    );

    expect(calls.order).toEqual(["preview"]);
    expect(calls.commit).toHaveLength(0);
    expect(outcome.exitCode).toBe(1);
  });
});

describe("T-CLI-15 malformed arguments fail with a usage message", () => {
  const cases: { name: string; argv: string[]; names: string }[] = [
    { name: "row zero", argv: ["0"], names: "Rows start at 1" },
    { name: "a negative row", argv: ["-3"], names: "Rows start at 1" },
    { name: "a fractional row", argv: ["3.5"], names: "whole number" },
    { name: "--home with no value", argv: ["--home"], names: "--home" },
    { name: "an unknown flag", argv: ["--verbose"], names: "--verbose" },
    {
      name: "an unknown agent name",
      argv: ["--agent", "emacs"],
      names: "emacs",
    },
    {
      name: "--confirm= with a malformed token",
      argv: ["1", "--confirm=not-a-valid-token"],
      names: "--confirm",
    },
  ];

  it.each(cases)("$name exits 2 with a message naming the problem", async ({ argv, names }) => {
    const { pipeline, calls } = stubPipeline();

    const outcome = await createCliRunner().run(invocation({ argv }), pipeline);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toEqual([]);
    expect(outcome.stderr.join("\n")).toContain(names);
    expect(outcome.stderr.join("\n")).toContain("Usage:");
    expect(calls.order).toEqual([]);
  });
});

describe("T-CLI-16 skipped homes are printed", () => {
  it("prints both rows and all three failures", async () => {
    const rows = [descriptor({ title: "First" }), descriptor({ title: "Second" })];
    const failures = [
      homeFailure({
        home: "/Users/me/.pi",
        agent: "pi",
        message: "permission denied",
      }),
      homeFailure({
        home: "/Users/me/.codex",
        agent: "codex",
        message: "not a directory",
      }),
      homeFailure({
        home: "/Users/me/.claude-team",
        agent: "claude-code",
        message: "unreadable index",
      }),
    ];
    const { pipeline } = stubPipeline({ listing: listing({ rows, failures }) });

    const outcome = await createCliRunner().run(invocation(), pipeline);

    expect(rowLines(outcome.stdout)).toHaveLength(2);
    const printed = outcome.stdout.join("\n");
    for (const failure of failures) {
      expect(printed).toContain(failure.home);
      expect(printed).toContain(failure.message);
    }
    expect(outcome.exitCode).toBe(0);
  });
});

describe("T-CLI-17 an empty listing says so", () => {
  it("exits 0 and names the repository", async () => {
    const { pipeline } = stubPipeline({
      listing: listing({ rows: [], failures: [] }),
    });

    const outcome = await createCliRunner().run(invocation(), pipeline);

    expect(outcome.exitCode).toBe(0);
    const printed = outcome.stdout.join("\n");
    expect(printed).toContain(REPO_ROOT);
    expect(printed.toLowerCase()).toContain("no session");
  });
});

describe("T-CLI-18 the target agent is never guessed", () => {
  const agents: AgentId[] = ["pi", "codex", "claude-code"];

  it.each(agents)("uses the stated agent %s whatever the environment says", async (agent) => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/Users/me/.claude-elsewhere");
    vi.stubEnv("CODEX_HOME", "/Users/me/.codex-elsewhere");
    vi.stubEnv("RESUME_FROM_AGENT", agent === "pi" ? "codex" : "pi");
    try {
      const { pipeline, calls } = stubPipeline();

      await createCliRunner().run(invocation({ argv: ["1"], targetAgent: agent }), pipeline);

      expect(calls.preview[0]?.target.agent).toBe(agent);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reads no environment variable at all", () => {
    const sources = moduleFiles().filter((file) => !file.name.endsWith(".test.ts"));
    for (const file of sources) {
      expect(file.source, `${file.name} reads the environment`).not.toMatch(/process\s*\.\s*env/);
    }
  });
});

describe("T-CLI-19 the runtime handle is always null", () => {
  const cases: string[][] = [
    ["1", "--confirm", CONFIRMATION_TOKEN],
    ["9f8e7d6c-4b2a", "--confirm", CONFIRMATION_TOKEN],
    ["/Users/me/.codex/sessions/x.jsonl", "--confirm", CONFIRMATION_TOKEN],
  ];

  it.each(cases)("commits %s with a null runtime", async (...argv) => {
    const { pipeline, calls } = stubPipeline();

    await createCliRunner().run(invocation({ argv }), pipeline);

    expect(calls.commit).toHaveLength(1);
    expect(calls.commit.every((call) => call.runtime === null)).toBe(true);
  });
});

describe("T-CLI-20 no rule lives here", () => {
  it("imports another module only through its contract", () => {
    for (const file of moduleFiles()) {
      for (const specifier of importSpecifiers(file.source)) {
        if (!specifier.includes("../")) continue;
        if (specifier === "../presentation.js") continue;
        expect(specifier, `${file.name} imports ${specifier}`).toMatch(/\/contract\.js$/);
      }
    }
  });

  it("imports no transfer rule and no adapter", () => {
    for (const file of moduleFiles()) {
      for (const specifier of importSpecifiers(file.source)) {
        expect(specifier, `${file.name} imports ${specifier}`).not.toContain("transfer");
        expect(specifier, `${file.name} imports ${specifier}`).not.toContain("adapters");
      }
    }
  });
});
