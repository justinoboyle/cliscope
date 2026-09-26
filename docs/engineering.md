# Enforced engineering rules

Types express the internal model; runtime parsers establish that external input actually satisfies it. These checks are executable requirements, not reviewer preferences.

| Boundary   | Hard rule                                                                                                       | Enforcement                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| CLI input  | Known flags only; top is an integer from 1–100; valid UTC dates; incompatible modes rejected                    | Node `parseArgs`, strict Zod schema, branded `TopLimit`, negative tests |
| Filesystem | Regular files only, 64 MiB limit checked before and during reading, close handles even on errors                | `readHistoryFile`, nonblocking open, integration tests                  |
| History    | Inert text, finite representable timestamps, explicit unknown timestamp state                                   | Pure format parsers and property tests                                  |
| Domain     | Readonly records; discriminated unions; total count equals sum of tool counts; deterministic ties; valid shares | Strict compiler and property tests                                      |
| Display    | Strip terminal instructions and control characters; respect Unicode cell widths and terminal width              | Single rendering boundary and generated Unicode tests                   |
| Async code | Handle promises and unknown errors explicitly                                                                   | Type-aware Oxlint rules                                                 |
| Commit     | Compiler, lint, formatting must pass                                                                            | Repository pre-commit hook                                              |
| Push       | Checks, tests, JS build, native build must pass                                                                 | Repository pre-push hook                                                |
| Merge      | All five platform jobs must pass                                                                                | CI `Quality gate`, required branch protection where supported           |
| Release    | Annotated stable SemVer tag equals package version and is reachable from main; every platform verifies first    | Release workflow                                                        |

## Compiler rules

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, and `erasableSyntaxOnly` are enabled. Published application code is emitted with declarations and source maps.

`skipLibCheck` skips validation of third-party declaration internals; application usage of those declarations is still checked. Boundary validation is required for external data regardless of its declared TypeScript type. Internal pure functions receive typed values established by those boundaries.

## Lint and design rules

No explicit `any`, non-null assertions, type-assertion escapes, unsafe assignments/arguments/calls/member access/returns, unhandled promises, misused promises, non-Error throws, or `eval`/`Function` execution. Require explicit function return types, type-only imports, exhaustive discriminated-union switches, and consistent formatting. No disabling checks to satisfy CI. A narrowly documented false-positive suppression requires a regression test or precise explanation.

Keep I/O at the edge. `history.ts` and `analyze.ts` are pure; `io.ts` reads files; `options.ts` validates user input; `render.ts` formats output; `interactive.ts` owns terminal lifecycle; `cli.ts` orchestrates. Prefer readable domain interfaces and small functions over clever generic abstractions. `as const` preserves literals without claiming an unchecked runtime type.

Property tests verify conservation of counts, ordering independence, input immutability, bounded shares, parser totality, quote isolation, and terminal width. They provide evidence over generated inputs, not a mathematical proof of arbitrary shell semantics. The parser deliberately documents its limits.

Hooks can be bypassed by Git, so CI and protected branches are the shared enforcement boundary. Run `npm run verify` before requesting review. Lockfile changes must explain dependency updates; lifecycle scripts are explicitly allowlisted by pinned version.

## Primary references

- [TypeScript compiler options](https://www.typescriptlang.org/tsconfig/): strictness, indexed access, optional-property semantics, and compiler checks.
- [TypeScript narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html): type guards and discriminated unions.
- [Oxlint type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware): unsafe-value and promise checks backed by the type system.
- [Zod basics](https://zod.dev/basics): parsing unknown values into validated data and handling failures.
- [OpenTUI lifecycle](https://opentui.com/docs/core-concepts/lifecycle-and-cleanup/): renderer ownership and cleanup.
