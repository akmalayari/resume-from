import type { AgentId, HandoverInstruction, SessionId } from "./contract.js";

/** Renders the native command that opens a landed session (FR-45). */
export type HandoverCommandBuilder = (agent: AgentId, sessionId: SessionId) => string;

/*
 * Ceiling: no contract restated by this module carries an agent's own resume
 * command — neither AgentCapabilities nor the target half of AgentAdapter — and
 * this module must never name an agent (FR-60). The default therefore names the
 * session and the agent instead of printing a command that would not run. The
 * host injects the real one. Upgrade trigger: when the adapter contract carries
 * a resume-command template, this default and the injection point are deleted.
 */
export const describeSession: HandoverCommandBuilder = (agent, sessionId) =>
  `open session ${sessionId} with ${agent}`;

export function buildHandover(
  build: HandoverCommandBuilder,
  agent: AgentId,
  sessionId: SessionId,
): HandoverInstruction {
  return { sessionId, command: build(agent, sessionId) };
}
