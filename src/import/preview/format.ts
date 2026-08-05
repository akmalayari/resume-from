/** How the preview writes numbers, commits and untrusted text. Nothing here reads a plan. */

const THOUSAND = 1000;
const SHORT_COMMIT_LENGTH = 7;
const MAX_TEXT_LENGTH = 80;

/** The thousands abbreviation of FR-18: 34000 becomes "34k", 840 stays "840". */
export function formatTokens(tokens: number): string {
  const value = Math.max(0, Math.round(tokens));
  return value >= THOUSAND ? `${Math.round(value / THOUSAND)}k` : String(value);
}

/** The short commit form the preview shows. */
export function shortCommit(commit: string): string {
  return commit.replace(/\s+/gu, "").slice(0, SHORT_COMMIT_LENGTH);
}

/**
 * True when two commits name the same one, whether abbreviated or full. A prefix match
 * needs at least a short commit on both sides: source text is untrusted, and "9" must
 * not silence the warning that the tree moved.
 */
export function sameCommit(left: string, right: string): boolean {
  const a = left.replace(/\s+/gu, "").toLowerCase();
  const b = right.replace(/\s+/gu, "").toLowerCase();
  if (a === "" || b === "") return false;
  if (a === b) return true;
  if (a.length < SHORT_COMMIT_LENGTH || b.length < SHORT_COMMIT_LENGTH) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * One line in, one line out. Source titles and paths are attacker-controlled text
 * (FR-60): folding newlines and control characters is what stops a session title
 * from forging a preview line of its own.
 */
export function oneLine(text: string, maxLength = MAX_TEXT_LENGTH): string {
  const flat = text
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat;
}

/** Singular or plural, chosen by the count. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
