import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConfigLoader } from "./loader.js";
import {
  captureConfigError,
  checksumTree,
  emptyConfigDir,
  removeTempDirs,
  writeConfigFile,
} from "./test-support.js";

afterEach(removeTempDirs);

describe("T-CFG-9 — a malformed file rejects", () => {
  it.each([
    ["truncated JSON", '{ "budgetShare": '],
    ["not JSON at all", "budgetShare = 0.5\n"],
    ["a JSON array", "[1, 2, 3]"],
  ])("rejects %s naming the file and the problem", async (_label, text) => {
    const temp = await writeConfigFile(text);

    const error = await captureConfigError(createConfigLoader({ configPath: temp.path }).load());

    expect(error.field).toBe(temp.path);
    expect(error.message).toContain(temp.path);
    expect(error.message.length).toBeGreaterThan(temp.path.length);
  });

  it("rejects when a path component is a file instead of a directory", async () => {
    const temp = await emptyConfigDir();
    const obstruction = resolve(temp.dir, "not-a-directory");
    const configPath = resolve(obstruction, "config.json");
    await writeFile(obstruction, "occupied", "utf8");

    const error = await captureConfigError(createConfigLoader({ configPath }).load());

    expect(error.field).toBe(configPath);
    expect(error.message).toContain("cannot be read");
    expect(error.message).toContain("not a directory");
  });
});

describe("T-CFG-10 — a budgetShare of exactly 1 is accepted", () => {
  it("keeps the whole window", async () => {
    const temp = await writeConfigFile({ budgetShare: 1 });

    const config = await createConfigLoader({ configPath: temp.path }).load();

    expect(config.budgetShare).toBe(1);
  });
});

describe("T-CFG-11 — a pinnedRecentTurns of 0 is accepted", () => {
  it("keeps zero", async () => {
    const temp = await writeConfigFile({ pinnedRecentTurns: 0 });

    const config = await createConfigLoader({ configPath: temp.path }).load();

    expect(config.pinnedRecentTurns).toBe(0);
  });
});

describe("T-CFG-12 — duplicate homes are not an error", () => {
  it("keeps every entry, including one that repeats an adapter default", async () => {
    const temp = await writeConfigFile({
      extraHomes: [
        { agent: "pi", home: "/opt/pi-home" },
        { agent: "pi", home: "/opt/pi-home" },
        { agent: "claude-code", home: "~/.claude" },
      ],
    });

    const config = await createConfigLoader({ configPath: temp.path }).load();

    expect(config.extraHomes).toEqual([
      { agent: "pi", home: "/opt/pi-home" },
      { agent: "pi", home: "/opt/pi-home" },
      { agent: "claude-code", home: resolve(homedir(), ".claude") },
    ]);
  });
});

describe("T-CFG-13 — this module never writes", () => {
  it("leaves a directory holding a configuration file untouched", async () => {
    const temp = await writeConfigFile({ budgetShare: 0.5 });
    const before = await checksumTree(temp.dir);

    await createConfigLoader({ configPath: temp.path }).load();

    expect(await checksumTree(temp.dir)).toBe(before);
  });

  it("creates nothing when no file exists, not even an empty default", async () => {
    const temp = await emptyConfigDir();
    const before = await checksumTree(temp.dir);

    await createConfigLoader({ configPath: temp.path }).load();

    expect(await checksumTree(temp.dir)).toBe(before);
  });

  it("creates no directory when the whole configuration directory is absent", async () => {
    const temp = await emptyConfigDir();
    const absent = resolve(temp.dir, "never-created", "config.json");
    const before = await checksumTree(resolve(temp.dir, "never-created"));

    await createConfigLoader({ configPath: absent }).load();

    expect(before).toBe("absent");
    expect(await checksumTree(resolve(temp.dir, "never-created"))).toBe("absent");
  });
});
