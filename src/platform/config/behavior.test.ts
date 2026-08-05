import { basename, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_BUDGET_SHARE, DEFAULT_PINNED_RECENT_TURNS, defaultConfig } from "./defaults.js";
import { createConfigLoader } from "./loader.js";
import { codeLines, emptyConfigDir, listSourceFiles, removeTempDirs } from "./test-support.js";

afterEach(removeTempDirs);

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_FILE = "defaults.ts";

// T-CFG-14 — answering Q-1 changes one number. The change is a source edit, so what is
// checkable is that there is exactly one place to edit and that every value the loader
// returns comes from it.
describe("T-CFG-14 — answering Q-1 changes one number", () => {
  it("holds the budget-share literal in defaults.ts alone, exactly once", async () => {
    const literal = /(?<![\w.])0\.30?(?![\d])/g;
    const found: string[] = [];

    for (const file of await listSourceFiles(moduleDir, { productionOnly: true })) {
      for (const [number, line] of await codeLines(file)) {
        for (const _match of line.matchAll(literal)) {
          found.push(`${relative(moduleDir, file)}:${number}`);
        }
      }
    }

    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(new RegExp(`^${DEFAULTS_FILE}:`));
  });

  it("restates neither default anywhere else in the module", async () => {
    const restated: string[] = [];

    for (const file of await listSourceFiles(moduleDir, { productionOnly: true })) {
      if (basename(file) === DEFAULTS_FILE) continue;
      for (const [number, line] of await codeLines(file)) {
        if (/(budgetShare|pinnedRecentTurns)\s*[:=]\s*[\d-]/.test(line)) {
          restated.push(`${relative(moduleDir, file)}:${number} ${line.trim()}`);
        }
      }
    }

    expect(restated).toEqual([]);
  });

  it("returns the constants themselves, so one edit moves every import's budget", async () => {
    const temp = await emptyConfigDir();

    const config = await createConfigLoader({ configPath: temp.path }).load();

    expect(config.budgetShare).toBe(DEFAULT_BUDGET_SHARE);
    expect(config.pinnedRecentTurns).toBe(DEFAULT_PINNED_RECENT_TURNS);
    expect(defaultConfig().budgetShare).toBe(DEFAULT_BUDGET_SHARE);
    expect(defaultConfig().pinnedRecentTurns).toBe(DEFAULT_PINNED_RECENT_TURNS);
  });
});
