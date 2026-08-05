// The flag and argument grammar of the command binary (FR-10, FR-12, FR-15).
// It parses; it decides nothing about sessions.

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentId, HomePath, SelectionInput } from "./contract.js";

export const USAGE =
  "Usage: /resume-from [<agent>] [<row> | <session-id> | <file-path>] [--home <path>] [--agent <name>] [--confirm]";

/** The agent names the user may type, and the agent they mean (FR-15). */
const AGENT_NAMES: Record<string, AgentId> = {
  pi: "pi",
  codex: "codex",
  claude: "claude-code",
  "claude-code": "claude-code",
};

const KNOWN_AGENTS = Object.keys(AGENT_NAMES).join(", ");

export interface ParsedArgs {
  /** Null when the user asked for the list (FR-10). */
  selection: SelectionInput | null;
  onlyAgent: AgentId | null;
  onlyHome: HomePath | null;
  confirm: boolean;
}

export type ParseResult = { ok: true; args: ParsedArgs } | { ok: false; problem: string };

type Classified = { ok: true; value: SelectionInput } | { ok: false; problem: string };

export function parseArgs(argv: string[], cwd: string): ParseResult {
  const positionals: string[] = [];
  let onlyAgent: AgentId | null = null;
  let onlyHome: HomePath | null = null;
  let confirm = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (arg === "--confirm") {
      confirm = true;
      continue;
    }

    if (arg === "--home" || arg.startsWith("--home=")) {
      const value = arg.startsWith("--home=") ? arg.slice("--home=".length) : argv[index + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        return { ok: false, problem: "--home needs a path. Correct form: --home <path>." };
      }
      if (!arg.startsWith("--home=")) index += 1;
      onlyHome = resolvePath(value, cwd);
      continue;
    }

    if (arg === "--agent" || arg.startsWith("--agent=")) {
      const value = arg.startsWith("--agent=") ? arg.slice("--agent=".length) : argv[index + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        return {
          ok: false,
          problem: `--agent needs a name. Correct form: --agent <name>, one of: ${KNOWN_AGENTS}.`,
        };
      }
      if (!arg.startsWith("--agent=")) index += 1;
      const agent = AGENT_NAMES[value];
      if (agent === undefined) {
        return {
          ok: false,
          problem: `"${value}" is not an agent this command knows. Use one of: ${KNOWN_AGENTS}.`,
        };
      }
      if (onlyAgent !== null && onlyAgent !== agent) {
        return { ok: false, problem: "The agent was given twice. Name it once." };
      }
      onlyAgent = agent;
      continue;
    }

    if (arg.startsWith("-")) {
      if (/^-\d/.test(arg)) {
        return {
          ok: false,
          problem: `"${arg}" is not a row. Rows start at 1 and are whole numbers.`,
        };
      }
      return {
        ok: false,
        problem: `"${arg}" is not a flag this command knows. Known flags: --home, --agent, --confirm.`,
      };
    }

    positionals.push(arg);
  }

  let rest = positionals;
  const first = positionals[0];
  if (first !== undefined) {
    const named = AGENT_NAMES[first];
    if (named !== undefined) {
      if (onlyAgent !== null && onlyAgent !== named) {
        return { ok: false, problem: "The agent was given twice. Name it once." };
      }
      onlyAgent = named;
      rest = positionals.slice(1);
    }
  }

  if (rest.length > 1) {
    return {
      ok: false,
      problem: `Too many arguments: ${rest.join(" ")}. Give one row, session ID or file path.`,
    };
  }

  let selection: SelectionInput | null = null;
  const token = rest[0];
  if (token !== undefined) {
    const classified = classify(token, cwd);
    if (!classified.ok) return classified;
    selection = classified.value;
  }

  if (selection === null && confirm) {
    return {
      ok: false,
      problem: "--confirm needs the row, session ID or file path you previewed.",
    };
  }

  return { ok: true, args: { selection, onlyAgent, onlyHome, confirm } };
}

/** A row, a session ID or a file path — told apart by shape alone (FR-12). */
function classify(token: string, cwd: string): Classified {
  if (/^\d+$/.test(token)) {
    const row = Number(token);
    if (row < 1) {
      return { ok: false, problem: `"${token}" is not a row. Rows start at 1.` };
    }
    return { ok: true, value: { by: "row", row } };
  }
  // Numeric but not a row: caught here so a session ID that starts with a digit
  // (a UUID, for example) is still read as a session ID.
  if (/^[+-]?\d+(\.\d+)?$/.test(token)) {
    return {
      ok: false,
      problem: `"${token}" is not a row. A row is a whole number, 1 or greater.`,
    };
  }
  if (token.startsWith("~") || token.includes("/")) {
    return { ok: true, value: { by: "file-path", path: resolvePath(token, cwd) } };
  }
  return { ok: true, value: { by: "session-id", id: token } };
}

function resolvePath(value: string, cwd: string): string {
  if (value === "~") return homedir();
  const expanded = value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  return resolve(cwd, expanded);
}
