/**
 * The canonical reference session, used by every module's tests so the whole tree
 * exercises the same vocabulary.
 *
 * It lives outside src/ on purpose: it belongs to no module, and a module that owned it
 * would make every other module's tests reach into its folder.
 *
 * `src/session/module.md` owns the invariants this data must satisfy (T-SES-3 to T-SES-8)
 * and asserts them. In particular T-SES-8 requires at least one of each: a user message,
 * an agent answer, a summary, a read-only tool call, a mutating tool call, and a call whose
 * result body was dropped.
 */

import type { CanonicalSession, CanonicalTurn, SessionRef } from "../../src/session/contract.js";

export const REFERENCE_REF: SessionRef = {
  agent: "codex",
  home: "/home/testuser/.codex",
  id: "01JQ8Z3K7M4N5P6Q7R8S9T0V1W",
};

const DROPPED = "(content dropped: imported session, may be stale)";

export const REFERENCE_TURNS: CanonicalTurn[] = [
  {
    index: 0,
    role: "user",
    kind: "message",
    text: "make the auth token refresh work",
    toolCall: null,
    timestamp: "2026-08-01T09:14:02Z",
  },
  {
    index: 1,
    role: "agent",
    kind: "message",
    text: "I'll look at how the token is stored first.",
    toolCall: null,
    timestamp: "2026-08-01T09:14:05Z",
  },
  {
    index: 2,
    role: "agent",
    kind: "tool-call",
    text: "",
    toolCall: {
      toolName: "Read",
      argumentsText: "'src/auth.ts'",
      outcomeLine: `Read('src/auth.ts') → 400 lines ${DROPPED}`,
      effect: "read-only",
      bodyDropped: true,
      resultRecorded: true,
    },
    timestamp: "2026-08-01T09:14:06Z",
  },
  {
    index: 3,
    role: "agent",
    kind: "tool-call",
    text: "",
    toolCall: {
      toolName: "Grep",
      argumentsText: "'refreshToken', 'src/'",
      outcomeLine: `Grep('refreshToken', 'src/') → 7 matches in 3 files ${DROPPED}`,
      effect: "read-only",
      bodyDropped: true,
      resultRecorded: true,
    },
    timestamp: "2026-08-01T09:14:11Z",
  },
  {
    index: 4,
    role: "agent",
    kind: "message",
    text: "The refresh runs but never persists the new token. I'll fix the write path.",
    toolCall: null,
    timestamp: "2026-08-01T09:14:20Z",
  },
  {
    index: 5,
    role: "agent",
    kind: "tool-call",
    text: "",
    toolCall: {
      toolName: "Edit",
      argumentsText: "'src/auth.ts'",
      outcomeLine: "Edit('src/auth.ts') → 1 hunk applied",
      effect: "mutating",
      bodyDropped: false,
      resultRecorded: true,
    },
    timestamp: "2026-08-01T09:14:31Z",
  },
  {
    index: 6,
    role: "agent",
    kind: "tool-call",
    text: "",
    toolCall: {
      toolName: "Write",
      argumentsText: "'src/auth.test.ts'",
      outcomeLine: "Write('src/auth.test.ts') → 42 lines written",
      effect: "mutating",
      bodyDropped: false,
      resultRecorded: true,
    },
    timestamp: "2026-08-01T09:15:02Z",
  },
  {
    index: 7,
    role: "agent",
    kind: "tool-call",
    text: "",
    toolCall: {
      toolName: "shell",
      argumentsText: "'npm test'",
      outcomeLine: `shell('npm test') → 1 failing, 23 passing ${DROPPED}`,
      effect: "unknown",
      bodyDropped: true,
      resultRecorded: true,
    },
    timestamp: "2026-08-01T09:15:19Z",
  },
  {
    index: 8,
    role: "agent",
    kind: "summary",
    text:
      "So far: the refresh call succeeded but the new token was never written back. " +
      "Fixed the write path in src/auth.ts and added a regression test. " +
      "One test still fails: the clock is not injected, so expiry cannot be forced.",
    toolCall: null,
    timestamp: "2026-08-01T09:15:40Z",
  },
  {
    index: 9,
    role: "user",
    kind: "message",
    text: "inject the clock, don't mock the whole module",
    toolCall: null,
    timestamp: "2026-08-01T09:16:04Z",
  },
  {
    index: 10,
    role: "agent",
    kind: "message",
    text: "Understood. I'll take the clock as a constructor argument.",
    toolCall: null,
    timestamp: "2026-08-01T09:16:08Z",
  },
];

export const REFERENCE_SESSION: CanonicalSession = {
  provenance: {
    ref: REFERENCE_REF,
    title: "make the auth token refresh work",
    startedAt: "2026-08-01T09:14:02Z",
    updatedAt: "2026-08-01T09:16:08Z",
    repo: {
      commit: "3f2a1bc9d4e5f60718293a4b5c6d7e8f90a1b2c3",
      branch: "fix/auth-refresh",
      changedPaths: ["src/auth.ts", "src/auth.test.ts"],
    },
  },
  turns: REFERENCE_TURNS,
};
