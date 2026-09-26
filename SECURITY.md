# Security policy

Security fixes are supported for the latest release.

Shell histories can contain secrets. Cliscope reads history locally to calculate
tool usage and does not need network access. Use synthetic data in bug reports.
Do not upload complete histories, credentials, access tokens, or screenshots
containing sensitive command arguments.

Report vulnerabilities through the repository's **Security → Report a
vulnerability** feature when available. If private reporting is unavailable,
contact the repository owner through a private channel before sharing exploit
details. Do not disclose vulnerabilities in a public issue.

Include the affected version, operating system, impact, and a minimal synthetic
reproduction. The maintainer will coordinate investigation, a fix, and disclosure.

Release archives include SHA-256 checksums. Verify them after downloading from
the repository's GitHub Releases page. These checksums detect transfer corruption;
they are not a separate signature or independent proof of publisher identity.
