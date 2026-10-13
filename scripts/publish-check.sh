#!/usr/bin/env bash
# Pre-publish check for the public Verapass repo. Plain bash plus git and grep, no other dependencies.
#
#   bash scripts/publish-check.sh
#
# What it checks, in order:
#   1. LICENSE exists and package.json declares "license": "Apache-2.0" (adds the field if missing).
#   2. The files a first commit would contain (tracked files plus untracked files that .gitignore does
#      not exclude, the same set as `git add .`) have no forbidden paths: .env files other than
#      .env.example, keys and keystores, stellar-cli identities, anything named like a secret,
#      scratchpads, local tool state, build output and node_modules.
#   3. None of those files contain secret-shaped strings or personal contact data. Binary files are
#      scanned too. A symlink is checked by its link text (what git stores), never by the file it
#      points to. Hits are printed as file:line only, never the matched text. This script scans itself.
#   4. Leftover [TODO / [FOUNDER placeholders are listed as warnings. They do not fail the check.
#
# A line that is a known false positive can carry the marker "publish-check: allow" to be skipped by
# step 3. Use it sparingly and never on a real key.
#
# Exit code: 0 when steps 1 to 3 pass (warnings allowed), 1 otherwise.

set -u

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 1

self="scripts/publish-check.sh"
failures=0
warnings=0

fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }
warn() { printf 'WARN  %s\n' "$1"; warnings=$((warnings + 1)); }
ok() { printf 'ok    %s\n' "$1"; }

if ! command git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git work tree: run 'git init' first (see docs/publishing.md)."
  exit 1
fi

# 1. Licence
echo "== Licence"
if [ -f LICENSE ] && grep -q 'Apache License' LICENSE && grep -q 'Version 2.0' LICENSE; then
  ok "LICENSE is Apache-2.0"
else
  fail "LICENSE is missing or is not the Apache License 2.0 text"
fi

if [ ! -f package.json ]; then
  fail "package.json is missing"
elif grep -Eq '^[[:space:]]*"license"[[:space:]]*:[[:space:]]*"Apache-2.0"' package.json; then
  ok "package.json has \"license\": \"Apache-2.0\""
elif grep -Eq '^[[:space:]]*"license"[[:space:]]*:' package.json; then
  fail "package.json has a different \"license\" value; set it to \"Apache-2.0\""
else
  # Insert the field after "version" (or "name"), keeping two-space indentation.
  anchor='"version"'
  grep -q '^  "version"' package.json || anchor='"name"'
  tmp="$(mktemp)"
  awk -v a="$anchor" '{ print } !done && index($0, "  " a) == 1 { print "  \"license\": \"Apache-2.0\","; done = 1 }' \
    package.json >"$tmp" && mv "$tmp" package.json
  if grep -q '"license": "Apache-2.0"' package.json; then
    ok "added \"license\": \"Apache-2.0\" to package.json"
  else
    fail "could not add \"license\" to package.json; add it by hand"
  fi
fi

# 2. What would be committed
echo "== Files a commit would include (tracked, plus untracked files not in .gitignore)"
# NUL-separated, so file names with spaces, quotes or newlines come through intact. Sorted and
# de-duplicated (bash 3.2 compatible: no mapfile).
files=()
while IFS= read -r -d '' path; do
  [ -n "$path" ] && files+=("$path")
done < <(command git ls-files -z --cached --others --exclude-standard 2>/dev/null | LC_ALL=C sort -zu)

if [ "${#files[@]}" -eq 0 ]; then
  fail "git would commit nothing; check that you are in the repo root"
  echo "== Result"
  echo "FAILED: $failures problem(s), $warnings warning(s). Fix the FAIL lines before publishing."
  exit 1
fi
ok "${#files[@]} files would be in the repo"

# Prints a path on one line, with control characters (a newline in a file name) made visible.
show() { printf '%s' "$1" | tr '\000-\037' '?'; }

