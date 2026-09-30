import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test.each(["shims/claude-code/commands/resume-from.md", "shims/codex/prompts/resume-from.md"])(
  "%s preserves worktree diagnostics and user confirmation",
  async (path) => {
    const text = await readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
    for (const required of [
      "Start the destination agent in the directory whose files you intend to edit",
      "nested, sibling, or in an arbitrary external directory",
      "--home",
      "historical paths alone",
      "Destination:",
      "selection diagnostics",
      "transfer uncommitted work, switch branches, or recreate removed",
      "exactly as printed",
      "Never add `--confirm`",
      "same destination directory",
    ]) {
      expect(text).toContain(required);
    }
    expect(text).toContain("shell-quoted argv item after `--`");
    expect(text).not.toMatch(/(?:node|npx).*\$ARGUMENTS/u);
  },
);
