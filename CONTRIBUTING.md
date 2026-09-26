# Contributing

Contributions are welcome from collaborators with repository access. The source
uses the MIT license; the repository's private visibility is a separate setting.

## Development

Install Node.js 26.4 or later and npm, then run:

```sh
npm ci
npm run check
npm test
npm run build
npm run build:binary
```

The lockfile pins dependencies, including the Bun compiler used to produce a
standalone executable in `artifacts/`. End users of this binary do not need
Node.js, Bun, or npm. The native OpenTUI dependency requires building on a
supported operating system and CPU architecture.

Keep code small, explicit, and readable. Use domain types and discriminated unions
to represent valid states; validate data at runtime boundaries. Do not hide type
errors with `any`, broad assertions, or unchecked non-null assertions. Strict
TypeScript and Oxlint checks are required, along with formatting. Runtime tests
are still necessary: a successful typecheck is not a formal correctness proof.

Add focused tests for parser and aggregation behavior. Prefer invariant and
boundary tests over tests that duplicate implementation details. Use invented
history fixtures; never check in personal histories, tokens, or credentials.
Keep history analysis local and avoid logging complete history records.

## Pull requests and merges

Create a short-lived branch from `main` and open a pull request with a clear
description, relevant tests, and a changelog entry. Use a conventional commit
title, for example `fix: handle multiline fish history` or
`feat: add a JSON export`. Use `!` for a breaking change and explain migration.

CI checks every supported binary platform and reports a single **Quality gate**
status for branch protection. Require that status before merging. Prefer squash
merges to keep one reviewed change per commit; ordinary merge commits are also
supported when preserving a branch's history is useful. Avoid rebasing published
release tags or force-pushing `main`. Resolve merge conflicts in the feature
branch and rerun the checks before merging.

Tag releases only after the version and changelog changes have landed on `main`.
See [the release procedure](docs/releases.md).
