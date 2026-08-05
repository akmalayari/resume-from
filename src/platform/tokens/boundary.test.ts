import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MODULE_DIR = import.meta.dirname;
const REPO_ROOT = resolve(MODULE_DIR, "../../..");
const SHARED_FIXTURES = join(REPO_ROOT, "test", "fixtures");

const sources = readdirSync(MODULE_DIR)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, text: readFileSync(join(MODULE_DIR, name), "utf8") }));

const isTest = (name: string): boolean => name.endsWith(".test.ts");

/** The file with its comments removed: what it declares, not what it says about itself. */
const codeOf = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/** Every module specifier the file imports from or re-exports from. */
const specifiersOf = (text: string): string[] => {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier !== undefined) found.push(specifier);
  }
  return found;
};

describe("T-TOK-8: the interface hides the implementation", () => {
  const contract = sources.find((file) => file.name === "contract.ts");

  it("finds the contract", () => {
    expect(contract).toBeDefined();
  });

  it("exports only EstimatorFamily, TokenEstimator and EstimatorFactory", () => {
    const exported = [
      ...(contract?.text ?? "").matchAll(
        /^export\s+(?:type|interface|const|function|class)\s+(\w+)/gm,
      ),
    ]
      .map((match) => match[1])
      .sort();

    expect(exported).toEqual(["EstimatorFactory", "EstimatorFamily", "TokenEstimator"]);
  });

  it("names no tokenizer library in the contract", () => {
    expect(specifiersOf(contract?.text ?? "")).toEqual([]);
    expect(contract?.text).not.toMatch(/gpt-tokenizer/);
  });

  it("lets no tokenizer library type escape the module", () => {
    const reexports = sources.filter((file) =>
      /export\s[^;]*\bfrom\s*["'][^"']*gpt-tokenizer/.test(file.text),
    );
    expect(reexports.map((file) => file.name)).toEqual([]);

    const importers = sources.filter((file) =>
      specifiersOf(file.text).some((s) => s.includes("gpt-tokenizer")),
    );
    expect(importers.map((file) => file.name)).toEqual(["estimator.ts"]);
  });
});

describe("T-TOK-11: the module knows nothing about sessions", () => {
  const FORBIDDEN = ["src/session/", "src/adapters/", "src/import/", "src/host/"];

  it.each(sources)("$name imports no other module's implementation", ({ name, text }) => {
    for (const specifier of specifiersOf(text)) {
      if (!specifier.startsWith(".")) continue; // a package, not a module of this tree

      const target = resolve(MODULE_DIR, specifier);
      if (!relative(MODULE_DIR, target).startsWith("..")) continue; // inside this module: no boundary

      // The only ways out: another module's contract, or the shared test fixtures.
      const escapes =
        specifier.endsWith("/contract.js") || !relative(SHARED_FIXTURES, target).startsWith("..");
      expect(escapes, `${name} imports ${specifier}`).toBe(true);
    }
  });

  it.each(sources)("$name imports from no session-aware module", ({ text }) => {
    for (const specifier of specifiersOf(text)) {
      const asPath = specifier.startsWith(".")
        ? relative(REPO_ROOT, resolve(MODULE_DIR, specifier))
        : specifier;
      for (const forbidden of FORBIDDEN) {
        expect(`${asPath}/`).not.toContain(forbidden);
      }
    }
  });

  it.each(sources.filter((file) => !isTest(file.name)))(
    "$name has no signature mentioning a turn or a session",
    ({ text }) => {
      const code = codeOf(text);
      expect(code).not.toMatch(/\bturns?\b/i);
      expect(code).not.toMatch(/\bsessions?\b/i);
    },
  );

  it("keeps its tests beside the code", () => {
    const tests = sources.filter((file) => isTest(file.name));
    expect(tests.map((file) => basename(file.name)).sort()).toEqual([
      "boundary.test.ts",
      "estimator.test.ts",
    ]);
  });
});
