# Maintainability audit

Reviewed on 2026-09-26 during preparation of 0.2.0 and 0.2.1. This report records source
inspection and local checks; it does not assert that every operating-system job
has completed or that the shell parser has a formal correctness proof.

## Scope and enforcement

Every authored source, test, script, workflow, configuration file, and document
was included in the review below. Generated `dist/`, `artifacts/`, installed
dependencies, and Git internals are excluded from source review. The npm lockfile
is generated dependency metadata; its version and dependency classifications
were checked against `package.json`.

`npm run lint` passed after the refactor. The current Oxlint configuration applies
SonarJS cognitive complexity of at most 15, nesting depth of at most 4, and the
identical-function rule to authored JavaScript and TypeScript. It also enforces
the type-aware rules described in [engineering requirements](engineering.md).
These checks include test callbacks and build scripts; generated output and
dependencies are excluded. Identical-function detection is not a proof that all
duplication has been removed.

Python, shell, YAML, JSON, and Markdown are outside SonarJS scoring. Their control
flow and repetition were reviewed manually. The YAML shell/JavaScript fragments
are also outside file-based linting. These are explicit enforcement limits, not
claims of automated complexity scores for those languages.

## File review

| Files                                                                                                         | Review result                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/history.ts`                                                                                              | Separate Bash, Zsh, and Fish format readers share record collection and timestamp validation. No shell execution or I/O.                                                                                                               |
| `src/shell-lexer.ts`                                                                                          | A local scanner owns its cursor and token state. Named readers handle quoting, substitutions, comments, and operators. Methods pass the complexity limit.                                                                              |
| `src/shell-tools.ts`                                                                                          | Wrapper option handling and command recognition are separate from lexing. Bounded lexical and invocation state avoids retained argument arrays; tentative counts are discarded if a record fails validation.                           |
| `src/analyze.ts`, `src/types.ts`                                                                              | Readonly records, deterministic ordering, inclusive filtering, and undated records remain shared. A bounded per-call cache avoids repeated extraction; numeric UTC-day keys preserve negative epochs.                                  |
| `src/render.ts`, `src/calendar.ts`, `src/export.ts`                                                           | Terminal sanitization, width handling, ranking rows, calendar output, and weekday statistics have shared implementations. CSV encoding stays at the export boundary.                                                                   |
| `src/interactive-state.ts`, `src/interactive.ts`                                                              | Pure key/viewport state is separate from OpenTUI construction, drawing, listener ownership, and cleanup. Printable and interactive views reuse formatting.                                                                             |
| `src/options.ts`, `src/io.ts`, `src/cli.ts`                                                                   | CLI validation, bounded regular-file reads, orchestration, and exclusive output creation have separate owners. Errors leave through one command boundary.                                                                              |
| `src/launcher.ts`, `src/demo.ts`                                                                              | The consumer launcher resolves its own runtime. Sample data is deterministic and independent of personal history.                                                                                                                      |
| `test/history.test.ts`, `test/analyze.test.ts`                                                                | Example and property tests cover format parsing, quote isolation, totality, conservation, order independence, valid dates, cache rollover, long-command bypass, and negative/zero epochs.                                              |
| `test/render.test.ts`, `test/interactive-state.test.ts`                                                       | Output width, terminal-control removal, Unicode handling, keyboard transitions, and viewport bounds are tested independently of terminal I/O.                                                                                          |
| `test/calendar.test.ts`, `test/export.test.ts`                                                                | An independent calendar oracle checks quiet-day denominators, leap/year boundaries, normalized scores, width bounds, and sparse millennia. Export tests check CSV quoting/formula prefixes and complete machine-readable rows.         |
| `test/cli.test.ts`, `test/io.test.ts`, `test/options.test.ts`                                                 | Synthetic fixtures cover discovery, size limits, and option rejection. A bounded subprocess test proves FIFO rejection without waiting for a writer. Independent expected fixtures remain local.                                       |
| `scripts/build-package.ts`, `scripts/bundle-licenses.ts`, `scripts/build-binary.ts`                           | npm bundling and host-native compilation are distinct operations. The npm build retains platform dispatch and collects dependency license text. Shared license traversal has one implementation.                                       |
| `scripts/benchmark.ts`                                                                                        | Warmup, five-sample medians, assertions, and budgets are shared across tests and builds. Repeated/distinct extraction costs and package/native startup are measured separately; phase files preserve results.                          |
| `scripts/smoke-package.mjs`                                                                                   | The installed tarball is exercised outside the checkout using the selected Node runtime. Expected reports are independent fixtures, not imported production calculations.                                                              |
| `scripts/test-terminal.py`                                                                                    | Manual review covers VT screen reconstruction, PTY lifecycle, bounded waits/output, interaction, and cleanup. Tests inspect current screen contents rather than stale accumulated output. POSIX-only execution is explicit.            |
| `scripts/install-hooks.mjs`, `.githooks/pre-commit`, `.githooks/pre-push`                                     | Hooks invoke package scripts instead of duplicating verification commands. Hook installation remains local to the checkout.                                                                                                            |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml`                                                   | CI owns the native and installed-package matrices; the release workflow calls it. Typed release helpers own contract extraction, classification, immutable reservations, and recovery. Publication depends on successful verification. |
| `package.json`, `package-lock.json`, `.npmrc`                                                                 | Consumer runtime and platform packages are separated from build-only dependencies. Versions are pinned; engine declarations match the oldest consumer test.                                                                            |
| `tsconfig.json`, `tsconfig.build.json`, `.oxlintrc.json`, `.oxfmtrc.json`                                     | Compiler, lint, and format settings each have one owner. The declaration-build config extends the main compiler config.                                                                                                                |
| `.editorconfig`, `.gitattributes`, `.gitignore`                                                               | Text conventions and generated-file exclusions are small declarative lists without executable control flow.                                                                                                                            |
| `README.md`, `CONTRIBUTING.md`, `docs/releases.md`, `docs/engineering.md`, `.github/PULL_REQUEST_TEMPLATE.md` | User behavior, contributor checks, release procedure, engineering constraints, and change history have separate purposes. Cross-links replace repeated procedures.                                                                     |
| `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`                                                                | Project policies and upstream-required legal text are kept separate from runtime and contributor instructions.                                                                                                                         |
| `AGENTS.md`, `.agents/skills/cliscope-maintenance/SKILL.md`, `docs/style.md`, `docs/audit.md`                 | Repository memory links to the engineering and writing rules. The skill records the observed consumer-runtime regression without introducing a new approval process.                                                                   |

