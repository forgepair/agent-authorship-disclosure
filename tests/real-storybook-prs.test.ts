import { describe, expect, it } from 'vitest';
import { classify, type AccountHistory } from '../src/classify';

/**
 * Real PR data pulled directly via `gh api` on 2026-09-13, not synthesized.
 *
 * Ground truth: storybookjs/storybook#36130 and its comments (a maintainer,
 * valentinpalkovic, and a co-maintainer of the actual Agent Scan tool,
 * huang-julien) explicitly state all three of these PRs SHOULD have been
 * graded `agent-scan:mixed` (Agent Scan's own existing "disclosed AI
 * assistance" category) but weren't -- #36085 got `automated`, #36145 and
 * #36146 both got `human`.
 *
 * Important correction made *during* this test, from reading the real
 * thread rather than trusting the brief's framing: Agent Scan
 * (@unveil/identity, which agentscan-action wraps -- confirmed via its real
 * package.json dependency) is an ACCOUNT-level behavioral analyzer. Per its
 * own co-maintainer: "agent scan does not read data from the PR itself, it
 * scans data from GH activity." It structurally cannot see a PR's
 * disclosure text at all -- that's not a tuning gap, it's the architecture.
 * The `behavioralAutomationScore` inputs below are therefore a coarse proxy
 * derived from Agent Scan's own emitted label for each account, standing in
 * for its real (unpublished) internal score, since actual PR-level
 * automation signal was never Agent Scan's job to begin with.
 */

describe('classify() against real, live Storybook PRs (not synthetic fixtures)', () => {
  it('#36085 (ethanstoner): disclosed, reviewed, but agent-scan:automated -- classifier should agree with the maintainer that this is "mixed", not "automated"', () => {
    const history: AccountHistory = { priorDisclosures: [] };
    const result = classify(
      {
        behavioralAutomationScore: 0.9, // proxy for the real agent-scan:automated label
        disclosureText:
          "Per CONTRIBUTING's AI policy: this PR was written with AI assistance (Claude). A real person (me) is behind it, has reviewed the diff, and will respond to review comments.",
        claimedScope: null,
        diffStats: { filesChanged: 4, linesChanged: 70 + 18 },
      },
      history,
    );
    expect(result.classification).toBe('disclosed-assisted');
  });

  it('#36145 (theRizwan, 1st PR): disclosed, but agent-scan:human -- classifier should still surface the disclosure instead of silently agreeing with "human"', () => {
    const history: AccountHistory = { priorDisclosures: [] };
    const result = classify(
      {
        behavioralAutomationScore: 0.1, // proxy for the real agent-scan:human label
        disclosureText:
          'Claude Code assisted with the investigation and the patch, as CONTRIBUTING.md asks contributors to disclose. I reviewed and tested every change.',
        claimedScope: null,
        diffStats: { filesChanged: 2, linesChanged: 22 + 1 },
      },
      history,
    );
    expect(result.classification).toBe('disclosed-assisted');
    history.priorDisclosures.unshift(
      'Claude Code assisted with the investigation and the patch, as CONTRIBUTING.md asks contributors to disclose. I reviewed and tested every change.',
    );
    return history; // handed to the next test to model the real 2-PRs-in-7-seconds sequence
  });

  it('#36146 (theRizwan, 2nd PR, 7 seconds later, IDENTICAL disclosure sentence): a real-world near-miss for the boilerplate check -- must NOT be flagged, since this is genuinely the same honest author reusing CONTRIBUTING.md-suggested wording, not gaming', () => {
    const historyAfterFirstPr: AccountHistory = {
      priorDisclosures: [
        'Claude Code assisted with the investigation and the patch, as CONTRIBUTING.md asks contributors to disclose. I reviewed and tested every change.',
      ],
    };
    const result = classify(
      {
        behavioralAutomationScore: 0.1,
        disclosureText:
          'Claude Code assisted with the investigation and the patch, as CONTRIBUTING.md asks contributors to disclose. I reviewed and tested every change.',
        claimedScope: null,
        diffStats: { filesChanged: 2, linesChanged: 123 + 1 },
      },
      historyAfterFirstPr,
    );
    // Only 1 prior match exists (BOILERPLATE_REPEAT_COUNT is 2) -- correctly
    // not flagged yet. This is the real-world case that most directly tests
    // whether the anti-gaming threshold is too aggressive: two PRs, 7
    // seconds apart, word-for-word identical disclosure text, from a real
    // human contributor following the project's own suggested disclosure
    // format. A threshold of 1 would have wrongly flagged an honest
    // contributor here.
    expect(result.classification).toBe('disclosed-assisted');
  });
});
