// The source side of the tool: find the sessions of this repository, order them, resolve the
// user's choice, and load it. It never writes and never calls a model (NG-1, AC-4, FR-8).

import type {
  CanonicalSession,
  HomeFailure,
  ImportConfig,
  Listing,
  SearchScope,
  SelectionInput,
  SessionDescriptor,
  SessionFinder,
} from "./contract.js";
import { SessionSelectionError } from "./errors.js";
import {
  buildSearchList,
  canonicalPath,
  isDirectory,
  type SearchTarget,
  type SourceAdapter,
} from "./homes.js";
import { compareDescriptors } from "./ordering.js";

export type { SourceAdapter };

/** Everything the finder needs. The adapter list arrives from `src/import/`; it holds none. */
export interface DiscoveryDeps {
  adapters: readonly SourceAdapter[];
  /** Only `extraHomes` is read. */
  config: Pick<ImportConfig, "extraHomes">;
}

const NEXT_STEP = "Run the list again to see the sessions available in this repository.";

function reasonLine(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  return text.split("\n")[0] ?? "unknown error";
}

export function createSessionFinder(deps: DiscoveryDeps): SessionFinder {
  async function collect(target: SearchTarget, repoRoot: string): Promise<Listing> {
    // A home the user named must never fail silently: adapters swallow a missing
    // directory (an absent default home is normal), but a typo'd --home is not (FR-2).
    if (target.named === true && !(await isDirectory(target.home))) {
      return {
        rows: [],
        failures: [
          {
            home: target.home,
            agent: target.agent,
            message: "home not searched: no such directory",
          },
        ],
      };
    }
    let found: SessionDescriptor[];
    try {
      found = await target.adapter.listSessions(target.home);
    } catch (reason) {
      // One bad home never empties the listing.
      return {
        rows: [],
        failures: [
          {
            home: target.home,
            agent: target.agent,
            message: `home not searched: ${reasonLine(reason)}`,
          },
        ],
      };
    }

    const rows: SessionDescriptor[] = [];
    const failures: HomeFailure[] = [];
    for (const descriptor of found) {
      if (descriptor.repoPath === null) {
        // Out of scope, but never silent: the tool cannot show that it belongs here.
        failures.push({
          home: target.home,
          agent: target.agent,
          message: `session ${descriptor.ref.id} records no repository, so it cannot be listed here`,
        });
        continue;
      }
      if ((await canonicalPath(descriptor.repoPath)) === repoRoot) rows.push(descriptor); // FR-13
    }
    return { rows, failures };
  }

  /** The single listing both `list` and `resolve` use, so the two always agree (FR-10). */
  async function buildListing(scope: SearchScope): Promise<Listing> {
    const targets = await buildSearchList(deps.adapters, deps.config, scope);
    const repoRoot = await canonicalPath(scope.repoRoot);
    const collected = await Promise.all(targets.map((target) => collect(target, repoRoot)));

    const rows: SessionDescriptor[] = [];
    const failures: HomeFailure[] = [];
    for (const part of collected) {
      rows.push(...part.rows);
      failures.push(...part.failures);
    }
    rows.sort(compareDescriptors);
    return { rows, failures };
  }

  async function resolveRow(rows: SessionDescriptor[], row: number): Promise<SessionDescriptor> {
    const chosen = Number.isInteger(row) && row >= 1 ? rows[row - 1] : undefined;
    if (!chosen) {
      throw new SessionSelectionError(
        String(row),
        `Row ${row} is not in this repository's session list, which has ${rows.length} row(s). ${NEXT_STEP}`,
      );
    }
    return chosen;
  }

  return {
    async list(scope: SearchScope): Promise<Listing> {
      return await buildListing(scope);
    },

    async resolve(scope: SearchScope, input: SelectionInput): Promise<SessionDescriptor> {
      const { rows } = await buildListing(scope);
      switch (input.by) {
        case "row":
          return await resolveRow(rows, input.row);
        case "session-id": {
          const matches = rows.filter((row) => row.ref.id === input.id);
          const found = matches[0];
          if (!found) {
            throw new SessionSelectionError(
              input.id,
              `No session "${input.id}" belongs to this repository. ${NEXT_STEP}`,
            );
          }
          if (matches.length > 1) {
            const locations = matches
              .map((row) => `${row.ref.agent} at "${row.ref.home}" (${row.filePath})`)
              .join("; ");
            throw new SessionSelectionError(
              input.id,
              `Session ID "${input.id}" matches ${matches.length} sessions: ${locations}. ` +
                "Select a numbered row or exact file path, or narrow the search with an agent and --home.",
            );
          }
          return found;
        }
        case "file-path": {
          const wanted = await canonicalPath(input.path);
          for (const row of rows) {
            if ((await canonicalPath(row.filePath)) === wanted) return row;
          }
          // Selection by path is a convenience, not a way around the repository filter (NG-9).
          throw new SessionSelectionError(
            input.path,
            `"${input.path}" is not a session of this repository. ${NEXT_STEP}`,
          );
        }
      }
    },

    async load(descriptor: SessionDescriptor): Promise<CanonicalSession> {
      const adapter = deps.adapters.find((candidate) => {
        const capabilities = candidate.capabilities();
        return capabilities.agent === descriptor.ref.agent && capabilities.roles.includes("source");
      });
      if (!adapter) {
        throw new Error(`no source adapter for agent "${descriptor.ref.agent}"`);
      }
      // Returned unchanged: the rules of sections D and E belong to src/import/transfer/.
      return await adapter.loadSession(descriptor);
    },
  };
}
