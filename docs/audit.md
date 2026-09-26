# Maintainability audit

Reviewed on 2026-09-26 during preparation of 0.2.0. This report records source
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

| Files                                                                                                                         | Review result                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/history.ts`                                                                                                              | Separate Bash, Zsh, and Fish format readers share record collection and timestamp validation. No shell execution or I/O.                                                                                                       |
| `src/shell-lexer.ts`                                                                                                          | A local scanner owns its cursor and token state. Named readers handle quoting, substitutions, comments, and operators. Methods pass the complexity limit.                                                                      |
| `src/shell-tools.ts`                                                                                                          | Wrapper option handling and command recognition are separate from lexing. A discriminated result controls iteration without recursion or unchecked casts.                                                                      |
| `src/analyze.ts`, `src/types.ts`                                                                                              | Readonly records, deterministic ordering, inclusive filtering, and undated records remain shared. A bounded per-call cache avoids repeated extraction; numeric UTC-day keys preserve negative epochs.                          |
| `src/render.ts`, `src/calendar.ts`, `src/export.ts`                                                                           | Terminal sanitization, width handling, ranking rows, calendar output, and weekday statistics have shared implementations. CSV encoding stays at the export boundary.                                                           |
| `src/interactive-state.ts`, `src/interactive.ts`                                                                              | Pure key/viewport state is separate from OpenTUI construction, drawing, listener ownership, and cleanup. Printable and interactive views reuse formatting.                                                                     |
| `src/options.ts`, `src/io.ts`, `src/cli.ts`                                                                                   | CLI validation, bounded regular-file reads, orchestration, and exclusive output creation have separate owners. Errors leave through one command boundary.                                                                      |
| `src/launcher.ts`, `src/demo.ts`                                                                                              | The consumer launcher resolves its own runtime. Sample data is deterministic and independent of personal history.                                                                                                              |
| `test/history.test.ts`, `test/analyze.test.ts`                                                                                | Example and property tests cover format parsing, quote isolation, totality, conservation, order independence, valid dates, cache rollover, long-command bypass, and negative/zero epochs.                                      |
| `test/render.test.ts`, `test/interactive-state.test.ts`                                                                       | Output width, terminal-control removal, Unicode handling, keyboard transitions, and viewport bounds are tested independently of terminal I/O.                                                                                  |
| `test/calendar.test.ts`, `test/export.test.ts`                                                                                | An independent calendar oracle checks quiet-day denominators, leap/year boundaries, normalized scores, width bounds, and sparse millennia. Export tests check CSV quoting/formula prefixes and complete machine-readable rows. |
| `test/cli.test.ts`, `test/io.test.ts`, `test/options.test.ts`                                                                 | Synthetic fixtures cover discovery, size limits, and option rejection. A bounded subprocess test proves FIFO rejection without waiting for a writer. Independent expected fixtures remain local.                               |
| `scripts/build-package.ts`, `scripts/bundle-licenses.ts`, `scripts/build-binary.ts`                                           | npm bundling and host-native compilation are distinct operations. The npm build retains platform dispatch and collects dependency license text. Shared license traversal has one implementation.                               |
| `scripts/benchmark.ts`                                                                                                        | Warmup, five-sample medians, assertions, and budgets are shared across tests and builds. Repeated/distinct extraction costs and package/native startup are measured separately; phase files preserve results.                  |
| `scripts/smoke-package.mjs`                                                                                                   | The installed tarball is exercised outside the checkout using the selected Node runtime. Expected reports are independent fixtures, not imported production calculations.                                                      |
| `scripts/test-terminal.py`                                                                                                    | Manual review covers VT screen reconstruction, PTY lifecycle, bounded waits/output, interaction, and cleanup. Tests inspect current screen contents rather than stale accumulated output. POSIX-only execution is explicit.    |
| `scripts/install-hooks.mjs`, `.githooks/pre-commit`, `.githooks/pre-push`                                                     | Hooks invoke package scripts instead of duplicating verification commands. Hook installation remains local to the checkout.                                                                                                    |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml`                                                                   | CI owns the native and installed-package matrices; the release workflow calls it. Inline validation is limited to tag/version/ancestry and simple smoke assertions. Publication depends on successful verification.            |
| `package.json`, `package-lock.json`, `.npmrc`                                                                                 | Consumer runtime and platform packages are separated from build-only dependencies. Versions are pinned; engine declarations match the oldest consumer test.                                                                    |
| `tsconfig.json`, `tsconfig.build.json`, `.oxlintrc.json`, `.oxfmtrc.json`                                                     | Compiler, lint, and format settings each have one owner. The declaration-build config extends the main compiler config.                                                                                                        |
| `.editorconfig`, `.gitattributes`, `.gitignore`                                                                               | Text conventions and generated-file exclusions are small declarative lists without executable control flow.                                                                                                                    |
| `README.md`, `CONTRIBUTING.md`, `docs/releases.md`, `docs/engineering.md`, `CHANGELOG.md`, `.github/PULL_REQUEST_TEMPLATE.md` | User behavior, contributor checks, release procedure, engineering constraints, and change history have separate purposes. Cross-links replace repeated procedures.                                                             |
| `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`                                                                                | Project policies and upstream-required legal text are kept separate from runtime and contributor instructions.                                                                                                                 |
| `AGENTS.md`, `.agents/skills/cliscope-maintenance/SKILL.md`, `docs/style.md`, `docs/audit.md`                                 | Repository memory links to the engineering and writing rules. The skill records the observed consumer-runtime regression without introducing a new approval process.                                                           |

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

The installed npm tarball also passed nine consumer smoke checks under Node
20.13.1 on macOS, a real `npm exec` invocation, and the POSIX terminal interaction
test after the native-runtime resolution fix. Installation used `--engine-strict --ignore-scripts`. Workflow syntax passed `actionlint`. These local checks do not
substitute for the remaining CI matrix.

## Remaining limits

The parser recognizes lexical commands, not execution outcomes. Alias resolution,
substitution execution, and complete shell-program interpretation remain outside
its contract. Windows terminal interaction is not covered by the POSIX PTY
runner; Windows still receives installed-package and native-build checks.
Cross-platform workflow results must be read from CI, not inferred from a local
macOS pass. Python and workflow fragments need manual complexity review when
changed until language-specific automated checks are added.
