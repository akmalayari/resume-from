/**
 * The source role: a Codex home becomes a list of sessions, and one session becomes the
 * canonical vocabulary. Every result body is dropped (FR-24) and every reasoning trace is
 * ignored (FR-28, C-4).
 */

import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type {
  CanonicalSession,
  CanonicalTurn,
  SessionDescriptor,
  ToolCallRecord,
  ToolEffect,
  TurnKind,
  TurnRole,
} from "./contract.js";
import { redactSensitiveArgumentsText, redactSensitiveText } from "./redaction.js";
import type { CodexSessionMeta, RolloutEntry } from "./rollout.js";
import {
  CODEX_ENTRY_COMPACTED,
  CODEX_ENTRY_EVENT_MSG,
  CODEX_ENTRY_RESPONSE_ITEM,
  CODEX_EVENT_AGENT_MESSAGE,
  CODEX_EVENT_ITEM_COMPLETED,
  CODEX_EVENT_USER_MESSAGE,
  CODEX_EXTENSION_KIND_WEB_SEARCH,
  CODEX_ITEM_CUSTOM_TOOL_CALL,
  CODEX_ITEM_CUSTOM_TOOL_CALL_OUTPUT,
  CODEX_ITEM_FUNCTION_CALL,
  CODEX_ITEM_FUNCTION_CALL_OUTPUT,
  CODEX_THREAD_ITEM_AGENT_MESSAGE,
  CODEX_THREAD_ITEM_COLLAB_AGENT_TOOL_CALL,
  CODEX_THREAD_ITEM_COMMAND_EXECUTION,
  CODEX_THREAD_ITEM_CONTEXT_COMPACTION,
  CODEX_THREAD_ITEM_EXTENSION,
  CODEX_THREAD_ITEM_FILE_CHANGE,
  CODEX_THREAD_ITEM_IMAGE_VIEW,
  CODEX_THREAD_ITEM_MCP_TOOL_CALL,
  CODEX_THREAD_ITEM_REASONING,
  CODEX_THREAD_ITEM_SUB_AGENT_ACTIVITY,
  CODEX_THREAD_ITEM_USER_MESSAGE,
  isNotFoundError,
  KNOWN_ENTRY_TYPES,
  listRolloutFiles,
  parseRolloutText,
  payloadType,
  readSessionMeta,
  sessionsRoot,
  toIsoUtc,
} from "./rollout.js";

const TITLE_LIMIT = 80;
const ARGUMENTS_PREVIEW_LIMIT = 60;

/** Tools whose name alone settles the question (FR-26). Everything else stays "unknown". */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "read",
  "view_image",
  "list_dir",
  "grep",
  "find",
  "web_search",
]);
const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "apply_patch",
  "write_file",
  "edit_file",
  "create_file",
  "delete_file",
]);

/**
 * `Extension.kind` values that are reads by their own name. Any other kind is a call whose kind
 * does not settle the question, so it stays "unknown" (FR-26).
 */
const READ_ONLY_EXTENSION_KINDS: ReadonlySet<string> = new Set([CODEX_EXTENSION_KIND_WEB_SEARCH]);

export interface CodexRollout {
  filePath: string;
  meta: CodexSessionMeta | null;
  turns: CanonicalTurn[];
  /** Entries of a type this module does not understand. Codex drops them in silence (C-6). */
  skippedEntries: number;
  startedAt: string | null;
  updatedAt: string | null;
  title: string;
  changedPaths: string[];
  truncated: boolean;
}

export class CodexRolloutUnreadableError extends Error {
  constructor(filePath: string) {
    super(`Codex thread is unreadable: ${filePath} was cut mid-entry`);
    this.name = "CodexRolloutUnreadableError";
  }
}

