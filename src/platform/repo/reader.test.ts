import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { runGit } from "./git.js";
import { createRepoReader } from "./index.js";
import { cleanupTempDirs, makeDir, tempDir } from "./test-support.js";

vi.mock("./git.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./git.js")>()),
  runGit: vi.fn(),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, realpath: vi.fn(original.realpath) };
});

afterAll(cleanupTempDirs);
afterEach(() => vi.mocked(runGit).mockReset());

const unresolved = { root: null, commonDir: null, isBare: false, head: null, branch: null };

async function fixture() {
  const root = await tempDir();
  const cwd = await makeDir(root, "nested", "command directory");
  const commonDir = await makeDir(root, "metadata");
  vi.mocked(runGit).mockImplementation(async (_dir, args) => {
    const query = args.join(" ");
    const stdout =
      query === "rev-parse --git-common-dir"
        ? "../../metadata\n"
        : query === "rev-parse --show-toplevel"
          ? "../..\n"
          : query === "rev-parse --is-bare-repository"
            ? "false\n"
            : "";
    return { ok: stdout !== "", stdout, stderr: "" };
  });
  return { root, cwd, commonDir };
}

test("relative Git paths resolve against the canonical command directory, not process cwd", async () => {
  const { cwd, root, commonDir } = await fixture();
  expect(await createRepoReader().identify(cwd)).toEqual({
    root,
    commonDir,
    isBare: false,
    head: null,
    branch: null,
  });
  for (const [directory] of vi.mocked(runGit).mock.calls) expect(directory).toBe(cwd);
});

test.each(["--git-common-dir", "--is-bare-repository", "--show-toplevel"])(
  "completed nonzero %s is unresolved without interpreting stderr",
  async (query) => {
    const { cwd } = await fixture();
    const success = vi.mocked(runGit).getMockImplementation();
    if (success === undefined) throw new Error("fixture did not install a Git implementation");
    vi.mocked(runGit).mockImplementation(async (dir, args, options) =>
      args.includes(query)
        ? { ok: false, stdout: "", stderr: "fatal: localized or unsafe repository error" }
        : success(dir, args, options),
    );
    expect(await createRepoReader().identify(cwd)).toEqual(unresolved);
  },
);

test("Git operational failures propagate unchanged", async () => {
  const { cwd } = await fixture();
  const failure = new Error("git could not run: spawn EACCES");
  vi.mocked(runGit).mockRejectedValueOnce(failure);
  await expect(createRepoReader().identify(cwd)).rejects.toBe(failure);
});

test.each(["EACCES", "EIO"])("filesystem %s is an operational failure", async (code) => {
  const { cwd } = await fixture();
  const failure = Object.assign(new Error("realpath failed"), { code });
  vi.mocked(realpath).mockRejectedValueOnce(failure);
  await expect(createRepoReader().identify(cwd)).rejects.toBe(failure);
  expect(runGit).not.toHaveBeenCalled();
});

test("metadata realpath failures propagate rather than hiding them as absence", async () => {
  const { cwd } = await fixture();
  const failure = Object.assign(new Error("metadata unreadable"), { code: "EACCES" });
  vi.mocked(realpath).mockResolvedValueOnce(cwd).mockRejectedValueOnce(failure);
  await expect(createRepoReader().identify(cwd)).rejects.toBe(failure);
});

test("missing input returns unresolved without invoking Git or walking to its parent", async () => {
  const { root } = await fixture();
  expect(await createRepoReader().identify(join(root, "missing"))).toEqual(unresolved);
  expect(runGit).not.toHaveBeenCalled();
});

test("missing common directory supplies no identity", async () => {
  const { cwd } = await fixture();
  const missing = Object.assign(new Error("removed metadata"), { code: "ENOENT" });
  vi.mocked(realpath).mockResolvedValueOnce(cwd).mockRejectedValueOnce(missing);
  expect(await createRepoReader().identify(cwd)).toEqual(unresolved);
});

test("cancellation wins even when the input path is missing", async () => {
  const { root } = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    createRepoReader({ signal: controller.signal }).identify(join(root, "missing")),
  ).rejects.toThrow("aborted");
  expect(runGit).not.toHaveBeenCalled();
});

test.each([undefined, new Error("custom cancellation"), "string cancellation"])(
  "normalizes pre-aborted reasons (%s) for identity and distance including short circuits",
  async (reason) => {
    const { root, cwd } = await fixture();
    const controller = new AbortController();
    controller.abort(reason);
    const reader = createRepoReader({ signal: controller.signal });
    for (const operation of [
      () => reader.identify(cwd),
      () => reader.identify(join(root, "missing")),
      () => reader.distanceFrom(cwd, "HEAD"),
      () => reader.distanceFrom(cwd, ""),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        name: "AbortError",
        cause: controller.signal.reason,
      });
    }
    expect(runGit).not.toHaveBeenCalled();
  },
);

test("post-check cancellation wins over an unresolved identity or unknown distance", async () => {
  const { cwd } = await fixture();
  for (const operation of ["identify", "distance"] as const) {
    const controller = new AbortController();
    vi.mocked(runGit).mockImplementation(async () => {
      controller.abort("during read");
      return { ok: false, stdout: "", stderr: "unresolved" };
    });
    const reader = createRepoReader({ signal: controller.signal });
    await expect(
      operation === "identify" ? reader.identify(cwd) : reader.distanceFrom(cwd, "HEAD"),
    ).rejects.toMatchObject({ name: "AbortError", cause: "during read" });
  }
});
