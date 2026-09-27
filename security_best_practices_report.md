# Security review

Reviewed 2026-09-26, starting from `v0.2.1` (`546033d`). The findings below
have fixes and regression coverage in this change. The owner made the repository
public during the review; no visibility change was performed by the audit.

Public commit/tag metadata contains Justin O'Boyle and
`justin@justinoboyle.com`. This review is evidence about the inspected boundaries, not a certification
that the program has no vulnerabilities.

## Findings and fixes

| ID  | Severity | Finding                                                                       | Resolution                                                                                                                                                                      |
| --- | -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Medium   | CSV retained terminal instructions from history-derived tool names.           | [#4](https://github.com/justinoboyle/cliscope/issues/4): sanitize cells before formula protection and CSV quoting; test captured output and exported files.                     |
| 2   | Low      | Continued Zsh records repeatedly scanned and copied accumulated text.         | [#5](https://github.com/justinoboyle/cliscope/issues/5): inspect each physical line once and join fragments once.                                                               |
| 3   | Low      | Operator-heavy records retained millions of lexer token objects.              | [#6](https://github.com/justinoboyle/cliscope/issues/6): consume tokens incrementally and discard resolved arguments.                                                           |
| 4   | Low      | Whole-file line splitting allocated large arrays even for blank input.        | [#8](https://github.com/justinoboyle/cliscope/issues/8): iterate physical lines.                                                                                                |
| 5   | Low      | Aggregation retained every invocation name and parsed history entry.          | [#14](https://github.com/justinoboyle/cliscope/issues/14), [#15](https://github.com/justinoboyle/cliscope/issues/15): count names directly and stream records into aggregation. |
| 6   | Low      | A single multiline record still retained one reference per physical fragment. | [#17](https://github.com/justinoboyle/cliscope/issues/17): join fixed-size fragment batches before completing the record.                                                       |
| 7   | Medium   | npm-injected dependency executables could shadow privileged release tools.    | [#18](https://github.com/justinoboyle/cliscope/issues/18): invoke the release controller directly and sanitize subprocess PATH.                                                 |
| 8   | Low      | Zero-width combining sequences bypassed terminal output-size bounds.          | [#19](https://github.com/justinoboyle/cliscope/issues/19): bound emitted UTF-16 units and grapheme segmentation input as well as terminal cells.                                |

Finding 1 was reproduced in the published binary using a quoted tool name with
an OSC 52 sequence. CSV retained the sequence; a compatible terminal may act on
it when displayed. The test captured bytes through a pipe and did not alter the
clipboard. See the original [CSV boundary](https://github.com/justinoboyle/cliscope/blob/v0.2.1/src/export.ts#L10)
and [stdout write](https://github.com/justinoboyle/cliscope/blob/v0.2.1/src/cli.ts#L54).
No shell execution was demonstrated.

The resource findings require processing crafted local history. Original hot
paths were [Zsh accumulation](https://github.com/justinoboyle/cliscope/blob/v0.2.1/src/history.ts#L93),
[token storage](https://github.com/justinoboyle/cliscope/blob/v0.2.1/src/shell-lexer.ts#L57),
and [line splitting](https://github.com/justinoboyle/cliscope/blob/v0.2.1/src/history.ts#L113).
The [performance audit](docs/performance.md) records bounded fixtures, before/after
measurements, heap limits, and remaining output-proportional allocations.
Late invalid syntax still discards an entire record's tentative counts.

For finding 8's exact byte counts, grapheme bounds, fixtures, and tests, see
[rendering evidence](docs/performance.md#rendering-and-interaction).

## Disclosure checks

Gitleaks 8.30.1 scanned all seven advertised remote refs at the start of review:
nine commits, 98 distinct file blobs, and commit/tag metadata. It found no
confirmed project credentials. Both published npm versions and all 15 release
archives were downloaded and checked against registry integrity values or
published SHA-256 checksums.

Text scans found no credentials. A separate printable-string scan covered all
15 binaries. Its three distinct candidate patterns were verified in the
unmodified pinned Bun runtime. No personal home paths or absolute source-map
paths were found. The public 0.2.1 npm source map already included 13 application
modules. The dependency audit reported zero known vulnerabilities after adding
the build-only tar dependency.

The [archive review](docs/audit.md#archive-regressions) records scoped-package
validation and the `__proto__` regression.

## Release permissions

[#7](https://github.com/justinoboyle/cliscope/issues/7) bound the strict merge
check to the GitHub Actions app and required maintainer approval for all external
fork workflows. Both settings were read back through the API. The owner remains
the only collaborator; required reviews permit zero approvals so that a solo
maintainer can merge after checks.

See [release authentication](docs/releases.md#authentication) for job permissions
and publisher identity, and [recovery](docs/releases.md#publication-and-recovery)
for integrity checks and retry limits.

Finding 7 concerned [release subprocess resolution](scripts/release-io.ts).
`npm run` prepends dependency executable directories, so a malicious dependency
already merged to `main` could supply `gh`, `git`, or `npm` to a privileged job.
It does not give an unmerged pull request access to release credentials. The
workflow now invokes the controller directly with Node. Its subprocess boundary
rejects dependency directories, relative and empty PATH entries, and directories
inside either the checkout or an explicit command working directory. Canonical
path checks also reject symlink aliases; an entirely untrusted PATH fails closed.

The regression puts a hostile dependency shim ahead of a trusted fake `gh` and
asserts that only the trusted executable writes its marker. No network or token
access is involved. Directory-filter tests also cover explicit working
directories and symlink aliases, and the existing original-artifact recovery
test still passes with its external fake tool. Release orchestration runs on
Ubuntu; the executable-shim test is POSIX-only. This boundary does not protect
against an attacker controlling the runner's trusted external tool directories.

## DeepSec and review limits

DeepSec 2.3.10 used the existing ChatGPT-authenticated Codex CLI with GPT-5.5,
high reasoning effort, and local subscription mode. API-key and gateway variables
were removed from its process. No Vercel cloud execution or separate model API
key was configured. [DeepSec documents local subscription support](https://deepsec.sh/docs/getting-started#using-local-subscriptions).

The initial pass reviewed 39 authored files and found the CSV and two resource
issues. One interrupted batch was rerun alongside the new packaging files.
That follow-up flagged glibc selection for a hypothetical musl standalone build;
musl is outside the documented native release targets. A subsequent runtime pass
identified line splitting and dense invocation arrays, covered by #8 and #14.
Manual review added the streamed-record and fragment-allocation fixes.

The final scan, `20260926235839-88db9dde8585807f`, completed 29 analyses and
reported four findings. Two described the same privileged PATH issue, tracked
as #18. One observed a transient undefined `commandFiles` identifier during an
agent edit; it was corrected before the subsequent type check and 25 release
tests passed. The remaining finding concerns zero-width rendering output and
is tracked in [#19](https://github.com/justinoboyle/cliscope/issues/19). The scan
count includes duplicate and transient observations; it is not four independent
remaining vulnerabilities.

The security skill's reference catalog has no specific Node/Bun CLI guide;
review followed the actual input and execution paths. Synthetic histories were
used throughout. Launcher tests ignored hostile working-directory Bun settings
and environment files. Export creation refused an existing symlink without
changing its target. These checks do not protect against an attacker who already
controls the user's account, runtime, or environment.

Secret scanning is heuristic. Unreachable Git objects, historical Actions logs,
expired artifacts, discussions, and full binary reverse engineering were not
covered. Public visibility exposes repository history and collaboration records;
see [GitHub's visibility documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).
