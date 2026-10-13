#!/usr/bin/env bash
# Build, deploy and seed verapass_stamps on Stellar testnet.
#
# Usage (from anywhere):
#   VERAPASS_GEO_SALT=<64 hex chars> contracts/scripts/deploy-testnet.sh
#
# Keys live in the stellar CLI keystore (~/.config/stellar), never in this repo.
# The geo salt is printed nowhere and must be kept outside the repo; without it
# nobody can recompute the place commitments.
#
# Re-run after a testnet reset to get a fresh deployment. The script prints
# every transaction hash; copy them into contracts/DEPLOYMENT.md.
set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$CONTRACTS_DIR/.." && pwd)"
STELLAR="${STELLAR:-$CONTRACTS_DIR/.tools/bin/stellar}"
NETWORK=testnet

ADMIN=verapass-admin
ATTESTOR=verapass-attestor
CREATOR=verapass-sukanya-placeholder
TRAVELLER=verapass-demo-traveller

if [[ ! "${VERAPASS_GEO_SALT:-}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Set VERAPASS_GEO_SALT to 64 lowercase hex chars (openssl rand -hex 32) and keep it outside the repo." >&2
  exit 1
fi

sha256_hex() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }

ensure_key() {
  local name="$1" fund="$2"
  if ! "$STELLAR" keys address "$name" >/dev/null 2>&1; then
    if [[ "$fund" == fund ]]; then
      "$STELLAR" keys generate "$name" --network "$NETWORK" --fund
    else
      "$STELLAR" keys generate "$name" --network "$NETWORK"
    fi
  fi
}

invoke() {
  local source="$1"; shift
  "$STELLAR" contract invoke --id "$CONTRACT_ID" --source "$source" --network "$NETWORK" -- "$@"
}

# Read-only call: simulated, never submitted.
read_call() {
  "$STELLAR" contract invoke --id "$CONTRACT_ID" --source "$ADMIN" --network "$NETWORK" --send=no -- "$@"
}

echo "== build"
(cd "$CONTRACTS_DIR" && "$STELLAR" contract build)
WASM="$CONTRACTS_DIR/target/wasm32v1-none/release/verapass_stamps.wasm"

echo "== identities"
ensure_key "$ADMIN" fund
ensure_key "$ATTESTOR" fund
ensure_key "$CREATOR" nofund
ensure_key "$TRAVELLER" nofund
ADMIN_ADDR="$("$STELLAR" keys address "$ADMIN")"
ATTESTOR_ADDR="$("$STELLAR" keys address "$ATTESTOR")"
CREATOR_ADDR="$("$STELLAR" keys address "$CREATOR")"
TRAVELLER_ADDR="$("$STELLAR" keys address "$TRAVELLER")"
echo "admin     $ADMIN_ADDR"
echo "attestor  $ATTESTOR_ADDR"
echo "creator   $CREATOR_ADDR"
echo "traveller $TRAVELLER_ADDR"

echo "== deploy"
CONTRACT_ID="$("$STELLAR" contract deploy --wasm "$WASM" --source "$ADMIN" --network "$NETWORK" \
  -- --admin "$ADMIN_ADDR" --attestor "$ATTESTOR_ADDR")"
echo "contract  $CONTRACT_ID"

echo "== register creator (licence hash is a placeholder until the TAT licence check is recorded)"
LICENCE_HASH="$(sha256_hex "verapass-licence-v1|placeholder|tat-licence-check-pending")"
invoke "$ADMIN" add_creator --creator "$CREATOR_ADDR" --licence_hash "$LICENCE_HASH"

echo "== register places"
while read -r place_id commitment; do
  invoke "$ADMIN" add_place --place_id "$place_id" --creator "$CREATOR_ADDR" --geo_commitment "$commitment"
done < <(cd "$REPO_DIR" && npx --no-install tsx contracts/scripts/place-commitments.ts)

echo "== demo passport and stamp"
PAYMENT_REF="$(sha256_hex "cs_test_verapass_testnet_demo_1")"
invoke "$ATTESTOR" activate_passport --traveller "$TRAVELLER_ADDR" --payment_ref "$PAYMENT_REF"
NOW="$(date +%s)"
RECEIPT_HASH="$(sha256_hex "verapass-demo-receipt|$TRAVELLER_ADDR|wat-chalong|$NOW")"
invoke "$ATTESTOR" stamp --traveller "$TRAVELLER_ADDR" --place_id wat-chalong \
  --checkin_receipt_hash "$RECEIPT_HASH" --ts "$NOW"

echo "== read back"
read_call has_stamp --traveller "$TRAVELLER_ADDR" --place_id wat-chalong
read_call place_visit_count --place_id wat-chalong
read_call stamps_of --traveller "$TRAVELLER_ADDR"
echo "done: $CONTRACT_ID"
