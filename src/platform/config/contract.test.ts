import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ImportConfig } from "./contract.js";
import { createConfigLoader } from "./loader.js";
import {
  captureConfigError,
  codeLines,
  emptyConfigDir,
  listSourceFiles,
  removeTempDirs,
  writeConfigFile,
} from "./test-support.js";

afterEach(removeTempDirs);

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "..", "..", "..");

describe("T-CFG-6 — every field is always present", () => {
  const cases: Array<[string, () => Promise<string>]> = [
    ["an absent file", async () => (await emptyConfigDir()).path],
    ["an empty file", async () => (await writeConfigFile("")).path],
    [
      "a file with every field set",
      async () =>
        (
          await writeConfigFile({
            extraHomes: [{ agent: "pi", home: "/opt/pi-home" }],
            budgetShare: 0.4,
            pinnedRecentTurns: 7,
            windowOverrides: [{ agent: "codex", windowTokens: 200000 }],
          })
        ).path,
    ],
  ];

  it.each(cases)("fills all four fields for %s", async (_label, makePath) => {
    const config: ImportConfig = await createConfigLoader({ configPath: await makePath() }).load();

    expect(Array.isArray(config.extraHomes)).toBe(true);
    expect(Array.isArray(config.windowOverrides)).toBe(true);
    expect(typeof config.budgetShare).toBe("number");
    expect(typeof config.pinnedRecentTurns).toBe("number");
    for (const entry of config.extraHomes) {
      expect(typeof entry.agent).toBe("string");
      expect(typeof entry.home).toBe("string");
    }
    for (const entry of config.windowOverrides) {
      expect(typeof entry.agent).toBe("string");
      expect(typeof entry.windowTokens).toBe("number");
    }
  });
});

describe("T-CFG-7 — an invalid value rejects with the field named", () => {
  it.each([
    ["budgetShare of 0", { budgetShare: 0 }, "budgetShare"],
    ["budgetShare above 1", { budgetShare: 1.5 }, "budgetShare"],
    ["a negative budgetShare", { budgetShare: -0.1 }, "budgetShare"],
    ["budgetShare as a string", { budgetShare: "0.5" }, "budgetShare"],
    ["a negative pinnedRecentTurns", { pinnedRecentTurns: -1 }, "pinnedRecentTurns"],
    ["a fractional pinnedRecentTurns", { pinnedRecentTurns: 2.5 }, "pinnedRecentTurns"],
    [
      "an extra home with an unknown agent",
      { extraHomes: [{ agent: "emacs", home: "/opt/home" }] },
      "extraHomes[0].agent",
    ],
    ["an unknown setting", { budgetShar: 0.5 }, "budgetShar"],
  ])("rejects %s", async (_label, content, field) => {
    const temp = await writeConfigFile(content as Record<string, unknown>);

    const error = await captureConfigError(createConfigLoader({ configPath: temp.path }).load());

    expect(error.field).toBe(field);
    expect(error.message).toContain(field);
    expect(error.message.length).toBeGreaterThan(field.length);
  });
});

describe("T-CFG-8 — the defaults live here and nowhere else", () => {
  const scanned = ["src/import", "src/adapters", "src/host"];
  const budgetShareLiteral = /(?<![\w.])0\.30?(?![\d])/;
  // A default is restated by giving the setting a number, not by naming it: passing
  // configOf(1, pinnedRecentTurns) restates nothing.
  const defaultRestated = /(budgetShare|pinnedRecentTurns)"?\s*[:=]\s*[\d-]/;

  it.each(scanned)("finds no default value in %s", async (folder) => {
    // Production sources only. T-CFG-14 expects the suite to keep passing "except the
    // assertions that name the number", so an assertion may use 0.3 as an input; what must
    // not exist is a second production place to edit when FR-30 changes.
    const files = await listSourceFiles(resolve(repoRoot, folder), { productionOnly: true });
    const offences: string[] = [];

    for (const file of files) {
      for (const [number, line] of await codeLines(file)) {
        const where = `${relative(repoRoot, file)}:${number}`;
        if (budgetShareLiteral.test(line))
          offences.push(`${where} budget share literal: ${line.trim()}`);
        else if (defaultRestated.test(line))
          offences.push(`${where} default restated: ${line.trim()}`);
      }
    }

    expect(offences).toEqual([]);
  });
});
