# Enforced engineering rules

Validate external input before passing it to the typed model. Run the checks below before merging. Follow [style.md](style.md) for prose and [the maintenance skill](../.agents/skills/cliscope-maintenance/SKILL.md) for packaging regressions.

| Boundary   | Hard rule                                                                                                       | Enforcement                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| CLI input  | Known flags only; top is an integer from 1–100; valid UTC dates; incompatible modes rejected                    | Node `parseArgs`, strict Zod schema, branded `TopLimit`, negative tests |
| Filesystem | Regular files only, 64 MiB limit checked before and during reading, close handles even on errors                | `readHistoryFile`, nonblocking open, integration tests                  |
| History    | Inert text, finite timestamps in years 0000–9999, explicit unknown timestamps                                   | Pure format parsers and property tests                                  |
| Domain     | Readonly records; discriminated unions; total count equals sum of tool counts; deterministic ties; valid shares | Strict compiler and property tests                                      |
| Display    | Strip terminal instructions and control characters; respect Unicode cell widths and terminal width              | Single rendering boundary and generated Unicode tests                   |
| Async code | Handle promises and unknown errors explicitly                                                                   | Type-aware Oxlint rules                                                 |
| Commit     | Compiler, lint, formatting must pass                                                                            | Repository pre-commit hook                                              |
| Push       | Checks, tests, JS build, native build must pass                                                                 | Repository pre-push hook                                                |
| Merge      | Five native builds and twelve installed-package checks must pass                                                | Required CI `Quality gate`                                              |
| Release    | Annotated stable SemVer tag equals package version and is reachable from main; every platform verifies first    | Release workflow                                                        |

## Compiler rules

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, and `erasableSyntaxOnly` are enabled. The npm build bundles application JavaScript and emits source maps. `build:types` emits declarations separately.

`skipLibCheck` skips validation of third-party declaration internals; application usage of those declarations is still checked. Boundary validation is required for external data regardless of its declared TypeScript type. Internal pure functions receive typed values established by those boundaries.

## Lint and design rules

No explicit `any`, non-null assertions, type-assertion escapes, unsafe assignments/arguments/calls/member access/returns, unhandled promises, misused promises, non-Error throws, or `eval`/`Function` execution. Require explicit function return types, type-only imports, exhaustive discriminated-union switches, and consistent formatting. No disabling checks to satisfy CI. A narrowly documented false-positive suppression requires a regression test or precise explanation.

Every authored JavaScript and TypeScript function must have SonarJS cognitive complexity at most 15 and nesting depth at most 4. Duplicate function bodies fail lint. These rules include tests and build scripts. Review Python, shell, and workflow control flow manually; the JavaScript rules do not measure those languages. Record the review in [audit.md](audit.md). Split functions by responsibility, not merely to move branches out of the scorer's view.

Keep I/O at the edge. `history.ts` and `analyze.ts` are pure; `io.ts` reads files; `options.ts` validates user input; `render.ts` formats output; `interactive.ts` owns terminal lifecycle; `cli.ts` orchestrates. Prefer readable domain interfaces and small functions over clever generic abstractions. `as const` preserves literals without claiming an unchecked runtime type.

Property tests verify conservation of counts, ordering independence, input immutability, bounded shares, parser totality, quote isolation, and terminal width. They provide evidence over generated inputs, not a mathematical proof of arbitrary shell semantics. The parser deliberately documents its limits.

Hooks can be bypassed by Git, so CI and protected branches are the shared enforcement boundary. Run `npm run verify` before requesting review. Lockfile changes must explain dependency updates; lifecycle scripts are explicitly allowlisted by pinned version.

## Performance

`npm test`, `npm run build`, and `npm run build:binary` run the same benchmark suite. Test output records the duration of each test. Build scripts report build time; benchmark output reports five-sample medians after warmup. The suite covers 100,000 history records, repeated and distinct commands, rendering, calendar calculations, and package or binary startup. Each case checks its result before comparing time against a fixed budget.

Keep budgets in `scripts/benchmark.ts`. A budget failure fails the command and CI. Investigate a regression before changing its budget. Shared runners vary, so budgets permit machine variation; compare measurements on the same host when assessing an optimization. CI saves `artifacts/performance-*.json` with runtime, platform, architecture, resident memory, and samples.

Aggregation caches at most 1,024 command strings of at most 4,096 characters each. It counts UTC days numerically and formats dates once per day. On the development machine, these changes reduced the repeated-command benchmark from about 170 ms to 6 ms for 100,000 records. The distinct-command case is measured separately so caching cannot hide its cost. These figures describe the synthetic fixture, not every history file.

## Primary references

- [TypeScript compiler options](https://www.typescriptlang.org/tsconfig/): strictness, indexed access, optional-property semantics, and compiler checks.
- [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html): type guards and discriminated unions.
- [Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware): unsafe-value and promise checks backed by the type system.
- [Zod basics](https://zod.dev/basics): parsing unknown values into validated data and handling failures.
- [OpenTUI lifecycle](https://opentui.com/docs/core-concepts/lifecycle-and-cleanup/): renderer ownership and cleanup.
