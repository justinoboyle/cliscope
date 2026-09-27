# cliscope reference

## Synopsis

```sh
npx cliscope [options]
```

With a global installation or a standalone executable, use `cliscope [options]`.

## Description

Read one shell history file and print command counts and activity graphs to
standard output. Interactive mode requires a terminal.

History is read as text. Stored commands are not executed, and the history file
is not changed. Reports contain command names and aggregate counts. Names and
filenames may contain private information.

## Options

Run `npx cliscope --help` for flags, defaults, limits, and examples. The
[option parser](../src/options.ts) owns accepted values and combinations.
Interactive mode cannot write exports; JSON and CSV are mutually exclusive;
demo input cannot be combined with a history path.

## Files

Supported formats are plain or timestamped Bash history, plain or extended Zsh
history, and Fish history. Select a format with `--shell` when automatic detection
cannot identify it.

File discovery checks `--history`, then `HISTFILE`, then the active shell's
standard history path, with fallback to other standard files. An explicit
`--shell` selects that shell's standard file when no path is supplied. Fish
respects `XDG_DATA_HOME`.

Only one file is read per invocation. Unsaved history from the current shell
session is unavailable. Input must be a regular file no larger than 64 MiB.
Plain Bash history is read one line at a time because it has no multiline record
delimiter.

## Counts

A history entry is a stored command record. An invocation is a recognizable
command in a chain or pipeline. For example, `git status && npm test` contributes
two invocations, regardless of whether the second command ran.

Common wrappers, including `sudo`, `env`, `command`, `nice`, `timeout`, `nohup`,
`exec`, `time`, and `builtin`, are removed when their arguments can be recognized.
Executable paths are reduced to names. Builtins and aliases appear as written.
Aliases are not expanded, dynamic command names are omitted, and substitutions
are treated as opaque text. Records containing heredocs, function definitions,
or unsupported case/switch syntax are skipped.

Share is a tool's count divided by all invocations, including tools outside
`--top`. Bars scale against the largest tool count. Equal counts sort by tool
name deterministically.

Daily activity counts invocations by UTC date. Missing days show zero. The daily
chart displays at most the final 56 days. Undated entries contribute to tool
counts unless `--since` is supplied.

The calendar displays at most twelve weeks. Each column is a week, with Monday
at the top. Shading scales against the largest visible daily count.

A weekday's mean is its count divided by the number of occurrences of that
weekday between the first and last dated entries, including quiet days. Its
score is `100 × mean / highest weekday mean`. These values describe recorded
history, not confirmed executions or productivity.

## Output

Calendar CSV contains the dated rows present in the report; the drawn calendar
fills gaps with zero.

CSV removes terminal controls, quotes text fields, and prefixes values that could
be interpreted as spreadsheet formulas. JSON escapes control characters. Printed
labels and paths also have terminal control sequences removed.

`--output PATH` creates a new file with mode `0600` on systems with POSIX
permissions. Existing files are not replaced. File output disables color.

```sh
npx cliscope --since 2026-09-01 --json --output report.json
npx cliscope --view weekdays --csv --output weekdays.csv
```

## Keys

| Key              | Operation                                     |
| ---------------- | --------------------------------------------- |
| **Tab**          | Switch between tools, calendar, and weekdays. |
| **j/k**, **↓/↑** | Move through tools.                           |
| **Home/End**     | Select the first or last matching tool.       |
| **/**            | Start filtering tool names.                   |
| **Enter**        | Finish editing the filter.                    |
| **Esc**          | Clear the filter and reset the selection.     |
| **q**            | Exit when not editing a filter.               |
| **Ctrl+C**       | Exit.                                         |

## Installation

See the [README](../README.md) for the Node requirement. The npm package installs
its own Bun runtime; a separate Bun installation is not required.

To install globally:

```sh
npm install --global cliscope
cliscope
```

For standalone executables, see [binary installation](releases.md#install-a-binary).
The same CLI is available as `@justinoboyle/cliscope` through
[GitHub Packages](github-packages.md), which requires registry authentication.

## See also

[Contributing](../CONTRIBUTING.md), [engineering checks](engineering.md),
[releases](releases.md), [license](../LICENSE).