/** Lenient: a file cut mid-entry still yields whatever parsed, with `truncated` set. */
export async function scanRollout(filePath: string): Promise<CodexRollout> {
  // Whole-file read: listing a home reads every rollout, and C-5 measured those files
  // in megabytes. Ceiling accepted because title and turn count both need the whole file;
  // revisit if a home with thousands of threads makes the listing feel slow.
  const text = await readFile(filePath, "utf8");
  const { entries, truncated } = parseRolloutText(text);

  let meta: CodexSessionMeta | null = null;
  for (const entry of entries) {
    meta = readSessionMeta(entry);
    if (meta !== null) break;
  }

  const { turns, skippedEntries, changedPaths } = toCanonicalTurns(entries);
  const firstUserTurn = turns.find((turn) => turn.role === "user" && turn.kind === "message");
  const lastStamp = [...entries].reverse().find((entry) => toIsoUtc(entry.timestamp) !== null);

  return {
    filePath,
    meta,
    turns,
    skippedEntries,
    startedAt: toIsoUtc(meta?.timestamp ?? entries[0]?.timestamp ?? null),
    updatedAt: toIsoUtc(lastStamp?.timestamp ?? meta?.timestamp ?? null),
    title: titleOf(firstUserTurn?.text ?? ""),
    changedPaths,
    truncated,
  };
}

/** Strict: FR-51's "unreadable" answer. */
export async function readRollout(filePath: string): Promise<CodexRollout> {
  const rollout = await scanRollout(filePath);
  if (rollout.truncated) throw new CodexRolloutUnreadableError(filePath);
  return rollout;
}

export async function listCodexSessions(home: string): Promise<SessionDescriptor[]> {
  const descriptors: SessionDescriptor[] = [];
  for (const filePath of await listRolloutFiles(sessionsRoot(home))) {
    let rollout: CodexRollout;
    try {
      rollout = await scanRollout(filePath);
    } catch (error) {
      if (isNotFoundError(error)) continue; // A rollout may disappear during a concurrent cleanup.
      throw error;
    }
    if (rollout.meta === null) continue;
    const repoPaths =
      rollout.meta.cwd !== null && isAbsolute(rollout.meta.cwd) ? [rollout.meta.cwd] : [];
    descriptors.push({
      ref: { agent: "codex", home, id: rollout.meta.id },
      title: rollout.title,
      startedAt: rollout.startedAt ?? "",
      updatedAt: rollout.updatedAt ?? rollout.startedAt ?? "",
      turnCount: rollout.turns.length,
      repoPath: repoPaths[0] ?? null,
      repoPaths,
      filePath,
    });
  }
  descriptors.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return descriptors;
}

export async function loadCodexSession(descriptor: SessionDescriptor): Promise<CanonicalSession> {
  const rollout = await readRollout(descriptor.filePath);
  return {
    provenance: {
      ref: descriptor.ref,
      title: descriptor.title,
      startedAt: descriptor.startedAt,
      updatedAt: descriptor.updatedAt,
      repo: {
        commit: rollout.meta?.commit ?? null,
        branch: rollout.meta?.branch ?? null,
        changedPaths: rollout.changedPaths,
      },
    },
    turns: rollout.turns,
  };
}

