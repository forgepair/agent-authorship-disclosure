/**
 * Anti-gaming core for combining a self-disclosed AI-assistance statement
 * with an existing behavioral automation score.
 *
 * The brief's own caveat, taken seriously here: disclosure text must never
 * be a bypass flag. A bad-faith fully-automated account could trivially
 * paste the same disclosure boilerplate on every PR to launder past a
 * naive "just check for a disclosure sentence" check. This module treats
 * disclosure as ONE input to a decision, cross-checked against two
 * independent signals that are each individually easy to game but hard to
 * fake consistently together:
 *
 *  1. Boilerplate detection: does this disclosure text look near-identical
 *     to this account's own PAST disclosures? A real person describing
 *     different changes tends to describe them differently; an account
 *     pasting the same cover text on every PR is itself a tell.
 *  2. Diff-plausibility: does the claimed scope of assistance
 *     ("minor fix") match the actual size of the change? A "minor
 *     AI-assisted typo fix" disclosure attached to a 500-line, 20-file
 *     diff is a mismatch worth a human's attention.
 *
 * Either red flag routes to human review rather than being silently
 * resolved in either direction -- this is deliberately NOT a single
 * weighted score, because a weighted sum is easier to tune around
 * (a bad actor just needs the SUM to clear a threshold). A decision table
 * with independent trip-wires is harder to game because each one has to be
 * defeated separately.
 */

export type Classification = 'human' | 'disclosed-assisted' | 'automated' | 'flagged-for-review';

export interface DiffStats {
  filesChanged: number;
  linesChanged: number;
}

export type ClaimedScope = 'minor' | 'moderate' | 'major' | null;

export interface PRInput {
  /** 0 (looks entirely human) to 1 (looks entirely automated). */
  behavioralAutomationScore: number;
  /** Parsed PR body / commit trailer disclosure statement, or null if absent. */
  disclosureText: string | null;
  claimedScope: ClaimedScope;
  diffStats: DiffStats;
}

export interface AccountHistory {
  /** This account's own past disclosure texts, most recent first. */
  priorDisclosures: string[];
}

export interface ClassificationResult {
  classification: Classification;
  reasons: string[];
}

// Calibratable constants -- these are a starting sketch, not tuned values.
// A real implementation needs these validated against a labeled corpus of
// real PRs, the same way llm-cache-usage-lib's pricing table was checked
// against real data rather than assumed.
export const THRESHOLDS = {
  BEHAVIORAL_AUTOMATED: 0.6,
  BOILERPLATE_SIMILARITY: 0.85,
  BOILERPLATE_REPEAT_COUNT: 2, // this many near-identical prior disclosures trips the flag
  MINOR_SCOPE_MAX_LINES: 200,
  MINOR_SCOPE_MAX_FILES: 10,
} as const;

/** Token-set (Jaccard) similarity -- deliberately simple, no NLP dependency. */
export function textSimilarity(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function isBoilerplate(disclosureText: string, history: AccountHistory): boolean {
  const matches = history.priorDisclosures.filter(
    (prior) => textSimilarity(disclosureText, prior) >= THRESHOLDS.BOILERPLATE_SIMILARITY,
  );
  return matches.length >= THRESHOLDS.BOILERPLATE_REPEAT_COUNT;
}

function isDiffImplausible(scope: ClaimedScope, diff: DiffStats): boolean {
  if (scope !== 'minor') return false; // only "minor" makes a checkable size claim here
  return diff.linesChanged > THRESHOLDS.MINOR_SCOPE_MAX_LINES || diff.filesChanged > THRESHOLDS.MINOR_SCOPE_MAX_FILES;
}

export function classify(pr: PRInput, history: AccountHistory): ClassificationResult {
  const isAutomatedBehavior = pr.behavioralAutomationScore >= THRESHOLDS.BEHAVIORAL_AUTOMATED;

  if (!pr.disclosureText) {
    return isAutomatedBehavior
      ? { classification: 'automated', reasons: ['no disclosure; behavioral score indicates automation'] }
      : { classification: 'human', reasons: ['no disclosure; behavioral score indicates a human author'] };
  }

  const reasons: string[] = [];
  const boilerplate = isBoilerplate(pr.disclosureText, history);
  const implausible = isDiffImplausible(pr.claimedScope, pr.diffStats);

  if (boilerplate) {
    reasons.push(
      `disclosure text matches ${THRESHOLDS.BOILERPLATE_REPEAT_COUNT}+ of this account's prior disclosures at >=${THRESHOLDS.BOILERPLATE_SIMILARITY} similarity -- possible boilerplate laundering`,
    );
  }
  if (implausible) {
    reasons.push(
      `disclosure claims "${pr.claimedScope}" scope but diff touches ${pr.diffStats.filesChanged} files / ${pr.diffStats.linesChanged} lines`,
    );
  }

  if (boilerplate || implausible) {
    return { classification: 'flagged-for-review', reasons };
  }

  // Honest, non-suspicious disclosure -- correct on BOTH of the brief's
  // reported failure directions: a disclosed, human-reviewed PR that
  // *looks* automated no longer gets the alarming "automated" label
  // (storybook#36085's false positive), and a disclosed PR that looks
  // human no longer has its disclosed AI assistance silently dropped into
  // plain "human" (storybook#36145/#36146's false negative).
  return {
    classification: 'disclosed-assisted',
    reasons: [
      isAutomatedBehavior
        ? 'behavioral score indicates automation, but disclosure is present, specific, and consistent with the diff'
        : 'behavioral score indicates a human author; disclosure adds transparency without contradicting it',
    ],
  };
}
