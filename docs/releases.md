# Releases

Cliscope uses stable [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
CLI flags and JSON output are public interfaces. Fixes increment patch, compatible
features increment minor, and incompatible public changes increment major. Before
1.0, incompatible changes increment minor and are explicitly documented.

The release workflow accepts annotated tags named exactly `vMAJOR.MINOR.PATCH`,
with no leading zeroes or prerelease suffix. The tag must match `package.json` and
point to a commit reachable from `main`. Both squash and merge-commit histories
work because validation uses ancestry, not a particular merge strategy.

## Prepare and publish

1. Start a release branch from current `main`.
2. Choose the next version and run `npm version 0.2.0 --no-git-tag-version`
   (substitute the chosen version). Commit both package manifests and update
   `CHANGELOG.md` with the release date and notable changes.
3. Run `npm run check`, `npm test`, `npm run build`, and `npm run build:binary`.
   Open a pull request and wait for **Quality gate** before merging.
4. Fetch the merged `main` and create an annotated tag on that commit:

   ```sh
   git switch main
   git pull --ff-only origin main
   git tag -a v0.2.0 -m 'Release v0.2.0'
   git push origin v0.2.0
   ```

Pushing the tag automatically validates the release and reruns all checks. Native
GitHub runners build and smoke-test standalone binaries for Linux x64/arm64,
macOS x64/arm64, and Windows x64. After every build succeeds, the workflow publishes
a GitHub Release with `.tar.gz` archives and `SHA256SUMS`. A private repository's
release remains private and requires repository access to download.

Each archive contains the executable, README, and MIT license. Linux binaries
target glibc; Alpine/musl is not included. The binary embeds the Bun runtime and
OpenTUI assets. Build configuration follows the official
[Bun executable documentation](https://bun.sh/docs/bundler/executables) and
[OpenTUI standalone guide](https://opentui.com/docs/reference/standalone-executables/).
Application startup does not automatically load local `.env` or `bunfig.toml`.

## Verify and install

Download the archive for your platform and `SHA256SUMS` from GitHub Releases, then
verify the archive's SHA-256 checksum against its entry. On Linux:

```sh
sha256sum --check --ignore-missing SHA256SUMS
tar -xzf cliscope-linux-x64.tar.gz
./cliscope --version
install -m 755 cliscope ~/.local/bin/cliscope
```

Create `~/.local/bin` first if needed and ensure it is on `PATH`. On macOS use
`shasum -a 256` and compare against `SHA256SUMS`. On Windows use PowerShell
`Get-FileHash -Algorithm SHA256`, extract with `tar -xzf`, and place `cliscope.exe`
in a directory on `PATH`.

## Failed releases and policy

If checks or packaging fail, fix the cause and rerun the failed workflow when the
tagged source is still correct. If source changes are required, prepare a new
patch version; never move an existing published tag. A failed publishing step may
leave a release behind: inspect it before rerunning, and avoid replacing assets
of a published version silently.

Protect `main` with the **Quality gate** required status and disable force pushes
where the GitHub plan supports repository rules. Restrict creation and deletion
of `v*` tags to maintainers. CI actions are pinned by commit hash and release write
permission is limited to the publishing job.

The release workflow publishes GitHub binaries only. For the first npm release,
an authenticated maintainer runs `npm publish --access public` from the validated
release checkout. `prepack` reruns quality checks and produces the JavaScript
package. A private GitHub repository does not make a public npm package private;
publish to npm only when public distribution is intended.

For future automation, configure an npm trusted publisher scoped to this GitHub
repository and a dedicated publish workflow. Grant that job `id-token: write`,
use a supported npm CLI, and publish the validated tag with provenance. Do not
store a long-lived npm token in this repository. Until this is configured, npm
publishing remains an explicit maintainer operation.