## Refactors and regression evidence

- Split the combined history parser/extractor into format readers, a shell lexer,
  and command recognition. The original wrapper function scored 38 and extraction
  scored 18 before the final split; both now pass the limit of 15.
- Bound extraction reuse to 1,024 command strings of at most 4,096 characters
  within one aggregation call. Cache rollover and long commands preserve counts.
  Extracted arrays are read-only and never mutated. Numeric UTC-day accumulation
  uses floor division, preserving pre-epoch dates; formatting occurs once per day.
- Separate interactive keyboard state from rendering and terminal lifecycle.
  Share ranking, calendar, and weekday formatting across output modes instead of
  reproducing their calculations in the terminal interface.
- Replace consumer Node FFI execution with a Node-compatible launcher and pinned
  Bun runtime. The observed `npx cliscope -i` failure on Node 20.13.1 is retained
  in the maintenance skill. Test the installed tarball with lifecycle scripts
  disabled; the Bun package's unresolved placeholder is not a usable executable.
- Preserve third-party license texts when bundling dependencies. Consumer
  installs no longer need the build-only OpenTUI JavaScript package and its Node
  FFI engine declaration. Native archives include the same generated notices.
- Centralize writing rules in [style.md](style.md). Keep option/help wording,
  default report content, and documentation tied to observable behavior.

