# Security policy

<!-- [FOUNDER: turn on private vulnerability reporting before publishing: repository Settings > Security > Private vulnerability reporting > Enable. Until it is on, GitHub shows no "Report a vulnerability" button.] -->

## Reporting a vulnerability

Report security problems privately through GitHub: open the repository's Security tab and choose "Report a vulnerability". Only the maintainers see the report. Please do not open a public issue or pull request for a vulnerability.

Include what you found, the affected component (contract, check-in API, attestor, web app), the steps to reproduce it, and what an attacker could do with it. A proof of concept against Stellar testnet or a local build is welcome; please do not test against other people's stamps or passes.

We send a first answer within 5 working days, agree a fix and disclosure date with you, and credit you in the fix unless you ask us not to.

## Scope

| In scope | Notes |
|---|---|
| `contracts/verapass_stamps` | The Soroban contract, including the deployment on testnet listed in `contracts/DEPLOYMENT.md` |
| `server/` and `shared/` | The check-in API, attestor, receipt signing and verification code |
| `src/` | The web app, including the hidden-place lock and the `/verify` page |

Known, documented limits are not new findings: browser GPS can be spoofed, and the attacks that still work today are listed with their status in [docs/threat-model.md](docs/threat-model.md) and kept as expected-fail tests in `tests/integration/attacks.test.ts`. A report that bypasses a defence marked DEFENDED there, or that shows a way around a documented limit we have not listed, is in scope.

## Supported versions

Only the current `main` branch and the current testnet deployment get fixes. There is no mainnet deployment yet.
