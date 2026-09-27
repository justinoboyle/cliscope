# Engineering requirements

Executable rules have one source:

| Rule                                              | Owner                                   |
| ------------------------------------------------- | --------------------------------------- |
| Compiler strictness and source inclusion          | [tsconfig.json](../tsconfig.json)       |
| Type-aware lint, complexity, nesting, duplication | [.oxlintrc.json](../.oxlintrc.json)     |
| Formatting                                        | [.oxfmtrc.json](../.oxfmtrc.json)       |
| Local checks and lifecycle allowlist              | [package.json](../package.json)         |
| Native and installed-package matrices             | [CI](../.github/workflows/ci.yml)       |
| Performance assertions and budgets                | [benchmark.ts](../scripts/benchmark.ts) |

Use the [contributor commands](../CONTRIBUTING.md#development). Hooks invoke those
scripts; CI is the shared enforcement boundary because local hooks can be bypassed.
Do not weaken checks to make a change pass. A narrowly documented false-positive
suppression requires a regression test or a precise explanation.

## Design

Validate external input before it enters the typed model. Keep history parsing
and aggregation pure, I/O at the edge, and domain records readonly. Share counting,
formatting, and derived statistics across output modes. Split functions by their
responsibility, not merely to move branches out of a complexity score.

Keep one implementation of each behavior. Prefer concrete interfaces and small
named functions over speculative abstractions. Explain dependency changes and
retain required upstream license text. Use the [security policy](../SECURITY.md)
for fixture and disclosure requirements.

## Verification limits

Property tests check conservation, ordering, immutability, parser totality, and
output bounds; they do not prove arbitrary shell semantics. The
[manual](manual.md) defines interpretation limits. Compiler library checking is
configured separately from application checking; declared types do not replace
boundary validation.

Review Python, shell, and embedded workflow control flow manually: the JavaScript
lint rules do not score those languages. Record evidence in the [audit](audit.md).
Use the [installed-package procedure](../.agents/skills/cliscope-maintenance/SKILL.md#consumer-runtime-regression)
for distribution changes and the [release procedure](releases.md) for publication.

File measured performance defects before fixing them. Preserve result assertions
and budgets, compare on the same runtime and host, and record fixtures, samples,
and limits in the [performance audit](performance.md). Distinguish heap limits
from resident memory and startup from helper timings.
