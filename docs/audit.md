# Maintainability audit

Reviewed 2026-09-26, beginning with the 0.2.0/0.2.1 preparation. This records
source inspection and observed checks, not completion of every CI job.
[Engineering requirements](engineering.md) owns design and enforcement rules;
[performance](performance.md) and [security](../security_best_practices_report.md)
own their findings and evidence.

## Scope

Reviewed authored source, tests, scripts, workflows, configuration, and prose.
Generated output, dependencies, and Git internals were excluded from source
review; package and lockfile classifications were compared. Python, shell,
workflow fragments, and documentation received manual review. Automated
identical-function detection does not establish that all duplication is absent.

| Boundary                | Review                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| History and aggregation | Format readers, lexer, command recognition, and aggregation have separate owners; tentative counts are discarded on invalid records. |
| Presentation            | Rendering, calendar statistics, and export encoding are shared; pure keyboard state is separate from terminal lifecycle.             |
| Input and execution     | Options, regular-file reads, output creation, orchestration, and runtime resolution are separate boundaries.                         |
| Tests                   | Independent expectations cover parsers, count conservation, dates, Unicode, CSV, discovery, FIFO rejection, and terminal state.      |
| Builds                  | Host-native compilation and npm bundling share license collection; archives retain upstream notices.                                 |
| Automation              | Hooks invoke package scripts; CI owns matrices; typed release helpers own classification and recovery.                               |
| Configuration           | Compiler, lint, formatting, dependency metadata, and file conventions each have one owner.                                           |
| Documentation           | User behavior, contribution, release procedures, engineering rules, evidence, and legal policies remain separate and cross-linked.   |

The initial parser split passed 15 example/property tests with 3,000 generated
cases; a later analyzer/calendar/export/filesystem pass ran 21 tests. Full lint
passed after the refactor. These are historical observations, not current suite
counts. Read subsequent CI results for cross-platform status.

## Consumer and terminal regressions

The installed npm tarball passed nine smoke checks, a real `npm exec`, and the
POSIX terminal harness on Node 20.13.1 after native-runtime resolution was fixed.
The failure and maintained procedure live in the
[maintenance skill](../.agents/skills/cliscope-maintenance/SKILL.md#consumer-runtime-regression).

In [CI run 36272411362](https://github.com/justinoboyle/cliscope/actions/runs/36272411362),
the macOS Intel terminal test reconstructed only a frame's tail after resizing.
The harness had erased its cells and inspected an unfinished synchronized frame.
It now preserves overlapping cells/cursor positions, waits for complete frames,
and proves the compact layout appeared before expanding. Exact selected-tool
count/share assertions remain; timeouts were not increased.

The in-script regression covers cell preservation and frame markers split
across reads. Local validation passed ten launcher and ten standalone interaction
runs. Both also passed with reads limited to 37 bytes; captured output had matching
frame starts/ends. See [test-terminal.py](../scripts/test-terminal.py) for the
bounded PTY lifecycle. A local result does not imply an Intel CI pass.

## Archive regressions

The scoped-package converter rejects traversal, links, and special files before
extraction, disables lifecycle scripts, and compares payload hashes and remaining
manifest fields after repacking. A plain object originally missed `__proto__`;
a `Map` and [regression tests](../test/package-github.test.ts) detect its removal.
Both package names passed the shared installed smoke and terminal tests locally.
Registry installation is covered by the [release procedure](releases.md).

[Release run 36273007264](https://github.com/justinoboyle/cliscope/actions/runs/36273007264)
passed `package/cliscope-0.2.0.tgz` to npm, which interpreted it as a GitHub
reference and ran `git ls-remote`. Using `./package/cliscope-*.tgz` fixed resolution.
CI dry-runs the explicit archive path; only that dry run uses `--force` to permit
an already-published version. An isolated check of the actual 0.2.0 tarball passed.
This tested path resolution, not OIDC authorization or publication.

## Release contract regressions

[Releases](releases.md) owns the contract and recovery rules. Tests exercise
canonical bytes, classifications, malformed inputs, numeric overflow, and version
stamping. Fake GitHub/npm commands check partial recovery, matching retries,
authentication failures, and hash conflicts without registry mutations.

[#21](https://github.com/justinoboyle/cliscope/issues/21) adds the interpreter line
to behavior fingerprints: TypeScript's syntax tree omits it, but npm bundling
preserves it. Tests change, remove, and add interpreter arguments while retaining
ordinary formatting/comment normalization.

[#22](https://github.com/justinoboyle/cliscope/issues/22) captures semantic
`tsconfig.json`. Remapping `string-width` to `src/demo.ts` changed a successful
bundle into a missing-export failure while the old contract remained identical.
Tests now classify semantic configuration changes as breaking and equivalent
JSONC formatting as unchanged. Unsupported configuration fails extraction.

[#26](https://github.com/justinoboyle/cliscope/issues/26) removes redundant
reservation downloads. Tests prove matching existing assets use GitHub's digest
without downloading or uploading again; absent, null, and conflicting digests
fail. Recovery still downloads and verifies the originally reserved archives.

[#24](https://github.com/justinoboyle/cliscope/issues/24) and
[#27](https://github.com/justinoboyle/cliscope/issues/27) close manifest gaps for
peer metadata and required-versus-optional dependencies. End-to-end tests prove
changing a dependency's role is breaking even when its version and resolved
package identity stay unchanged.

[#25](https://github.com/justinoboyle/cliscope/issues/25) captures artifact-producing
workflow configuration. Changing a native archive command now changes the contract;
comments and display-name edits do not. The same extractor successfully read
actual `v0.2.1` and candidate sources, retaining the same platform list. The
23-test contract pass covered inherited settings, unsupported structures, and
breaking classification. See [contract rules](releases.md#contract-lock).
