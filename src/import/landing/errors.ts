import type { LandingError, LandingStage, ValidationDefect } from "./contract.js";

interface FailureDetail {
  defects?: ValidationDefect[];
}

/**
 * The rejection value of `land`. It is an Error so a host that only logs the
 * throwable still shows the stage and the next step (FR-56).
 */
export class LandingFailure extends Error implements LandingError {
  readonly stage: LandingStage;
  readonly defects: ValidationDefect[];
  readonly rolledBack = false;

  constructor(stage: LandingStage, message: string, detail: FailureDetail = {}) {
    super(message);
    this.name = "LandingFailure";
    this.stage = stage;
    this.defects = detail.defects ?? [];
  }
}