The initial parser refactor passed 15 example/property tests, including 3,000
generated cases. The final review reran 21 analyzer, calendar, export, and
filesystem tests, including cache rollover and FIFO rejection; all passed.
The complete repository lint command also passed.

The repeated-command aggregation benchmark improved from approximately 170 ms
before caching to 5.5–6.4 ms for 100,000 records in local runs. A separate
100,000-distinct-command run measured 166 ms. That review run measured 28 ms for
parsing 100,000 Zsh records and 405 ms for extracting 100,000 command chains.
All remained within the tightened budgets. Differences between local runs include
concurrent machine load; these synthetic fixtures do not predict every history.

Tests, npm builds, and native builds invoke the benchmark suite. Package and
native builds additionally check their respective executable startup budgets.
Use `artifacts/performance-test.json`, `performance-package.json`, and
`performance-binary.json` for the current measurements, runtime, platform,
architecture, resident memory, and samples. `performance.json` contains the most
recent phase. Build scripts also report elapsed build time.

The 0.2.1 lexer consumes contiguous ordinary unquoted characters with a
scanner-local sticky regular expression. Whitespace, quoting, expansions,
operators, and other shell syntax retain their existing readers. The change
removes per-character dispatch without introducing shared mutable state or
caching the benchmark's input. An isolated seven-sample comparison measured
100,000 command chains at 294 ms before and 218 ms after the change, and distinct
command extraction at 135 ms before and 71 ms after. All 40,000 differential
generated commands matched the previous implementation. The unchanged history
property suite and an added adjacent-quote/Unicode/expansion regression passed.
The repository benchmark then measured approximately 194 ms for 100,000 chains
and 73 ms for aggregation of 100,000 distinct commands. Existing budgets remain
unchanged; hosted-runner performance still requires CI verification.

The installed npm tarball also passed nine consumer smoke checks under Node
20.13.1 on macOS, a real `npm exec` invocation, and the POSIX terminal interaction
test after the native-runtime resolution fix. Installation used `--engine-strict --ignore-scripts`. Workflow syntax passed `actionlint`. These local checks do not
substitute for the remaining CI matrix.

