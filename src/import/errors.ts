import type { ValidationDefect } from "./contract.js";

/**
 * Which part of the import failed. One shape for every host, whatever stage raised it
 * (FR-56): a discovery failure, a blocked plan and a landing failure are all this.
 */
export type ImportStage =
  | "target"
  | "discovery"
  | "plan"
  | "preview"
  | "blocked"
  | "confirmation"
  | "source-changed"
  | "landing";

export interface ImportFailureDetail {
  defects?: ValidationDefect[];
  cause?: unknown;
}

/**
 * What every operation of the pipeline rejects with. It is an `Error` so a host that only
 * prints the throwable still shows what failed and what to do next (FR-56).
 */
export class ImportFailure extends Error {
  readonly stage: ImportStage;
  /** The structural defects, when a target adapter refused the new session (FR-50). */
  readonly defects: ValidationDefect[];

  constructor(stage: ImportStage, message: string, detail: ImportFailureDetail = {}) {
    super(message, detail.cause === undefined ? undefined : { cause: detail.cause });
    this.name = "ImportFailure";
    this.stage = stage;
    this.defects = detail.defects ?? [];
  }
}

/** The first line of whatever a stage threw. Never the raw throwable (FR-56). */
export function reasonOf(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text.split("\n")[0] ?? "unknown error";
}