function titleOf(text: string): string {
  const line =
    text
      .split("\n")
      .find((candidate) => candidate.trim() !== "")
      ?.trim() ?? "";
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1)}…` : line;
}

/**
 * Two dialogue schemas exist, and a rollout speaks exactly one of them (C-7, C-12):
 *
 * - the older one: messages from `event_msg` (`user_message`/`agent_message`) and tool calls from
 *   `response_item` (`function_call`/`custom_tool_call`). The same text appears in both shapes, so
 *   taking each from one place is what keeps every turn out of the session twice;
 * - the `item_completed` one: every turn — user text, agent text and every tool-like action — is a
 *   single `event_msg` whose `payload.item.type` says which. Its `response_item` stream repeats the
 *   same actions, so it is not read as well, or every action would be counted twice.
 *
 * Reasoning, in either shape, produces nothing at all (C-4, FR-28, NG-8).
 */
function toCanonicalTurns(entries: RolloutEntry[]): {
  turns: CanonicalTurn[];
  skippedEntries: number;
  changedPaths: string[];
} {
  const itemCompleted = usesItemCompletedDialogue(entries);

  const outputs = new Map<string, string>();
  if (!itemCompleted) {
    for (const entry of entries) {
      if (entry.type !== CODEX_ENTRY_RESPONSE_ITEM) continue;
      const type = payloadType(entry);
      if (type !== CODEX_ITEM_FUNCTION_CALL_OUTPUT && type !== CODEX_ITEM_CUSTOM_TOOL_CALL_OUTPUT)
        continue;
      const callId = entry.payload.call_id;
      if (typeof callId !== "string") continue;
      outputs.set(callId, outputTextOf(entry.payload.output));
    }
  }

  const turns: CanonicalTurn[] = [];
  const changed = new Set<string>();
  let skippedEntries = 0;

  for (const entry of entries) {
    if (!KNOWN_ENTRY_TYPES.has(entry.type)) {
      skippedEntries += 1;
      continue;
    }
    const type = payloadType(entry);

    if (entry.type === CODEX_ENTRY_COMPACTED) {
      const message = entry.payload.message;
      if (typeof message !== "string" || message.trim() === "") continue;
      turns.push({
        index: turns.length,
        role: "agent",
        kind: "summary",
        // FR-28, security: credentials in message text must not cross to a different vendor.
        text: redactSensitiveText(message),
        toolCall: null,
        timestamp: toIsoUtc(entry.timestamp),
      });
      continue;
    }

    if (entry.type === CODEX_ENTRY_EVENT_MSG) {
      if (itemCompleted) {
        if (type !== CODEX_EVENT_ITEM_COMPLETED) continue;
        const item = itemCompletedItem(entry);
        if (item === null) continue;
        const body = turnFromItemCompleted(item);
        if (body === null) {
          // Reasoning and compaction are known names that carry no turn; anything else is a kind
          // this module does not understand, and C-6 says to count it, never guess at it.
          if (!IGNORED_ITEM_TYPES.has(itemCompletedItemType(entry))) skippedEntries += 1;
          continue;
        }
        turns.push({
          index: turns.length,
          role: body.role,
          kind: body.kind,
          text: body.text,
          toolCall: body.toolCall,
          timestamp: toIsoUtc(entry.timestamp),
        });
        for (const path of body.changedPaths) changed.add(path);
        continue;
      }
      if (type !== CODEX_EVENT_USER_MESSAGE && type !== CODEX_EVENT_AGENT_MESSAGE) continue;
      const message = entry.payload.message;
      if (typeof message !== "string" || message.trim() === "") continue;
      turns.push({
        index: turns.length,
        role: type === CODEX_EVENT_USER_MESSAGE ? "user" : "agent",
        kind: "message",
        // FR-28, security: credentials in message text must not cross to a different vendor.
        text: redactSensitiveText(message),
        toolCall: null,
        timestamp: toIsoUtc(entry.timestamp),
      });
      continue;
    }

    if (entry.type !== CODEX_ENTRY_RESPONSE_ITEM) continue;
    // The `item_completed` schema repeats every action here; reading it too would double them.
    if (itemCompleted) continue;
    if (type !== CODEX_ITEM_FUNCTION_CALL && type !== CODEX_ITEM_CUSTOM_TOOL_CALL) continue;

    const toolName = typeof entry.payload.name === "string" ? (entry.payload.name as string) : "";
    if (toolName === "") continue;
    const rawArguments =
      type === CODEX_ITEM_FUNCTION_CALL ? entry.payload.arguments : entry.payload.input;
    const argumentsText = typeof rawArguments === "string" ? rawArguments : "";
    const callId = entry.payload.call_id;
    // FR-54: use has() not get() — outputs.get() can return "" for an empty result.
    const resultRecorded = typeof callId === "string" && outputs.has(callId);
    const output = typeof callId === "string" ? (outputs.get(callId) ?? null) : null;
    const toolCall = toolCallRecord(toolName, argumentsText, output, resultRecorded);
    if (toolCall.effect === "mutating")
      for (const path of pathsOf(argumentsText)) changed.add(path);
    turns.push({
      index: turns.length,
      role: "agent",
      kind: "tool-call",
      text: "",
      toolCall,
      timestamp: toIsoUtc(entry.timestamp),
    });
  }

  return { turns, skippedEntries, changedPaths: [...changed] };
}

/** The inner `item` of an `item_completed` entry, when the entry is one (C-12). */
function itemCompletedItem(entry: RolloutEntry): Record<string, unknown> | null {
  if (entry.type !== CODEX_ENTRY_EVENT_MSG) return null;
  if (payloadType(entry) !== CODEX_EVENT_ITEM_COMPLETED) return null;
  const item = entry.payload.item;
  return typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null;
}

function itemCompletedItemType(entry: RolloutEntry): string {
  const type = itemCompletedItem(entry)?.type;
  return typeof type === "string" ? type : "";
}

/**
 * True when this rollout delivers dialogue as `item_completed` items (C-12). Tool-only items do not
 * count: a rollout is read as the new schema only when it actually carries dialogue that way.
 */
function usesItemCompletedDialogue(entries: RolloutEntry[]): boolean {
  return entries.some((entry) => {
    const type = itemCompletedItemType(entry);
    return type === CODEX_THREAD_ITEM_USER_MESSAGE || type === CODEX_THREAD_ITEM_AGENT_MESSAGE;
  });
}

/** Item kinds that are understood and deliberately carry no turn (C-4, C-12). */
const IGNORED_ITEM_TYPES: ReadonlySet<string> = new Set([
  CODEX_THREAD_ITEM_REASONING,
  CODEX_THREAD_ITEM_CONTEXT_COMPACTION,
  CODEX_THREAD_ITEM_SUB_AGENT_ACTIVITY,
]);

/** Everything one `item_completed` item contributes to a canonical turn. */
interface ItemTurn {
  role: TurnRole;
  kind: TurnKind;
  text: string;
  toolCall: ToolCallRecord | null;
  changedPaths: string[];
}

/**
 * One `item_completed` item becomes one canonical turn. The kind of the call is settled by
 * `item.type` itself, so the effect is read from that and never guessed from a tool name (FR-26).
 * Returns null for a kind that carries no turn.
 */
function turnFromItemCompleted(item: Record<string, unknown>): ItemTurn | null {
  const itemType = typeof item.type === "string" ? item.type : "";

  switch (itemType) {
    case CODEX_THREAD_ITEM_USER_MESSAGE:
    case CODEX_THREAD_ITEM_AGENT_MESSAGE:
      return {
        role: itemType === CODEX_THREAD_ITEM_USER_MESSAGE ? "user" : "agent",
        kind: "message",
        // FR-28, security: credentials in message text must not cross to a different vendor.
        text: redactSensitiveText(itemContentText(item)),
        toolCall: null,
        changedPaths: [],
      };
    case CODEX_THREAD_ITEM_COMMAND_EXECUTION: {
      const output = firstString(item.aggregated_output, item.formatted_output, item.stdout);
      return {
        role: "agent",
        kind: "tool-call",
        text: "",
        toolCall: toolCallRecord("exec", commandText(item.command), output, output !== null),
        changedPaths: [],
      };
    }
    case CODEX_THREAD_ITEM_FILE_CHANGE: {
      const paths = objectKeys(item.changes);
      return {
        role: "agent",
        kind: "tool-call",
        text: "",
        toolCall: itemToolCallRecord(
          "apply_patch",
          fileChangeArguments(item.changes),
          `${paths.length} file(s) changed`,
          "mutating",
          false,
        ),
        changedPaths: paths,
      };
    }
    case CODEX_THREAD_ITEM_EXTENSION: {
      const kind = firstNonEmptyString(item.kind) ?? "extension";
      const results = Array.isArray(item.results) ? item.results.length : 0;
      return {
        role: "agent",
        kind: "tool-call",
        text: "",
        toolCall: itemToolCallRecord(
          kind,
          extensionArguments(item),
          `${results} result(s) dropped`,
          READ_ONLY_EXTENSION_KINDS.has(kind) ? "read-only" : "unknown",
          true,
        ),
        changedPaths: [],
      };
    }
    case CODEX_THREAD_ITEM_MCP_TOOL_CALL: {
      const call = mcpToolCall(item);
      return {
        role: "agent",
        kind: "tool-call",
        text: "",
        toolCall: itemToolCallRecord(
          call.toolName,
          call.argumentsText,
          mcpOutcome(item),
          // A server's own `readOnlyHint` is a claim by another party, not the item kind (FR-26).
          "unknown",
          item.result !== undefined && item.result !== null,
        ),
        changedPaths: [],
      };
    }
    case CODEX_THREAD_ITEM_COLLAB_AGENT_TOOL_CALL: {
      const call = collabAgentToolCall(item);
      return {
        role: "agent",
        kind: "tool-call",
        text: "",
        toolCall: itemToolCallRecord(
          call.toolName,
          call.argumentsText,
          call.outcome,
          "unknown",
          objectKeys(item.agents_states).length > 0,
        ),
        changedPaths: [],
      };
    }
    case CODEX_THREAD_ITEM_IMAGE_VIEW:
      return {
        role: "agent",
        kind: "tool-call",
        text: "",
        toolCall: itemToolCallRecord(
          "view_image",
          firstNonEmptyString(item.path) ?? "",
          "image not carried",
          "read-only",
          false,
        ),
        changedPaths: [],
      };
    default:
      return null;
  }
}

/**
 * The text of a message item. `content[].type` is `"text"` on a user message and `"Text"` on an
 * agent message, so the text is taken from the part's own field and never by that casing.
 */
function itemContentText(item: Record<string, unknown>): string {
  const content = item.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null
        ? firstNonEmptyString((part as Record<string, unknown>).text)
        : null,
    )
    .filter((part): part is string => part !== null)
    .join("\n");
}

/** A Codex command is an argv array; the shell line the model wrote is its joined form. */
function commandText(value: unknown): string {
  if (Array.isArray(value))
    return value.filter((part): part is string => typeof part === "string").join(" ");
  return typeof value === "string" ? value : "";
}

/**
 * FR-24 protects a result body, not a tool argument, and the legacy `apply_patch` call already
 * carries the patch text it was given. A `FileChange` item is the same kind of argument, so the
 * patch is rebuilt from it whole — path plus content — in `apply_patch`'s own shape.
 */
function fileChangeArguments(changes: unknown): string {
  if (typeof changes !== "object" || changes === null) return "";
  const parts: string[] = [];
  for (const [path, change] of Object.entries(changes)) {
    const record =
      typeof change === "object" && change !== null ? (change as Record<string, unknown>) : {};
    const kind = firstNonEmptyString(record.type) ?? "update";
    const verb = kind === "add" ? "Add" : kind === "delete" ? "Delete" : "Update";
    const content = firstNonEmptyString(record.content);
    parts.push(`*** ${verb} File: ${path}${content === null ? "" : `\n${content}`}`);
  }
  return parts.join("\n");
}

/** The queries an `Extension` item searched with, one per line. */
function extensionArguments(item: Record<string, unknown>): string {
  const action = item.action;
  if (typeof action === "object" && action !== null) {
    const queries = (action as Record<string, unknown>).queries;
    if (Array.isArray(queries)) {
      const lines = queries.filter(
        (query): query is string => typeof query === "string" && query !== "",
      );
      if (lines.length > 0) return lines.join("\n");
    }
  }
  return firstNonEmptyString(item.query) ?? "";
}

/**
 * A server tool call names itself in `server` and `tool` and states its arguments as JSON. Both
 * are kept: the name unchanged (FR-27) and the arguments redacted like any other call (FR-24).
 */
function mcpToolCall(item: Record<string, unknown>): {
  toolName: string;
  argumentsText: string;
} {
  const server = firstNonEmptyString(item.server);
  const tool = firstNonEmptyString(item.tool);
  const toolName =
    server !== null && tool !== null ? `${server}.${tool}` : (tool ?? server ?? "mcp");
  return { toolName, argumentsText: jsonArguments(item.arguments) };
}

/** The recorded status of a server call, plus how many result items were dropped (FR-24, FR-25). */
function mcpOutcome(item: Record<string, unknown>): string {
  const result = item.result;
  const record =
    typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
  const content = record === null ? null : record.content;
  const results = Array.isArray(content) ? content.length : record === null ? 0 : 1;
  const dropped = `${results} result(s) dropped`;
  const status = firstNonEmptyString(item.status);
  return status === null ? dropped : `${status}, ${dropped}`;
}

/**
 * An action on another agent. Its `tool` field names the action, and the agents it addresses are
 * the argument; the per-agent states it records are that call's result and are dropped (FR-24).
 */
function collabAgentToolCall(item: Record<string, unknown>): {
  toolName: string;
  argumentsText: string;
  outcome: string;
} {
  const targets = [
    ...stringValues(item.receiver_agents),
    ...stringValues(item.receiver_thread_ids),
  ];
  return {
    toolName: firstNonEmptyString(item.tool) ?? "collab-agent",
    argumentsText: targets.join("\n"),
    outcome: firstNonEmptyString(item.status) ?? "no status recorded",
  };
}

/** Tool arguments as the recorded JSON text, or as they already are when they are a string. */
function jsonArguments(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return "";
  return JSON.stringify(value);
}

/** The non-empty strings of an array field, in source order. */
function stringValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((part): part is string => typeof part === "string" && part !== "");
}

/** Non-empty string keys of an object, in source order — the paths a change touched. */
function objectKeys(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.keys(value).filter((key) => key !== "");
}

/** The first value that is a string, empty string included: an empty result was still recorded. */
function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string") return value;
  }
  return null;
}

/** The first value that is a non-empty string, or null. `""` counts as absent here. */
function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

/**
 * A structured item states its own outcome, so this variant names it instead of measuring a dropped
 * body. The arguments still cross redacted, exactly like the legacy tool-call path (FR-24, FR-28).
 */
function itemToolCallRecord(
  toolName: string,
  argumentsText: string,
  outcome: string,
  effect: ToolEffect,
  bodyDropped: boolean,
): ToolCallRecord {
  const safeArguments = redactSensitiveArgumentsText(argumentsText);
  const head = `${toolName}(${singleLine(safeArguments, ARGUMENTS_PREVIEW_LIMIT)})`;
  return {
    toolName,
    argumentsText: safeArguments,
    outcomeLine: redactSensitiveText(`${head} → ${outcome}`),
    effect,
    bodyDropped,
    resultRecorded: true,
  };
}

/** Only the shape of the output is measured. Not one fragment of it is carried (FR-24, FR-25). */
function toolCallRecord(
  toolName: string,
  argumentsText: string,
  output: string | null,
  resultRecorded: boolean,
): ToolCallRecord {
  const safeArguments = redactSensitiveArgumentsText(argumentsText);
  const head = `${toolName}(${singleLine(safeArguments, ARGUMENTS_PREVIEW_LIMIT)})`;
  const outcomeLine =
    output === null
      ? `${head} → no output recorded`
      : `${head} → ${output.split("\n").length} lines, body dropped`;
  return {
    toolName,
    argumentsText: safeArguments,
    outcomeLine: redactSensitiveText(outcomeLine),
    effect: effectOf(toolName),
    bodyDropped: output !== null,
    // FR-54: false when no *_call_output entry existed for this call_id (broken tail signal).
    resultRecorded,
  };
}

function effectOf(toolName: string): ToolEffect {
  if (MUTATING_TOOLS.has(toolName)) return "mutating";
  if (READ_ONLY_TOOLS.has(toolName)) return "read-only";
  return "unknown";
}

function outputTextOf(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    return output
      .map((part) =>
        typeof part === "object" && part !== null
          ? String((part as Record<string, unknown>).text ?? "")
          : "",
      )
      .join("\n");
  }
  return output === undefined || output === null ? "" : JSON.stringify(output);
}

function singleLine(text: string, limit: number): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** Files a mutating call touched, for RepoSnapshot.changedPaths (FR-36). */
function pathsOf(argumentsText: string): string[] {
  let text = argumentsText;
  const direct: string[] = [];
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const strings = Object.values(record).filter(
        (value): value is string => typeof value === "string",
      );
      text = strings.join("\n");
      for (const key of ["path", "file_path", "filename"]) {
        const value = record[key];
        if (typeof value === "string" && value !== "") direct.push(value);
      }
    }
  } catch {
    // Arguments that are not JSON are searched as they were recorded.
  }
  const patched = [...text.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+)/g)].map((match) =>
    (match[1] ?? "").trim(),
  );
  return [...direct, ...patched].filter((path) => path !== "");
}
