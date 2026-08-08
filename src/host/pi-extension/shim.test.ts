import { describe, expect, it, vi } from "vitest";

const activatePiExtension = vi.hoisted(() => vi.fn());

vi.mock("resume-from", () => ({ activatePiExtension }));
vi.mock("resume-from/pi-extension", () => ({
  formatRow: vi.fn(),
  safeLines: (lines: string[]) => lines,
  safeText: (text: string) => text,
}));

type SessionStartContext = {
  sessionManager: { getEntries(): unknown[] };
  ui: { setWidget(key: string, lines: string[] | undefined): void };
};
type SessionStartHandler = (event: unknown, context: SessionStartContext) => void | Promise<void>;
type ShimFactory = (pi: {
  on(event: string, handler: SessionStartHandler): void;
  registerCommand(name: string, definition: unknown): void;
}) => void;

type OuterCommandContext = {
  cwd: string;
  hasUI: boolean;
  ui: {
    notify(message: string, level: string): void;
    confirm(title: string, question: string): Promise<boolean>;
    select(title: string, options: string[]): Promise<string | undefined>;
  };
  switchSession(path: string, options: unknown): Promise<unknown>;
};

type OuterCommandHandler = (rawArgs: string, context: OuterCommandContext) => Promise<void>;
type MockPiActivation = {
  home: string | null;
  registrar: {
    registerCommand(definition: { name: string; description: string; run: unknown }): void;
  };
};

async function loadOuterCommand(): Promise<OuterCommandHandler> {
  const shimUrl = new URL("../../../shims/pi/extensions/resume-from.js", import.meta.url).href;
  const module = (await import(shimUrl)) as { default: ShimFactory };
  let handler: OuterCommandHandler | undefined;

  module.default({
    on() {},
    registerCommand(_name, definition) {
      handler = (definition as { handler: OuterCommandHandler }).handler;
    },
  });

  if (handler === undefined) throw new Error("resume-from shim did not register its command");
  return handler;
}

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

describe("Pi package shim command boundary", () => {
  it("uses one absolute home and preserves a path containing spaces as one argument", async () => {
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = "relative-pi-home";
    const run = vi.fn().mockResolvedValue(undefined);
    activatePiExtension.mockImplementation(async (deps: MockPiActivation) => {
      deps.registrar.registerCommand({
        name: "resume-from",
        description: "test",
        run,
      });
    });

    try {
      const handler = await loadOuterCommand();
      const context: OuterCommandContext = {
        cwd: "/repo",
        hasUI: true,
        ui: {
          notify: vi.fn(),
          confirm: vi.fn().mockResolvedValue(true),
          select: vi.fn().mockResolvedValue(undefined),
        },
        switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
      };

      await handler(" sessions/my session.jsonl ", context);

      const activation = activatePiExtension.mock.calls.at(-1)?.[0] as MockPiActivation | undefined;
      expect(activation?.home).toMatch(/\/relative-pi-home$/);
      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.calls[0]?.[0].home).toBe(activation?.home);
      expect(run.mock.calls[0]?.[1]).toEqual(["sessions/my session.jsonl"]);
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });
});
