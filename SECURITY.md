# Security policy

## Supported versions

OpenQZ is deployed from the `main` branch. Security fixes go to `main` and the latest release only.

| Version | Supported |
| --- | --- |
| `main` / latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do **not** open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (<https://github.com/ossc-dbit/openqz/security/advisories/new>).

If you cannot use GitHub, email **[osscdbit@gmail.com](mailto:osscdbit@gmail.com)** with "OpenQZ security" in the subject.

Include:

- what is affected (page, API route or component);
- steps to reproduce, or a proof of concept;
- the impact you expect (for example, a student reading answer keys, or one account reaching another's data).

## What happens next

- We acknowledge the report within **3 working days**.
- We confirm the problem, agree a fix and a disclosure date with you, and keep you updated.
- Once a fix is deployed we publish a GitHub security advisory and credit you, unless you prefer to stay anonymous.

## Scope

In scope: the OpenQZ backend, frontend, deployment configuration in this repository, and any OpenQZ instance run by OSSC DBIT.

Out of scope:

- Screenshots or photos of the screen during a quiz. Browsers cannot block them; this is a known and documented limit.
- Denial of service through heavy traffic, spam or social engineering.
- Findings from automated scanners without a demonstrated impact.

Please test only against your own local stack (see [CONTRIBUTING.md](CONTRIBUTING.md)), never against a live campus instance or other people's accounts.

## More detail

The threat model, controls and latest scan results are in [docs/security.md](docs/security.md).
