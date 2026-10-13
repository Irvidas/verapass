# Publishing the repo

How the founders make this repo public on GitHub, and what to fill in afterwards. Every step here is a
founder action: nothing in this repo pushes, creates remotes or deploys on its own.

The whole repo goes public under Apache-2.0 (`LICENSE`, and `"license": "Apache-2.0"` in
`package.json`). Internal SCF material is kept out by `.gitignore`: `docs/scf-grant-case.md`,
`research/scf-grant.md`, `pitch/`, `deck-shots/` and `source/brief.md` stay local. So do `.env.local`
and every other `.env*` file except `.env.example`.

## 1. Decide before publishing

- Contact address on the site. The original landing page has a personal gmail contact address, and it
  is still in `index.html`, `src/sections/Footer.tsx`, `src/sections/Services.tsx`,
  `source/original-landing.html` and `tests/e2e/seo.spec.ts`. `scripts/publish-check.sh` lists these
  five lines as warnings on every run. Choose one:
  - Publish the personal address as it is (it is already on the live demo). Nothing to change.
  - Switch to a project address. Change it in all five files in one go (the e2e test checks the
    address), run `npm test` and `npm run test:e2e`, then remove the five `gmail address` lines from
    the `allowed` list in `scripts/publish-check.sh` so any future gmail address fails the check.
- Fill the placeholders the check lists as warnings: the SCF project link, the review confirmation and
  the maintenance terms in `docs/README.md`, the clone URL in `docs/quickstart.md` (fill it right after
  step 4, once the URL exists) and the security contact in `docs/threat-model.md`.

## 2. Run the pre-publish check

From the repo root:

```bash
bash scripts/publish-check.sh
```

It must end with `PASSED`. It checks the licence, lists what `git add` would include, fails on forbidden
paths (`.env` files other than `.env.example`, key files, SSH keys, keystores, `.stellar/` stellar-cli
identities, files named like a secret, scratchpads, `.claude/`, `.project-map/`, `.rundown/`,
`.vercel/`, build output, `node_modules`) and on secret-shaped content (Stellar secret seeds and
stellar-cli seed phrases, Stripe, GitHub, AWS, Anthropic, OpenAI, Google and Slack keys, Redis REST or
Vercel tokens in a `.env`-style line, private key blocks, LinkedIn links, referral codes, gmail
addresses outside the reviewed list). It scans binary files too, checks a symlink by its link text
only, and handles file names with spaces or newlines. Hits print as `file:line` only. A `WARN` line does not
fail the check, but read each one. Then run the tests once more:

```bash
npm run lint && npm run typecheck && npm test
npm run test:e2e
(cd contracts && cargo test)
```

## 3. Initial commit

One commit, by a founder, with no AI co-author trailer (no `Co-Authored-By:` line). Check that git uses
your own name and address for this repo first:

```bash
git config user.name
git config user.email
git add -A
git status          # read the list once more; no .env file other than .env.example may appear
git commit -m "Verapass: proof-of-presence stamps on Soroban (contract, API, web app)"
git branch -M main
git log -1 --format='%an <%ae>%n%n%B'   # one author, no trailer
```

## 4. Create the GitHub repo and push

Needs the GitHub CLI logged in as the account that will own the repo (`gh auth status`). Set `OWNER` to
that account or organisation.

```bash
OWNER=<github account or organisation>
gh repo create "$OWNER/verapass" --public \
  --description "Proof-of-presence stamps on Stellar Soroban: a licensed-creator place registry, a check-in API and non-transferable stamps (testnet)." \
  --homepage https://verapass.vercel.app \
  --source . --remote origin
gh repo edit "$OWNER/verapass" \
  --add-topic stellar,soroban,smart-contracts,proof-of-presence,attestation,travel,typescript,react
git push -u origin main
```

Then, logged out (or in a private window), open the repo page, `docs/README.md`,
`docs/architecture.md` (the four diagrams must render), `LICENSE` and `contracts/DEPLOYMENT.md`.

## 5. After the first push: branches and pull requests only

`main` gets no more direct pushes. Turn that on in GitHub: Settings, Rules, Rulesets, New branch
ruleset, target the default branch, tick "Require a pull request before merging" and "Block force
pushes".

Every later change goes through a branch and a pull request:

```bash
git switch main && git pull
git switch -c docs/fill-repo-urls          # one branch per change
# edit, then:
bash scripts/publish-check.sh
npm run lint && npm run typecheck && npm test
git add -A && git commit -m "Fill the public repo URLs in the docs"
git push -u origin docs/fill-repo-urls
gh pr create --base main --fill
gh pr merge --squash --delete-branch       # after review
```

## 6. URLs to fill once the repo is public

Write `REPO` for `https://github.com/<OWNER>/verapass`.

In this repo (through a pull request, step 5):

| File | Placeholder | Value |
|---|---|---|
| `docs/quickstart.md` | clone URL placeholder in the `git clone` line | `REPO.git` |
| `docs/README.md` | SCF #46 project page link | the SCF project page, after the submission is filed |

Placeholders in the grant application itself are tracked with that application, outside this repo.
