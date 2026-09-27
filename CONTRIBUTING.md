# Contributing

Source changes use the [MIT license](LICENSE). Open a pull request from a branch
or fork. Use synthetic fixtures and follow the [security policy](SECURITY.md)
when reporting sensitive problems.

## Development

Use the development Node version selected by [CI](.github/workflows/ci.yml):

```sh
npm ci
npm run dev -- --demo
npm run verify
```

[Package scripts](package.json) define the complete local gate and its individual
commands. Builds write npm files to `dist/` and host-native executables to
`artifacts/`. Follow [engineering requirements](docs/engineering.md),
[writing rules](docs/style.md), and the
[installed-package procedure](.agents/skills/cliscope-maintenance/SKILL.md#consumer-runtime-regression)
when applicable.

## Pull requests

Branch from `main`. Use a conventional commit title, such as
`fix: handle multiline fish history`. Describe the resulting behavior, validation,
and any migration. Resolve conflicts on the branch and rerun checks.

Wait for **Quality gate** before merging. Do not force-push `main`.
[Releases](docs/releases.md) defines supported merges, automatic version selection,
and publication; commit prefixes do not select a version.