path_hits=0
for f in "${files[@]}"; do
  base="${f##*/}"
  lower="$(printf '%s' "$f" | tr '[:upper:]' '[:lower:]')"
  lowerbase="${lower##*/}"
  reason=""
  case "$base" in
    .env.example) ;;
    .env | .env.*) reason=".env file" ;;
  esac
  case "$lowerbase" in
    id_rsa | id_rsa.* | id_dsa | id_dsa.* | id_ecdsa | id_ecdsa.* | id_ed25519 | id_ed25519.*) reason="SSH key" ;;
  esac
  case "$lower" in
    *.pem | *.key | *.p12 | *.pfx | *.jks | *.p8) reason="key file" ;;
    *keystore*) reason="keystore" ;;
    .stellar/* | */.stellar/*) reason=".stellar/ stellar-cli identities (secret keys, seed phrases)" ;;
    *scratchpad*) reason="scratchpad" ;;
    .claude/* | */.claude/*) reason=".claude/ local tool state" ;;
    .project-map/* | */.project-map/*) reason=".project-map/ local tool state" ;;
    .rundown/* | */.rundown/*) reason=".rundown/ local tool state" ;;
    .vercel/* | */.vercel/*) reason=".vercel/ local project link" ;;
    contracts/.tools/*) reason="contracts/.tools (local stellar-cli build)" ;;
    contracts/target/*) reason="contracts/target (cargo build output)" ;;
    node_modules/* | */node_modules/*) reason="node_modules" ;;
    dist/* | */dist/*) reason="dist build output" ;;
    *secret*)
      # Images named after places (secret-reef.jpg) are fine; anything else named like a secret is not.
      case "$lowerbase" in
        *.jpg | *.jpeg | *.png | *.webp | *.avif | *.svg | *.gif) ;;
        *) reason="named like a secret" ;;
      esac
      ;;
  esac
  if [ -z "$reason" ] && [ -L "$f" ]; then
    target="$(readlink -- "$f")"
    case "$target" in
      /* | .. | ../* | */../* | */..) warn "symlink with an absolute or ../ target: $(show "$f") (git stores only the link text; check it is meant to be public)" ;;
    esac
  fi
  if [ -n "$reason" ]; then
    fail "forbidden path: $(show "$f") ($reason)"
    path_hits=$((path_hits + 1))
  fi
done
[ "$path_hits" -eq 0 ] && ok "no forbidden paths"

# 3. Secret-shaped content
echo "== Secret and personal-data patterns (file:line only)"
# Each entry: label|extended regex. Matched text is never printed.
# Stripe patterns need a key body of 16+ characters, so docs that name the prefix ("sk_test_...") and
# short test fixtures do not trip them; real Stripe keys are much longer.
patterns=(
  'Stellar secret seed|(^|[^A-Z2-7])S[A-Z2-7]{55}([^A-Z2-7]|$)'
  'Stripe live secret key|sk_live_[A-Za-z0-9]{16,}'
  'Stripe test secret key|sk_test_[A-Za-z0-9]{16,}'
  'Stripe webhook secret|whsec_[A-Za-z0-9]{16,}'
  'Stripe restricted key|(^|[^A-Za-z0-9])rk_(live|test)_[A-Za-z0-9]{16,}'
  'private key block|BEGIN ([A-Z]+ )?PRIVATE KEY'
  'gmail address|gmail\.com'
  'LinkedIn link|linkedin\.com'
  'referral code|(^|[^A-Za-z0-9_-])ref-[A-Za-z0-9]{3,}'
  'GitHub token|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,}'
  'AWS access key id|AKIA[0-9A-Z]{16}'
  'Anthropic API key|sk-ant-[A-Za-z0-9_-]{20,}'
  'OpenAI API key|(^|[^A-Za-z0-9])sk-(proj-)?[A-Za-z0-9_-]{40,}'
  'Google API key|AIza[0-9A-Za-z_-]{35}'
  'Slack token|xox[abposr]-[A-Za-z0-9-]{10,}'
  'stellar-cli seed phrase|seed_phrase[[:space:]]*=[[:space:]]*"[a-z]+( [a-z]+){11,}'
  'token in a .env-style line|^[[:space:]]*(export[[:space:]]+)?[A-Z0-9_]*(REDIS_REST_TOKEN|KV_REST_API_TOKEN|KV_REST_API_READ_ONLY_TOKEN|VERCEL_TOKEN|TRAVELLER_SECRET|STRIPE_WEBHOOK_SECRET)=["'"'"']?[A-Za-z0-9+/_=.-]{20,}'
)

