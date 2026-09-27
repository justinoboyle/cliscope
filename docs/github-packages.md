# GitHub Packages

Each release publishes two package names with the same version and executable:

| Registry        | Package                  | Executable |
| --------------- | ------------------------ | ---------- |
| npm             | `cliscope`               | `cliscope` |
| GitHub Packages | `@justinoboyle/cliscope` | `cliscope` |

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

See [release authentication](releases.md#authentication) for publication. An
existing package may need repository write access granted in its settings.
