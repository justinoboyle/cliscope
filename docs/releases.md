# Releases

Squash merges and ordinary merge commits start the `Release` workflow. It selects
the version, verifies source, creates an annotated tag, and publishes npm, GitHub
Packages, and native archives. PR authors do not edit release versions, a changelog,
or a contract lock.

## Contract lock

`release-contract.json` describes the public contract. It contains no release
version. The generator reads source without executing it and records:

- CLI flags, aliases, validators, and defaults.
- JSON output fields and CSV column order.
- Executable names, supported native platforms, and runtime requirements.
- Semantic `tsconfig.json` build configuration, excluding comments and formatting.
  Inherited configuration through `extends` is unsupported and fails extraction.
- Package entry interpretation, included files, consumer restrictions, required /
  optional / peer dependency roles, peer metadata, and installation and packaging
  hooks, including artifact-producing build commands.
- Artifact-producing CI jobs (`verify` and `package`) and inherited workflow
  configuration, including archive assembly, matrix executables, and uploads.
- Resolved runtime dependency identities, including transitive packages, and
  normalized source fingerprints for application code and transitive local
  build helpers, including the scoped-package converter and source interpreter lines.

Record keys have a canonical order. Conditional `exports` and `imports` retain
their key order because it affects Node resolution. Unsupported
contract structures fail extraction; workflow YAML also rejects aliases, duplicate
keys, and missing artifact jobs. Display names and comments do not affect its
contract. Source fingerprints conservatively cover behavior outside structured
fields. Changes to the generator require tests
for both the preceding released source and the proposed source.

The lock is generated during planning and copied into the immutable annotated
tag. The release also includes it as a downloadable asset. Its digest binds that
asset to the tag. There is no manually maintained lock on the source branch.

## Version selection

The latest stable tag supplies the preceding version. Its contract supplies the
baseline. The legacy `v0.2.1` baseline is extracted from that tag's actual source
using the same generator as the candidate source.

| Contract comparison                                                        | Release change |
| -------------------------------------------------------------------------- | -------------- |
| Removed or changed existing contract; unclassified runtime behavior change | Breaking       |
| Added compatible fields, flags, or platforms with no breaking change       | Minor          |
| Unchanged contract and runtime behavior                                    | Patch          |

At `1.x` and later, breaking changes advance the major version. During `0.x`,
breaking changes advance the minor version. Lower components reset to zero.
Stable tags use `vMAJOR.MINOR.PATCH`; the workflow does not select prereleases.

The decision is deterministic for the two contract snapshots. It is conservative:
a behavior-preserving runtime refactor can receive a breaking classification.
An automatic source comparison does not prove arbitrary semantic compatibility.
Formatting, comments, and help prose are excluded from behavior fingerprints;
documentation and test changes normally produce a patch release.

Tags are the version authority. Source manifests retain `0.0.0-development`.
One stamping function writes the chosen version to both manifests in disposable
CI checkouts; the CLI, native binaries, and package archives receive that value.
Ordinary PR checks stamp `0.0.0`, which is never selected for publication.

Commits and pull requests provide change history. GitHub release notes are
generated from that history. npm's `latest` is a mutable installation selector,
not a source tag or another version record. See [npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/).

## Publication and recovery

The workflow processes unreleased first-parent commits from `main` in order.
Its global concurrency group serializes work; Git history retains the queue when
GitHub replaces a pending workflow run.

1. Compare contracts and select the next version.
2. Stamp and verify the selected commit with the complete native and installed
   package matrices.
3. Create an immutable annotated tag containing the source commit, contract,
   classification reasons, originating run, and hashes of the tested archives.
   Copy those archives to a draft GitHub Release.
4. Dispatch publication at that tag. This makes npm provenance identify the
   exact source used to build the package, even when more commits have merged.
5. Publish both registries, install their published versions outside the
   checkout, and run CLI and terminal tests. Publish the GitHub Release only
   after both registry jobs pass. Continue with the next queued commit.

The scoped archive changes only the package name. CI compares its payload and
remaining manifest fields against the npm archive before testing installation.
See [GitHub Packages](github-packages.md) for consumer authentication.

For a failed release, rerun the `Release` workflow on `main` with phase `plan`:

```sh
gh workflow run release.yml --ref main -f phase=plan
```

An unfinished tag is resumed before selecting a new version. Recovery uses the
reserved draft assets or the originating run's artifacts and checks their
hashes. Matching registry publications are skipped; conflicting bytes fail.
Missing original archives fail rather than being rebuilt under an existing tag.
Registry metadata is allowed a bounded propagation delay after publishing.
Never move a tag, overwrite an asset, or delete a published package to retry.

## Authentication

npm uses the existing trusted publisher for `justinoboyle/cliscope`, workflow
`release.yml`, with direct-publish permission and no environment. Publication
uses OIDC and provenance, with no stored npm token. The filename remains
`release.yml` across planning and tag publication.

GitHub Packages uses a job-scoped `GITHUB_TOKEN` with `packages: write`.
Tag reservation, draft recovery, and release completion receive `contents: write`;
GitHub requires push access to read draft assets. Publication dispatch and the
finalization job's queue continuation receive `actions: write`. Ordinary pull-request checks remain
read-only. No bot commit, release PR, personal token, or main-protection bypass
is required. Source and binary downloads are public; package visibility has its
own registry setting.

After installation, `npm audit signatures` checks registry signatures and
available provenance. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

## Install a binary

Download the archive for your OS and CPU, plus `SHA256SUMS`, from GitHub Releases.
Each archive contains the executable, README, license, and third-party notices. Linux builds require
glibc; Alpine/musl is not included. The executable includes Bun and OpenTUI assets.
See the [Bun build reference](https://bun.sh/docs/bundler/executables) and
[OpenTUI packaging reference](https://opentui.com/docs/reference/standalone-executables/).

On Linux:

```sh
sha256sum --check --ignore-missing SHA256SUMS
tar -xzf cliscope-linux-x64.tar.gz
./cliscope --version
mkdir -p ~/.local/bin
install -m 755 cliscope ~/.local/bin/cliscope
```

Add `~/.local/bin` to `PATH` if needed. On macOS, compare `shasum -a 256` output
with `SHA256SUMS`. On Windows, use `Get-FileHash -Algorithm SHA256`, extract with
`tar -xzf`, and put `cliscope.exe` on `PATH`.
