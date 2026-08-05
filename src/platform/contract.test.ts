/**
 * T-PLA-5 and T-PLA-6 — the four services are independent of each other, and each is reachable
 * only through its interface. Both are read off the submodule folders as they are on disk.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  exportedInterfaces,
  exportedNames,
  exportedStatements,
  exportedValues,
  imports,
  isInside,
  PLATFORM_DIR,
  parseSource,
  readSources,
  resolveSpecifier,
  type Source,
  SUBMODULES,
  type Submodule,
  submoduleDir,
  typeReferences,
} from "./test-support.js";

describe("T-PLA-5 the four services are independent", () => {
  /** Every import from `source` that lands in a sibling submodule of `src/platform/`. */
  function edges(source: Source, from: Submodule): string[] {
    return imports(source).flatMap((record) => {
      const target = resolveSpecifier(source.path, record.specifier);
      if (target === undefined) return [];
      return SUBMODULES.filter(
        (other) => other !== from && isInside(target, submoduleDir(other)),
      ).map((other) => `${source.path} -> ${other}: ${record.specifier}`);
    });
  }

  it.each(SUBMODULES)("%s calls no other platform service", (name) => {
    const sources = readSources(submoduleDir(name));
    expect(sources.length).toBeGreaterThan(0);

    expect(sources.flatMap((source) => edges(source, name))).toEqual([]);
  });

  it("the check sees an edge between two services", () => {
    const sample = parseSource(
      join(submoduleDir("store"), "sample.ts"),
      `import type { TokenEstimator } from ${JSON.stringify("../tokens/contract.js")};`,
    );

    expect(edges(sample, "store")).toHaveLength(1);
  });
});

describe("T-PLA-6 each service is reachable only through its interface", () => {
  /** The service each submodule publishes. src/platform/module.md, Public Contract. */
  const services: { name: Submodule; service: string }[] = [
    { name: "config", service: "ConfigLoader" },
    { name: "repo", service: "RepoReader" },
    { name: "tokens", service: "EstimatorFactory" },
    { name: "store", service: "FileCommitter" },
  ];

  const read = (name: Submodule, file: string): Source =>
    parseSource(
      join(submoduleDir(name), file),
      readFileSync(join(submoduleDir(name), file), "utf8"),
    );

  it.each(services)("$name publishes $service in this module's own contract table", (service) => {
    const row = new RegExp(`^\\|\\s*\`src/platform/${service.name}/\`\\s*\\|`);
    const table = readFileSync(join(PLATFORM_DIR, "module.md"), "utf8")
      .split("\n")
      .filter((line) => row.test(line));

    expect(table).toHaveLength(1);
    expect(table[0]).toContain(service.service);
  });

  it.each(services)("$name declares $service as an interface", (service) => {
    const contract = read(service.name, "contract.ts");

    expect(exportedInterfaces(contract)).toContain(service.service);
  });

  it.each(services)("$name re-exports $service as a type from its contract", (service) => {
    const index = read(service.name, "index.ts");

    const fromContract = imports(index).filter((record) => record.specifier === "./contract.js");

    expect(fromContract.flatMap((record) => record.names)).toContain(service.service);
  });

  it.each(services)("$name exports a factory whose return type is $service", (service) => {
    const sources = readSources(submoduleDir(service.name), { tests: false });
    const exported = exportedNames(read(service.name, "index.ts"));

    const factories = sources
      .flatMap(exportedValues)
      .filter((value) => value.declaredType === service.service && exported.includes(value.name));

    expect(factories.length).toBeGreaterThan(0);
    expect(factories.every((factory) => !factory.isClass)).toBe(true);
  });

  it.each(services)("$name exports no class that implements $service", (service) => {
    const sources = readSources(submoduleDir(service.name), { tests: false });

    const concrete = sources
      .flatMap(exportedValues)
      .filter((value) => value.isClass && value.implemented.includes(service.service));

    expect(concrete).toEqual([]);
  });

  it.each(services)("$name exports no type it took from a library", (service) => {
    const sources = readSources(submoduleDir(service.name), { tests: false });

    const leaked: string[] = [];
    for (const source of sources) {
      const fromLibrary = new Set(
        imports(source)
          .filter(
            (record) => !record.specifier.startsWith(".") && !record.specifier.startsWith("node:"),
          )
          .flatMap((record) => record.names),
      );
      const published = new Set(exportedStatements(source).flatMap(typeReferences));
      for (const name of fromLibrary) {
        if (published.has(name)) leaked.push(`${source.path}: ${name}`);
      }
    }

    expect(leaked).toEqual([]);
  });

  it("the checks see a concrete implementation and a leaked library type", () => {
    const sample = parseSource(
      join(submoduleDir("tokens"), "sample.ts"),
      [
        'import type { Encoder } from "gpt-tokenizer";',
        "export class RealEstimator implements EstimatorFactory {}",
        "export interface Leak { encoder: Encoder }",
      ].join("\n"),
    );

    const classes = exportedValues(sample).filter((value) =>
      value.implemented.includes("EstimatorFactory"),
    );
    const published = new Set(exportedStatements(sample).flatMap(typeReferences));

    expect(classes).toHaveLength(1);
    expect(published.has("Encoder")).toBe(true);
  });
});
