import { encode } from "gpt-tokenizer/encoding/o200k_base";
import type { EstimatorFactory, EstimatorFamily, TokenEstimator } from "./contract.js";

/**
 * Counts the tokens of one piece of text. The whole of what this module knows about a
 * tokenizer library: replacing the library is replacing this function.
 */
export type EncodeCount = (text: string) => number;

/** How much text a segment holds before the next word start closes it. */
const SEGMENT_CHARS = 64;

/** Where a segment is cut when no word start follows — a run of text with no space in it. */
const SEGMENT_LIMIT_CHARS = 128;

/**
 * The exact counter calls the encoder once per character, so it is bounded by an offset:
 * text past this point is charged with the byte upper bound (`utf8UpperBound`) instead.
 * 256 kB is already far past every target's context window, and the switch is by position
 * rather than by content, which is what keeps the estimate monotone.
 *
 * Measured cost of the exact path: ≈ 760 ms at this ceiling (≈ 0.003 ms/char, ≈ 42× a
 * single encode() call on the same text). Text beyond this offset is free by comparison:
 * utf8UpperBound adds < 1 ms/MB. Revisit if a target's context window grows past 256 kB
 * and exact counting at full length becomes necessary.
 */
const EXACT_BUDGET_CHARS = 262_144;

/** UTF-8 bytes per token. The rule of thumb the heuristic families are built on. */
const BYTES_PER_TOKEN = 4;

/** A byte-level tokenizer cannot emit more tokens than the UTF-8 bytes it consumes. */
const utf8UpperBound = (text: string): number => Buffer.byteLength(text, "utf8");

const isWhitespace = (code: number): boolean => code === 32 || (code >= 9 && code <= 13);

/** Characters outside the BMP — emoji, mostly — cost far more tokens per byte than text does. */
const astralCount = (text: string): number => {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) count++;
  }
  return count;
};

/**
 * The counting rule for every family without an exact encoder, and the fallback for the one
 * that has one. Monotone by construction: both terms only grow as text is appended.
 */
const heuristicCount = (text: string): number =>
  Math.ceil(Buffer.byteLength(text, "utf8") / BYTES_PER_TOKEN) + astralCount(text);

/**
 * Where the segment starting at `start` ends: the first word start past `SEGMENT_CHARS`, or
 * the hard limit if the text runs on without one.
 *
 * The scan only ever moves forward, so a boundary is decided by the text before it and
 * nothing appended later can move it. Earlier segments are therefore frozen, which is half
 * of why the estimate cannot fall.
 */
const segmentEnd = (text: string, start: number): number => {
  const end = Math.min(start + SEGMENT_LIMIT_CHARS, text.length);
  for (let index = start + SEGMENT_CHARS; index < end; index++) {
    const startsWord =
      !isWhitespace(text.charCodeAt(index)) && isWhitespace(text.charCodeAt(index - 1));
    if (startsWord) return index;
  }
  return end;
};

/**
 * The largest count of any prefix of `segment`.
 *
 * Encoding is not monotone: appending a character can merge two tokens into one, so the raw
 * count of a longer text is sometimes lower. Taking the envelope over the prefixes removes
 * that, at the cost of over-counting by the size of the dip it absorbs.
 */
const prefixEnvelope = (segment: string, count: EncodeCount): number => {
  let largest = 0;
  for (let end = 1; end <= segment.length; end++) {
    const tokens = count(segment.slice(0, end));
    if (tokens > largest) largest = tokens;
  }
  return largest;
};

const exactCount = (text: string, count: EncodeCount): number => {
  let total = 0;
  let start = 0;
  while (start < text.length) {
    const end = segmentEnd(text, start);
    const segment = text.slice(start, end);
    total += start < EXACT_BUDGET_CHARS ? prefixEnvelope(segment, count) : utf8UpperBound(segment);
    start = end;
  }
  return total;
};

const heuristicEstimator: TokenEstimator = { estimate: heuristicCount };

const exactEstimator = (count: EncodeCount): TokenEstimator => ({
  estimate(text) {
    try {
      return exactCount(text, count);
    } catch {
      return utf8UpperBound(text);
    }
  },
});

const encodeCount: EncodeCount = (text) => encode(text).length;

/**
 * Builds a factory over a given encoder. The parameter is the seam the tests use to stand a
 * failing encoder up; every caller outside this module wants `estimatorFactory`.
 */
export const createEstimatorFactory = (count: EncodeCount = encodeCount): EstimatorFactory => {
  const byFamily = new Map<string, TokenEstimator>([
    ["gpt", exactEstimator(count)],
    // No public JavaScript tokenizer counts the Claude family, so it shares the heuristic.
    ["claude", heuristicEstimator],
    ["generic", heuristicEstimator],
  ]);

  return {
    forFamily(family: EstimatorFamily): TokenEstimator {
      return byFamily.get(family) ?? heuristicEstimator;
    },
  };
};

export const estimatorFactory: EstimatorFactory = createEstimatorFactory();
