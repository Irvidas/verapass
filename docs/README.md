# Verapass docs

Verapass is an open proof-of-presence primitive on Stellar. A public registry lists licensed creators and the places they vouch for. A traveller who checks in at a place under published rules receives a non-transferable stamp from a Soroban contract, and anyone can read how many accepted check-ins a place has without trusting our database. The first deployment is a TAT-licensed local guide's map of Phuket.

These pages describe the code in this repository as of 2026-10-10 and the planned work. Status: contract v1 on Stellar testnet, presence-check API, signed receipts and a test-mode card checkout.

## Start here

| If you want to | Read |
|---|---|
| run the app on your machine in demo mode | [Quickstart](quickstart.md) |
| run a live server for a pilot with real guests | [Pilot server](pilot-server.md) |
| read stamps and visit counts from another app | [Integration guide](integration-guide.md) |
| see every contract function, event, error and storage key | [Contract interface](contract-interface.md) |
| call the check-in API | [API reference](api-reference.md) |
| check a receipt someone gave you | [Verify a check-in receipt](verify-a-receipt.md) |
| understand the design and the delivery plan | [Architecture](architecture.md) |
| know what a stamp does and does not prove | [Threat model outline](threat-model.md) |
| see what is tested and what is not | [Test plan](test-plan.md) |
| see every screen of the app and what it does | [UI and flows](ui.md) |
| report a vulnerability | [Security policy](../SECURITY.md) |

Table of contents for GitBook or a docs site: [SUMMARY.md](SUMMARY.md).

## All pages

| Page | What it answers |
|---|---|
| [Quickstart](quickstart.md) | Demo mode on your machine in under 15 minutes, with the expected output at each step |
| [Pilot server](pilot-server.md) | One live-mode server for a pilot: a VM with Caddy and systemd, or a laptop with a Cloudflare quick tunnel; settings by name, the preflight check, logs and backups |
| [Integration guide](integration-guide.md) | Reading stamps, visit counts and events from testnet with the Stellar CLI, Soroban RPC or JavaScript; tying a receipt to its stamp |
| [Contract interface](contract-interface.md) | Every public function of `verapass_stamps` v1 with arguments, auth, errors, events, storage keys and TTL policy |
| [API reference](api-reference.md) | Every route of the check-in server: method, path, body, responses, error codes, body and rate limits |
| [Verify a check-in receipt](verify-a-receipt.md) | The Ed25519 receipt format, canonical JSON, and a verifier with no dependencies |
| [Architecture](architecture.md) | How a check-in becomes a stamp, what the contract stores, keys and roles, payments, wallets and fees, failure modes, and how to check the claims on testnet |
| [Threat model outline](threat-model.md) | What a stamp does and does not prove, the attacks that work today, how keys and secrets are handled, what is on chain, location privacy, and the mitigations planned per tranche |
| [Test plan](test-plan.md) | Every test suite with counts and coverage, how to run them, the expected-fail attack cases, and what is not tested yet |
| [UI and flows](ui.md) | Screenshots of every screen in demo mode (home, check-in, passport, verify, places and checkout, phone layout), what each one calls, and the planned UI work per tranche |
| [Contract reference](../contracts/README.md) | Functions, storage, events and errors of `verapass_stamps`, and how to build and deploy it |
| [Testnet deployment record](../contracts/DEPLOYMENT.md) | Contract id, public addresses of the testnet identities, every deployment and test transaction with the fee it was charged |
| [Security policy](../SECURITY.md) | How to report a vulnerability privately, scope, and what counts as a known limit |

## Built today and planned

| Built (not part of the grant budget) | Planned in SCF #46 tranches |
|---|---|
| Contract v1: registry, passports, stamps, visit counts, events, two-step admin handover, upgrade | Contract v2: two-party stamps, separate passport issuer, deactivation, daily caps, two-step creator registry (T1) |
| Check-in API: nonce, geofence, accuracy cap, speed check, rate limits, signed receipts; optional Redis REST shared state with an atomic nonce burn, tested with two instances | Durable Postgres ledger and attestation outbox, KMS keys, keep-alive and restore path (T1); rotating on-site code (T2) |
| Testnet attestor that mints a stamp per real check-in | Payment and refunds on chain (T1); passkey wallets with a fee relay (T2) |
| `shared/verify.ts` and the `/verify` page | Check-in protocol spec v0 for the two-party flow and a TypeScript read client (T1), SDK v1.0 on npm (T3) |
| One stamp mirrored to attest.so by hand | Every stamp mirrored to attest.so (T2) |
| Contract reads and events through Soroban RPC | Indexer, public read API, lookup page and Hubble query (T3) |
| These v1 docs, the threat-model outline and the test plan | Threat model v1 for contract v2 (T2); docs for contract v2, the SDK and mainnet (T3) |

Diagrams (SVG, with PNG renders beside them) are in [diagrams/](diagrams/); [architecture](architecture.md) and the [root README](../README.md) show them inline:

- [system-context.svg](diagrams/system-context.svg): who touches the contract
- [checkin-sequence.svg](diagrams/checkin-sequence.svg): one check-in, two signatures, one stamp
- [data-model.svg](diagrams/data-model.svg): what the contract stores
- [trust-boundaries.svg](diagrams/trust-boundaries.svg): data flow and trust boundaries, and what each crossing carries

## The case for the work

