import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConfigLoader, ImportConfig } from "./contract.js";
import { defaultConfig } from "./defaults.js";
import { ConfigLoadError } from "./errors.js";
import { defaultConfigPath } from "./paths.js";
import { buildConfig } from "./validate.js";

export interface ConfigLoaderOptions {
  /** Configuration file to read. Defaults to `~/.config/resume-from/config.json`. */
  configPath?: string | undefined;
}

/**
 * A loader that reads one JSON file and fills every missing setting with its default.
 * It never writes: a missing file is a missing file, not something to create (T-CFG-13).
 */
export function createConfigLoader(options: ConfigLoaderOptions = {}): ConfigLoader {
  const configPath = options.configPath ?? defaultConfigPath();

  return {
    async load(): Promise<ImportConfig> {
      const text = await readConfigFile(configPath);
      // No file, or a file the user emptied: both mean "nothing set", not "nothing works".
      if (text === undefined || text.trim() === "") return defaultConfig();

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        // Not a fallback to defaults: a file the user wrote and the tool ignored is worse
        // than an error.
        throw new ConfigLoadError(
          configPath,
          `${configPath} is not valid JSON: ${reason(cause)}. Fix the syntax, or delete the ` +
            "file to use the defaults.",
        );
      }
      return buildConfig(parsed, dirname(configPath), configPath);
    },
  };
}

/** The file's text, or undefined when there is no file to read. */
async function readConfigFile(configPath: string): Promise<string | undefined> {
  try {
    return await readFile(configPath, "utf8");
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw new ConfigLoadError(
      configPath,
      `${configPath} cannot be read: ${reason(cause)}. Check the path and its permissions.`,
    );
  }
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