The macOS Intel standalone job in [CI run 36272411362](https://github.com/justinoboyle/cliscope/actions/runs/36272411362)
timed out after resizing back to the full dashboard. Its reconstructed screen
contained only the tail of a frame. The PTY harness erased all modeled cells on
resize and evaluated content before OpenTUI's synchronized frame had completed.
It now preserves overlapping cells and cursor positions, waits for the completed
frame marker, and requires a new frame with the compact layout before expanding.
The full-size assertion still requires the selected tool's exact count and share.
Timeouts were not increased. An in-script regression covers cell preservation and
frame markers split across reads. Local macOS validation passed ten complete
interaction runs for the Node launcher and ten for the standalone executable.
Both also passed with PTY reads restricted to 37 bytes; captured native output
contained matching synchronized-frame starts and ends. These checks establish
the harness behavior locally; the macOS Intel job must still pass in CI.

## Remaining limits

The parser recognizes lexical commands, not execution outcomes. Alias resolution,
substitution execution, and complete shell-program interpretation remain outside
its contract. Windows terminal interaction is not covered by the POSIX PTY
runner; Windows still receives installed-package and native-build checks.
Cross-platform workflow results must be read from CI, not inferred from a local
macOS pass. Python and workflow fragments need manual complexity review when
changed until language-specific automated checks are added.

## GitHub Packages

The registry conversion in `scripts/package-github.ts` changes only the
package name. It validates the input manifest and archive entries before
extraction, then compares every payload file's SHA-256 and all remaining
manifest fields after repacking. Tests reject links, devices, and paths outside
the package directory and verify that lifecycle scripts do not run. File hashes
use a `Map`: a review caught that a plain object omitted a file named
`__proto__`. The regression now detects that file being dropped during repacking.

The scoped archive passed the shared nine-check consumer suite and terminal
interaction tests under Node 20.13.1 and the development Node runtime after
installation outside the checkout with lifecycle scripts disabled. CI repeats
these checks, and the release job installs the published GitHub package and
tests it again. The registry conversion and its tests pass the same compiler,
lint, and complexity checks as application code.

The [security review](../security_best_practices_report.md) records disclosure
checks and the runtime fixes. The [performance audit](performance.md) retains
measured before/after results, fixtures, and remaining limits. Each measured
issue was filed before implementation and has a result-checking regression.

## npm archive path regression

The npm publishing job in [release run 36273007264](https://github.com/justinoboyle/cliscope/actions/runs/36273007264)
passed `package/cliscope-0.2.0.tgz` to npm. npm interpreted that relative spelling
as a GitHub package reference and attempted `git ls-remote`, so publication failed
after the binary release succeeded. The command now uses the explicit file path
`./package/cliscope-*.tgz`.

The CI pack job exercises that same path with `npm publish --dry-run` before
uploading the tarball. Its dry run also uses `--force` because npm otherwise
rejects a version already present in the registry, including during dry runs.
Only the dry run uses this flag; the release publish retains npm's version check.
An isolated dry run against the actual 0.2.0 tarball resolved its manifest and
contents and returned success without publishing. This checks archive resolution,
not OIDC authorization or a registry upload.

## Automatic release review

The contract generator, classifier, stamping helper, reservation model, registry
publisher, artifact recovery, and workflow driver have separate modules. The
contract lock has no release version; immutable tag names supply versions.
Public structures are extracted from source without executing either revision.
Unclassified runtime changes receive a conservative breaking classification.
Unknown extraction patterns fail explicitly.

Tests cover canonical contract bytes, compatible additions, removals, default
changes, semantic fingerprints, dependency identities, malformed inputs, numeric
overflow, and consistent build stamping. Fake GitHub and npm commands exercise
partial recovery, matching publication retries, authentication failures, and
hash conflicts without mutating a registry. The workflow dispatches publication
at the reserved tag so provenance identifies the source that passed CI.

The [release procedure](releases.md) owns the workflow and recovery instructions;
the maintenance skill links to it. Commits, tags, and generated GitHub release
notes replace the manually maintained changelog. CI receives a source commit and
one release version, stamps disposable manifests, and tests both package names.

DeepSec finding [#18](https://github.com/justinoboyle/cliscope/issues/18) identified
npm's dependency-bin PATH injection at the privileged release subprocess
boundary. The workflow now runs the controller directly through Node.
`scripts/release-io.ts` removes dependency and relative PATH entries, checkout and
command-working-directory descendants, and symlink aliases into those paths.
It preserves trusted external tool directories and refuses an empty trusted
search path. PATH key normalization avoids ambiguous case variants in child
environments.

The new `test/release-path.test.ts` verifies directory filtering and runs a
hostile dependency shim before a trusted fake tool; only the trusted tool
executes. The existing artifact-recovery test also passes through the sanitized
boundary. These tests make no network calls. The source passes type checking and
type-aware lint; executable-shim coverage is POSIX-only because privileged
release orchestration uses Ubuntu.

DeepSec finding [#19](https://github.com/justinoboyle/cliscope/issues/19) exposed
zero-width combining sequences that satisfied the terminal-cell limit while
emitting arbitrarily long labels. `fitText` now also limits output to 16 UTF-16
units per requested cell and limits grapheme segmentation to that size plus one
lookahead unit. An uncertain final sampled grapheme is omitted whole; zero width
emits nothing. This retains complete ordinary graphemes and prevents partial
surrogate output at the sample boundary. Full-input control sanitization remains
linear. Tests cover exact hostile outputs, generated output/cell bounds, ordinary
Unicode, and report size; the benchmark checks a 500,000-mark label. See the
[performance evidence](performance.md) for raw samples and output-byte counts.
