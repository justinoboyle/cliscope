# Contributing

Source changes use the MIT license. Open a pull request from a branch or fork.

## Development

Install Node.js 26.9.0 and npm, then run:

```sh
npm ci
npm run check
npm test
npm run build
npm run build:binary
```

Builds write npm files to `dist/` and the standalone executable to `artifacts/`.
Build the executable on its target operating system and CPU architecture.

Follow [the engineering checks](docs/engineering.md) for types, validation, tests,
and performance. Use synthetic history fixtures. Do not commit personal history,
tokens, or credentials.

## Pull requests and merges

Create a branch from `main`. Describe the behavior change and its tests.
Use a conventional commit
title, for example `fix: handle multiline fish history` or
`feat: add a JSON export`. Explain migration when existing behavior changes.
The release contract determines the version; commit prefixes do not override it.

Wait for **Quality gate** before merging. It requires native builds and installed
npm package tests to pass. Squash merges and ordinary merge commits are supported.
Resolve conflicts on the feature branch and rerun checks. Do not force-push `main`
or move published release tags.

Merging starts automatic version selection and publication. Do not edit release
versions, a changelog, or the generated contract lock. See [the release procedure](docs/releases.md).
