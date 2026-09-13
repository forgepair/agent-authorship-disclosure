# agent-authorship-disclosure

A sketch of the anti-gaming logic needed to combine a contributor's
*self-disclosed* AI-assistance statement with an existing behavioral
automation score, instead of classifying PR authorship by behavior alone.

## Why this exists

Open-source projects run bots that grade PRs as human, AI-automated, or
mixed, based on behavioral signals. The tool in production across at
least 8 major JS/Python projects (babel, vite, storybook, mocha,
typescript-eslint, nuxt, aiohttp, sqlfluff) is
[`MatteoGabriele/agentscan-action`](https://github.com/MatteoGabriele/agentscan-action)
(57 stars), a thin wrapper around
[`@unveil/identity`](https://www.npmjs.com/package/@unveil/identity)
(confirmed via its real `package.json` dependency).

That tool already has a three-way label (`automated` / `mixed` / `human`)
-- `mixed` exists specifically to describe a disclosed, human-reviewed
AI-assisted contribution. The bug isn't a missing category. It's that the
classifier never routes anything into it, because -- confirmed directly
by one of the tool's own maintainers, quoted verbatim below -- **it is
architecturally account-level only and never reads the PR's own content
at all.**

## The evidence (independently re-verified against live data, 2026-09-13)

Three real, currently-open PRs against `storybookjs/storybook`, pulled
directly via `gh api`, not summarized secondhand:

| PR | Author | Real `agent-scan` label | Disclosure in PR body | Maintainer's stated correct grade |
|---|---|---|---|---|
| [`#36085`](https://github.com/storybookjs/storybook/pull/36085) | `ethanstoner` | `agent-scan:automated` | *"this PR was written with AI assistance (Claude). A real person (me) is behind it, has reviewed the diff..."* | `mixed` |
| [`#36145`](https://github.com/storybookjs/storybook/pull/36145) | `theRizwan` | `agent-scan:human` | *"Claude Code assisted with the investigation and the patch... I reviewed and tested every change."* | `mixed` |
| [`#36146`](https://github.com/storybookjs/storybook/pull/36146) | `theRizwan` | `agent-scan:human` | identical sentence to #36145, submitted 7 seconds later | `mixed` |

All three are named directly in
[`storybookjs/storybook#36130`](https://github.com/storybookjs/storybook/issues/36130)
and its comments. A Storybook maintainer (`valentinpalkovic`) argued all
three should have graded `mixed`. A co-maintainer of Agent Scan itself
(`huang-julien`) confirmed on the record:

> agent scan does not read data from the PR itself, it scans data from
> GH activity, meaning it watches over someone's behavior in the
> ecosystem rather than within a single PR.

...and pointed to a different tool, [`peakoss/anti-slop`](https://github.com/peakoss/anti-slop)
(824 stars), for "PR specific analysis." I checked it directly: its 34
check rules are generic spam/quality heuristics (description length,
emoji count, commit message verbosity, honeypot traps for prompt
injection) -- **zero disclosure-statement parsing.** So even the affected
tool's own maintainers don't have an answer to this today. That's
stronger evidence than a cold GitHub search would give.

## The anti-gaming design

`src/classify.ts` treats disclosure as one input to a decision table, not
a bypass flag, because a naive "just check for a disclosure sentence"
implementation is trivially gamed by an automated account pasting the
same boilerplate on every PR. Two independent trip-wires, either of
which routes to human review instead of resolving automatically:

1. **Boilerplate detection** -- is this disclosure near-identical
   (Jaccard token similarity >= 0.85) to 2+ of this account's own past
   disclosures? A real contributor describing different changes tends to
   describe them differently.
2. **Diff-plausibility** -- does a claimed "minor" scope match the
   actual diff size?

## Verified against real data, not just synthetic fixtures

`tests/classify.test.ts` (10 tests) proves the mechanism, including the
actual attack: a fully-automated account (0.97 behavioral score) pasting
identical boilerplate across 3 PRs gets a pass on the first two --
indistinguishable at that point from an honest account with consistent
phrasing -- then flagged on the third.

`tests/real-storybook-prs.test.ts` (3 tests) feeds the classifier the
real PR data above and confirms it produces `disclosed-assisted`
(equivalent to the maintainer's own stated correct `mixed` grade) for all
three -- including the genuinely tricky real-world case: `theRizwan`'s
two PRs, 7 seconds apart, word-for-word identical disclosure text. A
too-aggressive boilerplate threshold would wrongly flag that as gaming;
this one correctly doesn't, because catching a real repeat-boilerplate
attacker requires more than one occurrence to distinguish from an honest
contributor who just phrases things consistently.

13/13 passing.

## Known open items / next steps

- **Thresholds are illustrative, not calibrated.** The 0.6 behavioral
  cutoff, 0.85 similarity, 2-repeat boilerplate count, and 200-line/
  10-file "minor" ceiling need validation against a real labeled corpus
  before this is more than a sketch -- the same discipline
  `llm-cache-usage-lib`'s pricing table was held to.
- **Doesn't yet model Agent Scan's "sticky" community-flag state.** The
  same maintainer thread reveals accounts flagged by community report
  stay flagged "until report and proof," independent of any single PR's
  quality. Whether a well-disclosed PR should even be able to move that
  needle is a separate, unaddressed design question this sketch doesn't
  touch.
- **Upstream PR vs. standalone tool still undecided** -- same tradeoff
  raised in `llm-cache-usage-lib`'s brief. Given Agent Scan's maintainers
  are active in the same thread asking for exactly this, a direct PR may
  land faster than a competing tool.
- Not yet built as an actual GitHub Action or integration -- this is the
  scoring core only.
- No CI yet. Not published to npm.

## License

MIT
