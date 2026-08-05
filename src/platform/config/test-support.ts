// Helpers shared by this module's tests. Not production code, so T-CFG-14's count of the
// places a default can be edited skips it.

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConfigError } from "./contract.js";

const created: string[] = [];

export interface TempConfig {
  /** Absolute, symlink-free path of a throwaway configuration directory. */
  dir: string;
  /** Absolute path of config.json inside it, whether or not the file exists. */
  path: string;
}

/** A throwaway directory with no configuration file in it. */
export async function emptyConfigDir(): Promise<TempConfig> {
  // realpath because macOS resolves os.tmpdir() through a symlink, and the loader
  // returns realpathed homes; comparing raw temp paths would fail for no good reason.
  const dir = await realpath(await mkdtemp(join(tmpdir(), "resume-from-config-")));
  created.push(dir);
  return { dir, path: join(dir, "config.json") };
}

/** A throwaway directory holding one configuration file. */
export async function writeConfigFile(
  content: string | Record<string, unknown>,
): Promise<TempConfig> {
  const temp = await emptyConfigDir();
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  await writeFile(temp.path, text, "utf8");
  return temp;
}

export async function removeTempDirs(): Promise<void> {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

/** Awaits a load that must reject, and returns the ConfigError it rejected with. */
export async function captureConfigError(run: Promise<unknown>): Promise<ConfigError> {
  try {
    await run;
  } catch (err) {
    return err as ConfigError;
  }
  throw new Error("expected the load to reject with a ConfigError, but it resolved");
}

/** sha256 over every path and file body under dir. An absent directory hashes to "absent". */
export async function checksumTree(dir: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (current: string, prefix: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const label = `${prefix}/${entry.name}`;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`d ${label}\n`);
        await walk(full, label);
      } else {
        hash.update(`f ${label} ${await readFile(full, "utf8")}\n`);
      }
    }
  };
  try {
    await walk(dir, "");
  } catch {
    return "absent";
  }
  return hash.digest("hex");
}

function isTestCode(name: string): boolean {
  return (
    name.endsWith(".test.ts") ||
    name === "test-support.ts" ||
    name === "fixtures.ts" ||
    name.endsWith(".fixture.ts") ||
    name.endsWith(".fixtures.ts")
  );
}

/**
 * Every .ts file under root. `productionOnly` drops tests, fixtures and test support:
 * T-CFG-8 and T-CFG-14 both count the places a production value can be edited, and an
 * assertion that names the value is not one of them.
 */
export async function listSourceFiles(
  root: string,
  { productionOnly = false }: { productionOnly?: boolean } = {},
): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") await walk(full);
      } else if (entry.name.endsWith(".ts") && !(productionOnly && isTestCode(entry.name))) {
        found.push(full);
      }
    }
  };
  await walk(root);
  return found.sort();
}

/** Lines of a source file that carry code, paired with their 1-based number. */
export async function codeLines(file: string): Promise<Array<[number, string]>> {
  const text = await readFile(file, "utf8");
  return text
    .split("\n")
    .map((line, index): [number, string] => [index + 1, line])
    .filter(([, line]) => {
      const trimmed = line.trim();
      return !(
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*") ||
        trimmed === ""
      );
    });
}
