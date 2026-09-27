# GitHub Packages

Each release publishes two package names with the same version and executable:

| Registry        | Package                  | Executable |
| --------------- | ------------------------ | ---------- |
| npm             | `cliscope`               | `cliscope` |
| GitHub Packages | `@justinoboyle/cliscope` | `cliscope` |

The GitHub package is derived from the tested npm archive. Only the manifest's
package name changes. Dependencies, executable files, and third-party notices
remain the same.

## Install

GitHub's npm registry requires authentication, including for public packages.
Create a personal access token (classic) with `read:packages` and an account
that can read the package. Log in using the token as the password:

```sh
npm login --scope=@justinoboyle --auth-type=legacy --registry=https://npm.pkg.github.com
npm install --global @justinoboyle/cliscope
cliscope --version
```

The scope setting directs `@justinoboyle` packages to GitHub. Dependencies such
as Bun continue to use their configured registry. Use
`@justinoboyle/cliscope@VERSION` to select a published version. See GitHub's
[npm registry instructions](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

## Access and publishing

New GitHub Packages publications default to private. A package linked to a
repository inherits repository access permissions by default, but package
visibility has its own setting. Making the repository public does not by itself
make this package public. See [package permissions](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages).

The [release workflow](releases.md) publishes with `GITHUB_TOKEN`, installs the
published version, and checks its CLI and terminal interaction. No personal
access token is stored in the workflow. Publishing requires the repository to
have write access to the package; an existing package with the same name may
need that access granted in its settings.
