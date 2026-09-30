// The source side of the tool: find the sessions of this repository, order them, resolve the
// user's choice, and load it. It never writes and never calls a model (NG-1, AC-4, FR-8).

import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CanonicalSession,
  HomeFailure,
  ImportConfig,
  Listing,
  RepoIdentity,
  RepoReader,
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
  repo: Pick<RepoReader, "identify">;
}

const NEXT_STEP = "Run the list again to see the sessions available in this repository.";

function reasonLine(reason: unknown): string {
  const text = reason instanceof Error ? reason.message : String(reason);
  return text.split("\n")[0] ?? "unknown error";
}

interface DirectoryEvidence {
  directory: string;
  commonDir: string | null;
}

type Lookup = (directory: string) => Promise<DirectoryEvidence | null>;

function isCancellation(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "AbortError";
}

export function createSessionFinder(deps: DiscoveryDeps): SessionFinder {
  async function collect(
    target: SearchTarget,
    destination: DirectoryEvidence | null,
    lookup: Lookup,
  ): Promise<Listing> {
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
      if (isCancellation(reason)) throw reason;
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
      let diagnostic: string | null = null;
      try {
        let matchingGitIdentity = false;
        let sameDirectory = false;
        let conflictingGitIdentity = false;
        let existing = false;
        // Do not accept early: a later candidate can disprove the membership.
        for (const candidate of descriptor.repoPaths) {
          const evidence = await lookup(candidate);
          if (evidence === null) continue;
          existing = true;
          sameDirectory ||= evidence.directory === destination?.directory;
          if (evidence.commonDir !== null) {
            matchingGitIdentity ||= evidence.commonDir === destination?.commonDir;
            conflictingGitIdentity ||= evidence.commonDir !== destination?.commonDir;
          }
        }
        if (conflictingGitIdentity) {
          diagnostic =
            "has conflicting repository identity evidence; its recorded directories cannot unambiguously belong to this destination";
        } else if (matchingGitIdentity || sameDirectory) {
          rows.push(descriptor);
        } else if (descriptor.repoPaths.length === 0) {
          diagnostic = "records no repository, so it cannot be listed here";
        } else {
          diagnostic = existing
            ? "has unresolved recorded directories with no matching repository evidence"
            : "has only missing recorded directories; repository membership cannot be established";
        }
      } catch (reason) {
        if (isCancellation(reason)) throw reason;
        diagnostic = `repository lookup failed: ${reasonLine(reason)}`;
      }
      if (diagnostic !== null) {
        failures.push({
          home: target.home,
          agent: target.agent,
          message: `session ${descriptor.ref.id} ${diagnostic}`,
        });
      }
    }
    return { rows, failures };
  }

  /** The single listing both `list` and `resolve` use, so the two always agree (FR-10). */
  async function buildListing(scope: SearchScope): Promise<Listing> {
    // Both caches live for this listing only. The spelling cache shares missing paths and
    // filesystem failures; the canonical cache also shares Git lookups through symlink aliases.
    const directories = new Map<string, Promise<DirectoryEvidence | null>>();
    const identities = new Map<string, Promise<RepoIdentity>>();
    const lookup: Lookup = (directory) => {
      const absolute = resolve(directory);
      let pending = directories.get(absolute);
      if (!pending) {
        pending = (async () => {
          let canonical: string;
          try {
            canonical = await realpath(absolute);
          } catch (reason) {
            if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
              // The reader still observes cancellation on missing-path short circuits.
              await deps.repo.identify(absolute);
              return null;
            }
            throw reason;
          }
          let identity = identities.get(canonical);
          if (!identity) {
            identity = Promise.resolve().then(() => deps.repo.identify(canonical));
            identities.set(canonical, identity);
          }
          return { directory: canonical, commonDir: (await identity).commonDir };
        })();
        directories.set(absolute, pending);
      }
      return pending;
    };
    let destination: DirectoryEvidence | null;
    try {
      destination = await lookup(scope.repoRoot);
    } catch (reason) {
      if (isCancellation(reason)) throw reason;
      throw new Error(`Destination repository lookup failed: ${reasonLine(reason)}`, {
        cause: reason,
      });
    }
    const targets = await buildSearchList(deps.adapters, deps.config, scope);
    const collected = await Promise.all(
      targets.map((target) => collect(target, destination, lookup)),
    );

    const rows: SessionDescriptor[] = [];
    const failures: HomeFailure[] = [];
    for (const part of collected) {
      rows.push(...part.rows);
      failures.push(...part.failures);
    }
    rows.sort(compareDescriptors);
    return { rows, failures };
  }

  async function resolveRow(
    rows: SessionDescriptor[],
    row: number,
    diagnostics: string,
  ): Promise<SessionDescriptor> {
    const chosen = Number.isInteger(row) && row >= 1 ? rows[row - 1] : undefined;
    if (!chosen) {
      throw new SessionSelectionError(
        String(row),
        `Row ${row} is not in this repository's session list, which has ${rows.length} row(s). ${NEXT_STEP}${diagnostics}`,
      );
    }
    return chosen;
  }

  return {
    async list(scope: SearchScope): Promise<Listing> {
      return await buildListing(scope);
    },

    async resolve(scope: SearchScope, input: SelectionInput): Promise<SessionDescriptor> {
      const { rows, failures } = await buildListing(scope);
      const diagnostics =
        failures.length === 0
          ? ""
          : ` Skipped: ${failures.map((failure) => `${failure.agent} at "${failure.home}": ${failure.message}`).join("; ")}.`;
      switch (input.by) {
        case "row":
          return await resolveRow(rows, input.row, diagnostics);
        case "session-id": {
          const matches = rows.filter((row) => row.ref.id === input.id);
          const found = matches[0];
          if (!found) {
            throw new SessionSelectionError(
              input.id,
              `No session "${input.id}" belongs to this repository. ${NEXT_STEP}${diagnostics}`,
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
            `"${input.path}" is not a session of this repository. ${NEXT_STEP}${diagnostics}`,
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
