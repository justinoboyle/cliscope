# cliscope

Print command counts and activity graphs from Bash, Zsh, or Fish history.

```sh
npx cliscope
npx cliscope -i
```

Requires Node.js 20.13.1 or later.

## Examples

```sh
npx cliscope --top 20
npx cliscope --view calendar
npx cliscope --view weekdays
npx cliscope --history ~/.zsh_history --shell zsh
npx cliscope --view weekdays --csv --output weekdays.csv
npx cliscope --demo -i
```

In interactive mode, **Tab** switches views, **/** filters tools, and **q** exits.

See the [manual](docs/manual.md) for options, counting rules, exports, and
installation. See [contributing](CONTRIBUTING.md) for development and
[releases](docs/releases.md) for versioning and publication.

[MIT license](LICENSE).
