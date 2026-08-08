function globalPattern(source: string): RegExp {
  return new RegExp(source, "gu");
}

const ANSI_SEQUENCE = globalPattern(
  String.raw`\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~])`,
);
const UNSAFE_CONTROL = globalPattern(
  String.raw`[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]`,
);

export function safeText(value: string): string {
  return value.replace(ANSI_SEQUENCE, " ").replace(UNSAFE_CONTROL, " ");
}

export function safeLines(lines: readonly string[]): string[] {
  return lines.map(safeText);
}