# Reviewed exceptions: "path|label". They print as WARN so the founders still see them each run.
# The contact address from the original landing page (source/original-landing.html), also shown on the
# live demo. It stays a WARN because publishing it is an open founder decision: keep the personal
# address or switch to a project address (docs/publishing.md). Team addresses must never appear.
allowed=(
  'index.html|gmail address'
  'src/sections/Footer.tsx|gmail address'
  'src/sections/Services.tsx|gmail address'
  'tests/e2e/seo.spec.ts|gmail address'
  'source/original-landing.html|gmail address'
)

is_allowed() {
  local key="$1|$2" a
  for a in "${allowed[@]}"; do
    [ "$a" = "$key" ] && return 0
  done
  return 1
}

# Lock files list package names such as "ref-cast"; the referral pattern skips them. publish-check: allow
is_lock_file() {
  case "$1" in
    package-lock.json | */package-lock.json | Cargo.lock | */Cargo.lock) return 0 ;;
  esac
  return 1
}

# What git would store for a path: the file itself, or for a symlink only its link text (never the
# file it points to, which may sit outside the repo or be a device that never ends).
link_text_file="$(mktemp)"
trap 'rm -f "$link_text_file"' EXIT
source_of() {
  if [ -L "$1" ]; then
    readlink -- "$1" >"$link_text_file"
    printf '%s' "$link_text_file"
  elif [ -f "$1" ]; then
    printf './%s' "$1"
  fi
}

content_hits=0
for f in "${files[@]}"; do
  src="$(source_of "$f")"
  [ -n "$src" ] || continue
  # Binary files are scanned as well (-a): a NUL byte must not hide a key in the rest of the file.
  for entry in "${patterns[@]}"; do
    label="${entry%%|*}"
    regex="${entry#*|}"
    if [ "$label" = "referral code" ] && is_lock_file "$f"; then
      continue
    fi
    while IFS= read -r num; do
      [ -n "$num" ] || continue
      if sed -n "${num}p" "$src" | grep -aq 'publish-check: allow'; then
        continue
      fi
      if is_allowed "$f" "$label"; then
        warn "$(show "$f"):$num ($label, reviewed exception: confirm before publishing)"
        continue
      fi
      fail "$(show "$f"):$num ($label)"
      content_hits=$((content_hits + 1))
    done < <(grep -aEn -- "$regex" "$src" 2>/dev/null | cut -d: -f1)
  done
done
[ "$content_hits" -eq 0 ] && ok "no secret or personal-data patterns"

# 4. Placeholders
echo "== Placeholders left for the founders (warnings)"
placeholders=0
for f in "${files[@]}"; do
  [ "$f" = "$self" ] && continue
  [ -L "$f" ] && continue
  [ -f "$f" ] || continue
  grep -Iq . "./$f" 2>/dev/null || continue
  while IFS= read -r num; do
    [ -n "$num" ] || continue
    warn "$(show "$f"):$num placeholder"
    placeholders=$((placeholders + 1))
  done < <(grep -En '\[(TODO|FOUNDER)' "./$f" 2>/dev/null | cut -d: -f1)
done
[ "$placeholders" -eq 0 ] && ok "no [TODO or [FOUNDER placeholders"

echo "== Result"
if [ "$failures" -gt 0 ]; then
  echo "FAILED: $failures problem(s), $warnings warning(s). Fix the FAIL lines before publishing."
  exit 1
fi
echo "PASSED with $warnings warning(s)."
exit 0
