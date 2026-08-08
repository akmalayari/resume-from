import { afterEach, describe, expect, it, vi } from "vitest";
import { HELP_TEXT, main, readShimArgs } from "./bin.js";

afterEach(() => vi.restoreAllMocks());

describe("command help", () => {
  it.each(["--help", "-h"])(
    "prints parameter help for %s without requiring a target",
    async (flag) => {
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      const exitCode = await main([flag], "/repo");

      expect(exitCode).toBe(0);
      expect(stdout).toHaveBeenCalledWith(`${HELP_TEXT}\n`);
      expect(stderr).not.toHaveBeenCalled();
      expect(HELP_TEXT).toContain("<row>");
      expect(HELP_TEXT).toContain("<session-id>");
      expect(HELP_TEXT).toContain("<file-path>");
      expect(HELP_TEXT).toContain("--confirm");
    },
  );

  it("points a direct invocation without a target to help", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const exitCode = await main([], "/repo");

    expect(exitCode).toBe(2);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("resume-from --help"));
  });
});

describe("trusted shim arguments", () => {
  it("keeps every user argument after the delimiter untouched", () => {
    expect(
      readShimArgs([
        "--target-agent",
        "codex",
        "--target-home",
        "/home/with space",
        "--",
        "1",
        "--target-agent",
        "claude-code",
      ]),
    ).toEqual({
      ok: true,
      value: {
        targetAgent: "codex",
        targetHome: "/home/with space",
        rest: ["1", "--target-agent", "claude-code"],
      },
    });
  });

  it.each([
    ["missing delimiter", ["--target-agent", "codex"]],
    ["duplicate target", ["--target-agent", "codex", "--target-agent", "pi", "--"]],
    ["missing value", ["--target-agent", "--"]],
  ])("rejects %s", (_name, argv) => {
    expect(readShimArgs(argv)).toMatchObject({ ok: false });
  });
});
