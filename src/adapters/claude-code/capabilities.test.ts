import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "./adapter.js";
import { claudeCodeAdapter } from "./index.js";

describe("T-CC-1 — capabilities are as designed", () => {
  const adapter = createClaudeCodeAdapter({ env: {}, homeDir: "/home/testuser", cwd: "/repo" });
  const caps = adapter.capabilities();

  it("declares the agent, both roles, and the two levels C-1 and C-2 fixed", () => {
    expect(caps.agent).toBe("claude-code");
    expect([...caps.roles].sort()).toEqual(["source", "target"]);
    expect(caps.selection).toBe("numbered-list");
    expect(caps.landing).toBe("create-only");
    expect(caps.provenance).toBe("out-of-context-entry");
  });

  it("declares an absolute default home and a positive window", () => {
    expect(path.isAbsolute(caps.defaultHome)).toBe(true);
    expect(caps.defaultHome).toBe(path.join("/home/testuser", ".claude"));
    expect(caps.defaultWindowTokens).toBeGreaterThan(0);
  });

  it("is pure and stable across calls", () => {
    for (let i = 0; i < 100; i++) {
      expect(adapter.capabilities()).toEqual(caps);
    }
  });

  it("recognises a non-default home named by CLAUDE_CONFIG_DIR (FR-2, FR-4)", () => {
    const team = createClaudeCodeAdapter({
      env: { CLAUDE_CONFIG_DIR: "/home/testuser/.claude-team" },
      homeDir: "/home/testuser",
      cwd: "/repo",
    });
    expect(team.capabilities().defaultHome).toBe("/home/testuser/.claude-team");
  });

  it("is reachable through the factory, the module's only export (FR-57)", () => {
    expect(claudeCodeAdapter.create().capabilities().agent).toBe("claude-code");
  });
});