Travel content is cheap to fake and costly to check. Google says it blocked or removed 292 million policy-violating reviews on Maps in 2025 ([Search Engine Roundtable](https://www.seroundtable.com/google-maps-spam-fighting-2025-41176.html)), and Tripadvisor blocked 2.7 million fraudulent reviews in 2024, 214,000 of them AI-generated ([Hospitalitynet](https://www.hospitalitynet.org/news/4126305.html)); both act after the content is posted. AI-written guides now send people to places that do not exist ([Euronews](https://euronews.com/travel/2026/01/30/how-an-ai-generated-travel-website-sent-tourists-to-a-non-existent-hot-spring-attraction)). Verapass ties two things together in a form anyone can read on-chain: a licensed person vouches for a place, and each counted visit passed an on-site check under published rules.

The project is applying to the Stellar Community Fund (SCF #46, Open Track) for three tranches of work:

| Tranche | Target | Ships |
|---|---|---|
| T1, MVP on testnet | 2027-02-05 | contract v2 where the traveller's wallet and the attestor both sign each stamp; a separate passport-issuer key; payment and refunds on-chain; a durable check-in ledger and attestation outbox, KMS keys, keep-alive and restore path; the app reads the chain; check-in protocol spec v0 for the two-party flow and a TypeScript read client |
| T2, testnet | 2027-03-26 | passkey wallets with a fee relay; creator USDC credit on testnet; rotating on-site QR, threat model v1 for contract v2 (replacing the outline here) and monitoring plan; beta with the flagship guide; every stamp mirrored to attest.so |
| T3, mainnet | 2027-05-28 | mainnet with a multisig admin and alerts; indexer and public read API; USDC claim on mainnet and a second creator; SDK v1.0, example app, and these docs extended to contract v2, the SDK and mainnet |

Mainnet launch conditions: 2 approved creators, 30+ places, 80+ mainnet stamps from at least 20 distinct traveller wallets (each with two signatures; 60+ at the flagship guide's places, 10+ at the second creator's), stamps split by passport source with every booking wallet having claimed its own seat, and every accepted stamp paid as USDC credit ($80+ credited and at least $60 claimed at the $1 pilot rate).

Why Stellar: the contract that counts a verified visit also computes and pays its capped USDC credit to the creator, so pay can be checked against stamps without relying on Verapass's payout records. Which check-ins count is still the attestor's call under the published rules, and the [threat model](threat-model.md) says where that trust sits.

Headline on-chain metric: verified stamps from distinct traveller wallets, each with two signatures, split by passport source (card-paid or booking). USDC credited and claimed is the payout proof.

[FOUNDER: link to the SCF #46 project page once the submission is filed.]

## Check it yourself

- Testnet contract: [CDIVZILQ...EKEZ65 on stellar.expert](https://stellar.expert/explorer/testnet/contract/CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65)
- A stamp minted from a real API check-in: [tx a0418077](https://stellar.expert/explorer/testnet/tx/a0418077886bbdc9f62e313da01088c6d0e89791a313f74092a77329e43ff638)
- The attest.so mirror of that stamp: [tx 4a67c5aa](https://stellar.expert/explorer/testnet/tx/4a67c5aa9b342c0c6c25fb5dc5729b575593c46a9af8116ba45f9319d12e61ab)
- Demo (demo mode, mock attestation): https://verapass.vercel.app (until the shared store is configured on the hosted demo, the unlock after checkout can fail across serverless instances; `GET /api/health` shows `"state"`)
- Run everything locally: see "Run it" in the [root README](../README.md) and "How to run" in the [test plan](test-plan.md#how-to-run).

Stellar testnet resets on 2026-12-16. After that date the contract is redeployed and the new id is published in these pages and in `contracts/DEPLOYMENT.md`.

## Related Stellar work

| Project | What it does | What Verapass adds | How they compose |
|---|---|---|---|
| [attest.so](https://github.com/daccred/attest.so) (SCF #29, #32) | General Soroban attestation framework: schemas, attesters, resolvers, revocation | A presence check before anything is written, one stamp per traveller per place, non-transferable stamps, payment-gated passports, traveller and attestor signing one call | Verapass mirrors stamps as attest.so attestations under its own schema (first one on testnet, [architecture section 8](architecture.md#8-composability-with-attestso)) |
| [Stellar Passport](https://communityfund.stellar.org/project/stellar-passport-bgn) (SCF #40) | Passkey wallets and QR participation stamps at organised events | Public places rather than events, each vouched for by a licensed creator in an on-chain registry; a per-visit USDC credit to that creator | Verapass reuses the same passkey wallet pattern for travellers |
| EAS, Sign Protocol (EVM) | Attestations on EVM chains | Presence stamps and creator credit on Stellar | Same attestation model; no bridge planned |

## Maintenance

The two founders maintain the contract, the SDK, the protocol spec and these docs during the grant and for 12 months after the mainnet launch, funded by the founders and not by the grant. Issues get a first answer within 5 working days. After each testnet reset the contract is redeployed within a day and the new id is published here and in `contracts/DEPLOYMENT.md`. [FOUNDER: confirm these terms.]

## License

Apache-2.0, see [LICENSE](../LICENSE).

## AI disclosure

These documents, the diagrams and the prototype code were written with AI assistance and reviewed by the founders. [FOUNDER: confirm the review before publishing.]
