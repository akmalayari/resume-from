import { describe, expect, it, vi } from "vitest";

vi.mock("resume-from", () => ({ activatePiExtension: vi.fn() }));
vi.mock("resume-from/pi-extension", () => ({ formatRow: vi.fn() }));

type SessionStartContext = {
  sessionManager: { getEntries(): unknown[] };
  ui: { setWidget(key: string, lines: string[] | undefined): void };
};
type SessionStartHandler = (event: unknown, context: SessionStartContext) => void | Promise<void>;
type ShimFactory = (pi: {
  on(event: string, handler: SessionStartHandler): void;
  registerCommand(name: string, definition: unknown): void;
}) => void;

async function loadSessionStartHandler(): Promise<SessionStartHandler> {
  const shimUrl = new URL("../../../shims/pi/extensions/resume-from.js", import.meta.url).href;
  const module = (await import(shimUrl)) as { default: ShimFactory };
  let handler: SessionStartHandler | undefined;

  module.default({
    on(event, candidate) {
      if (event === "session_start") handler = candidate;
    },
    registerCommand() {},
  });

  if (handler === undefined) throw new Error("resume-from shim did not register session_start");
  return handler;
}

describe("Pi package shim provenance", () => {
  it("restores the persisted import marker as a widget from the fresh session context", async () => {
    const handler = await loadSessionStartHandler();
    const setWidget = vi.fn();
    const lines = ["Imported from pi", "Source session: source-1"];

    await handler(
      { reason: "resume" },
      {
        sessionManager: {
          getEntries: () => [
            { type: "message", message: { role: "user" } },
            {
              type: "custom",
              customType: "resume-from-provenance",
              data: { lines },
            },
          ],
        },
        ui: { setWidget },
      },
    );

    expect(setWidget).toHaveBeenCalledOnce();
    expect(setWidget).toHaveBeenCalledWith("resume-from-provenance", lines);
  });

  it("clears the widget when provenance is malformed", async () => {
    const handler = await loadSessionStartHandler();
    const setWidget = vi.fn();

    await handler(
      { reason: "resume" },
      {
        sessionManager: {
          getEntries: () => [
            {
              type: "custom",
              customType: "resume-from-provenance",
              data: { lines: ["Imported from pi", 42] },
            },
          ],
        },
        ui: { setWidget },
      },
    );

    expect(setWidget).toHaveBeenCalledWith("resume-from-provenance", undefined);
  });
});
