/**
 * The registry over the agent list. It answers three questions and decides nothing: which
 * adapters exist, which one is an agent's, and which of them fill a role (FR-59).
 *
 * Every answer comes from what an adapter declares. Nothing here reads a name.
 */

import type { AdapterRole, AgentAdapter, AgentId, AgentRegistry } from "./contract.js";

const SOURCE: AdapterRole = "source";
const TARGET: AdapterRole = "target";

/** Adapters whose declaration includes a role (FR-59). */
const withRole = (adapters: readonly AgentAdapter[], role: AdapterRole): AgentAdapter[] =>
  adapters.filter((adapter) => adapter.capabilities().roles.includes(role));

export function createAgentRegistry(adapters: readonly AgentAdapter[]): AgentRegistry {
  const all = [...adapters];
  const byAgent = new Map<AgentId, AgentAdapter>();
  for (const adapter of all) {
    const agent = adapter.capabilities().agent;
    if (!byAgent.has(agent)) byAgent.set(agent, adapter);
  }

  return {
    all: () => [...all],

    get(agent: AgentId): AgentAdapter {
      const found = byAgent.get(agent);
      if (found === undefined) {
        // Not defaulted: importing into the wrong agent is worse than not importing (FR-56).
        throw new Error(
          `There is no adapter for "${agent}", so the tool cannot run inside it. ` +
            `The agents it knows are: ${[...byAgent.keys()].join(", ")}.`,
        );
      }
      return found;
    },

    sources: () => withRole(all, SOURCE),
    targets: () => withRole(all, TARGET),
  };
}
