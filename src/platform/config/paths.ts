import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { HomePath } from "./contract.js";

const CONFIG_DIR = ".config";
const APP_DIR = "resume-from";
const CONFIG_FILE = "config.json";

/** Where the configuration lives when the caller names no other file. */
export function defaultConfigPath(): string {
  return resolve(homedir(), CONFIG_DIR, APP_DIR, CONFIG_FILE);
}

/**
 * Turns a home as written into an absolute, symlink-free path: a leading `~` becomes the
 * user's home, a relative path is resolved against the configuration file's own directory
 * (an invocation's working directory would make the same file mean different things), and
 * symlinks are followed so `src/import/discovery/` deduplicates locations, not spellings.
 *
 * A home that does not exist keeps its resolved spelling. Existence is not checked here —
 * a home may be created between the load and the search.
 */
export async function resolveHomePath(raw: string, baseDir: string): Promise<HomePath> {
  const expanded = expandTilde(raw);
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(baseDir, expanded);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}

function expandTilde(raw: string): string {
  if (raw === "~") return homedir();
  // Only "~/": "~other" is another user's home to a shell, and a plain segment here.
  if (raw.startsWith("~/")) return resolve(homedir(), raw.slice(2));
  return raw;
}
