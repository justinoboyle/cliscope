# Releases

Push an annotated release tag to run checks, build binaries, and publish to npm
and GitHub Releases. Merging a pull request runs CI without publishing. The tag
selects both the source commit and the workflow version.

## Versions and tags

| Name            | Example                   | Use                                                                                                         |
| --------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Package version | `0.2.1`                   | Identifies the npm package and `cliscope --version` output. Both package manifests must match.              |
| Git tag         | `v0.2.1`                  | Identifies a source commit. Never move or replace a published release tag.                                  |
| npm dist-tag    | `latest` → `0.2.1`        | Selects the version installed by `npm install --global cliscope`. It moves when a new release is published. |
| GitHub Release  | Release page for `v0.2.1` | Holds notes, binary archives, and checksums for the Git tag.                                                |

`npm install --global cliscope@0.2.1` selects an exact version. Moving `latest`
does not change that version or its Git tag. See [npm dist-tags](https://docs.npmjs.com/adding-dist-tags-to-packages/).

Use [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. After 1.0,
increment patch for fixes, minor for compatible features, and major for
incompatible CLI or JSON changes. During 0.x development, use patch for fixes
and minor for features or breaking changes. Document any migration required.

Release tags must match `vMAJOR.MINOR.PATCH`, without leading zeroes. Prerelease
suffixes such as `-beta.1` are not supported by this workflow.

## Prepare and publish

Substitute the next unpublished version for `0.2.1` below.

1. Create a branch and update the version:

   ```sh
   git switch main
   git pull --ff-only origin main
   git switch -c release/0.2.1
   npm version 0.2.1 --no-git-tag-version
   ```

   This updates `package.json` and `package-lock.json` without creating a commit
   or tag. Update `CHANGELOG.md` and commit all three files.

2. Run `npm run verify`, push the branch, and open a pull request. Wait for
   **Quality gate**, then merge. Squash merges and merge commits are supported.

3. Tag the merged commit:

   ```sh
   git switch main
   git pull --ff-only origin main
   node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).version'
   git tag -a v0.2.1 -m 'Release v0.2.1' HEAD
   git push origin v0.2.1
   ```

   Check the printed version before creating the tag. Use `git tag -s` instead
   of `-a` if Git signing is configured. Lightweight tags are rejected.

The **Release** workflow checks that the annotated tag matches both manifests
and points to a commit reachable from `main`. It runs the native build and
installed-package test matrices before publishing. Two jobs then publish in
parallel: one uploads GitHub binary archives and `SHA256SUMS`; the other publishes
the npm package and moves `latest` to that version. npm receives the same tarball
installed by the consumer test matrix; the publish job does not rebuild it.

Check publication with `npm view cliscope version` and `npm dist-tag ls cliscope`.
The npm package is public. GitHub release downloads require repository access.

## Configure npm trust once

Use npm 11.19 or later and run as an authenticated npm package maintainer:

```sh
npm trust github cliscope --file release.yml --repo justinoboyle/cliscope --allow-publish
```

Complete npm's authentication prompt. The configuration must name repository
`justinoboyle/cliscope`, workflow `release.yml`, no environment, and permission
for direct `npm publish`. The workflow filename excludes `.github/workflows/`.
Staging-only permission does not allow this workflow to publish.

The npm job has `id-token: write` and uses OIDC authentication without an
`NPM_TOKEN` secret. Saving the trust configuration does not validate it; a
workflow publication does. See [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
and [trusted publishing](https://docs.npmjs.com/trusted-publishers/).

Provenance attestations are unavailable for private source repositories. The
publish command uses `--provenance=false`.

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

## Recover from a failure

Inspect the failed job. For a network or npm trust failure, correct the external
configuration and select **Re-run failed jobs**. Inspect both npm and GitHub
first: one publish job can succeed while the other fails. npm versions cannot
be overwritten.

If the source or workflow needs a fix, merge it with a new version and create a
new tag. Rerunning an old tag uses its original workflow, including `v0.1.0`,
which predates npm automation. Never move a published tag to include a fix.

The `v0.2.0` release published binaries, but npm rejected its tarball argument as
a GitHub repository shorthand. Version `0.2.1` corrects the local path with a
leading `./`. The original tag remains unchanged; the fix uses a new version and tag.
