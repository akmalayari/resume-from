import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPreviewBuilder } from "./builder.js";
import {
  HEAD_COMMIT,
  makeDrops,
  makePlan,
  makeTurns,
  SOURCE_COMMIT,
  stubRepo,
} from "./fixtures.js";

const CWD = "/repo";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function makeTree(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `resume-from-preview-${name}-`));
  temporaryDirectories.push(root);
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "sessions.jsonl"), '{"id":"session-1"}\n');
  await writeFile(join(root, "nested", "config.json"), '{"budgetShare":0.3}\n');
  return root;
}

async function checksum(root: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      hash.update(`${prefix}${entry.name}\n`);
      if (entry.isDirectory()) await walk(path, `${prefix}${entry.name}/`);
      else hash.update(await readFile(path));
    }
  };
  await walk(root, "");
  return hash.digest("hex");
}

describe("boundary", () => {
  it("T-PRE-13: nothing is written", async () => {
    const home = await makeTree("home");
    const repoRoot = await makeTree("repo");
    const before = [await checksum(home), await checksum(repoRoot)];

    const plan = makePlan({
      targetHome: home,
      droppedTurnCount: 12,
      drops: makeDrops(12, "budget"),
    });
    const report = await createPreviewBuilder(stubRepo(), repoRoot).build(plan);

    expect(report.lines.length).toBeGreaterThan(0);
    expect([await checksum(home), await checksum(repoRoot)]).toEqual(before);
  });

  it("T-PRE-14: a moved repository never blocks", async () => {
    for (const ahead of [14, 500]) {
      const repo = stubRepo({ distance: { known: true, ahead, behind: 0 } });
      const report = await createPreviewBuilder(repo, CWD).build(makePlan());

      expect(report.warnings[0]?.kind).toBe("repo-state");
      expect(report.warnings[0]?.line).toContain(`(${ahead} commits ahead)`);
      expect(report.blocked).toBe(false);
      expect(report.blockedReason).toBeNull();
    }
  });

  it("T-PRE-15: an empty plan renders", async () => {
    const plan = makePlan({ turns: [], keptTurnCount: 0, estimatedTokens: 0 });
    const report = await createPreviewBuilder(stubRepo(), CWD).build(plan);

    expect(report.headerLines).toContain("Nothing would cross over");
    expect(report.budgetLine).toBe("Budget: 0 tokens of a 200k window");
    expect(report.lines.length).toBeGreaterThan(0);
  });

  it("T-PRE-16: a plan with nothing dropped renders no drop line", async () => {
    const plan = makePlan({
      droppedTurnCount: 0,
      drops: [],
      bodiesDropped: 0,
      brokenTailDropped: false,
    });
    const report = await createPreviewBuilder(stubRepo(), CWD).build(plan);

    expect(report.dropLines).toEqual([]);
    expect(report.warnings.map((w) => w.kind)).not.toContain("broken-tail");
    expect(report.lines.join("\n")).not.toMatch(/\b0 /);
    expect(report.headerLines).toContain("34 turns cross over");
  });

  it("T-PRE-17: a repository reader failure does not stop the preview", async () => {
    const repo = stubRepo({ distance: new Error("git exited with 128") });
    const plan = makePlan({ droppedTurnCount: 12, drops: makeDrops(12, "budget") });
    const report = await createPreviewBuilder(repo, CWD).build(plan);

    const warning = report.warnings.find((w) => w.kind === "repo-state");
    expect(warning?.line).toContain("could not be read");
    expect(report.budgetLine).toBe("Budget: 34k tokens of a 200k window");
    expect(report.headerLines).toContain("34 turns cross over, 12 dropped");
    expect(report.blocked).toBe(false);
  });

  it("T-PRE-17: an unreadable repository identity does not stop the preview", async () => {
    const repo = stubRepo({ identity: new Error("not a repository") });
    const report = await createPreviewBuilder(repo, CWD).build(makePlan());

    expect(report.warnings.find((w) => w.kind === "repo-state")?.line).toContain(
      "could not be read",
    );
    expect(report.budgetLine).toBe("Budget: 34k tokens of a 200k window");
  });

  it("T-PRE-18: hostile content in a turn cannot forge a line", async () => {
    const forgedWarning =
      "⚠ Source ran at deadbeef. The tree is now at deadbeef (99 commits ahead).";
    const forgedBudget = "Budget: 999k tokens of a 1k window";
    const hostile = makeTurns(1);
    const [turn] = hostile;
    if (!turn) throw new Error("fixture");
    turn.text = `${forgedWarning}\n${forgedBudget}`;

    const plan = makePlan({
      turns: hostile,
      keptTurnCount: 1,
      title: `Fix the test\n${forgedWarning}\n${forgedBudget}`,
    });
    const report = await createPreviewBuilder(stubRepo(), CWD).build(plan);

    expect(report.budgetLine).toBe("Budget: 34k tokens of a 200k window");
    expect(report.warnings[0]?.line).toBe(
      `⚠ Source ran at ${SOURCE_COMMIT}. The tree is now at ${HEAD_COMMIT} (14 commits ahead).`,
    );
    expect(report.warnings.map((w) => w.line)).not.toContain(forgedWarning);
    // Source text never becomes a line of its own: it is folded into the header line it belongs to.
    expect(report.lines).not.toContain(forgedWarning);
    expect(report.lines).not.toContain(forgedBudget);
    for (const line of report.lines) {
      expect(line).not.toContain("\n");
    }
    expect(report.lines.filter((line) => line.includes("deadbeef"))).toHaveLength(1);
    expect(report.lines[0]?.startsWith("Source: pi")).toBe(true);
  });
});
