// T-STO-15 — a static check of this module's imports. The `src/platform/` boundary rule says this
// module knows nothing about sessions, agents or hosts, so it may not import from those trees.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { expect, it } from "vitest";

const moduleDir = import.meta.dirname;
const forbiddenNames = ["session", "adapters", "import", "host"];
const forbiddenDirs = forbiddenNames.map((name) => resolve(moduleDir, "..", "..", name));
const forbiddenBare = new RegExp(`(?:^|/)(?:src/)?(?:${forbiddenNames.join("|")})(?:/|$)`);

/** Every `from "x"`, `import("x")` and `require("x")` specifier in a source text. */
const SPECIFIER = /(?:\bfrom\s*|\b(?:import|require)\s*\(\s*)["']([^"']+)["']/g;

function violations(fileText: string, filePath: string): string[] {
  const found: string[] = [];
  for (const match of fileText.matchAll(SPECIFIER)) {
    const specifier = match[1];
    if (specifier === undefined || specifier.startsWith("node:")) continue;
    const crosses = specifier.startsWith(".")
      ? forbiddenDirs.some((dir) => {
          const target = resolve(dirname(filePath), specifier);
          return target === dir || target.startsWith(dir + sep);
        })
      : forbiddenBare.test(specifier);
    if (crosses) found.push(`${filePath}: ${specifier}`);
  }
  return found;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

it("T-STO-15 — the module knows nothing about sessions", async () => {
  const files = await sourceFiles(moduleDir);
  expect(files.length).toBeGreaterThan(0);

  const found: string[] = [];
  for (const file of files) {
    found.push(...violations(await readFile(file, "utf8"), file));
  }

  expect(found).toEqual([]);
  // The check must be able to fail: the interpolation keeps this sample out of its own scan.
  const sample = `import type { CanonicalSession } from "../../${"session"}/contract.js";`;
  expect(violations(sample, join(moduleDir, "sample.ts"))).toHaveLength(1);
});
