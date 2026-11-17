#!/usr/bin/env bash
# Prints the PLC operation token a PDS issued to one account, for
# scripts/migrate-account.mjs (ADR-0008). Runs as root on the AWS host,
# started by `make aws-plc-token` (infra/scripts/host-run.sh) through SSM.
#
# The PDS emails this token to the account, but ours has no mail server, so it
# only exists in the PDS's account database. It authorizes one change to that
# account's PLC document and expires within the hour.
: "${DID:?DID of the account}"
SERVICE="${SERVICE:-pds}"
OPENREEL_DIR="${OPENREEL_DIR:-/srv/openreel}"

set -euo pipefail

[[ "$DID" =~ ^did:plc:[a-z2-7]{24}$ ]] || { echo "error: not a did:plc: $DID" >&2; exit 1; }
[[ "$SERVICE" =~ ^pds2?$ ]] || { echo "error: SERVICE is pds or pds2" >&2; exit 1; }
cd "$OPENREEL_DIR"
# better-sqlite3 ships with the PDS image, as a dependency of @atproto/pds
# (pnpm layout, so resolved from there). The DID is passed as an argument, not
# spliced into the query.
docker compose exec -T "$SERVICE" node -e '
  const sqlite = require(require.resolve("better-sqlite3", { paths: [require.resolve("@atproto/pds")] }))
  const db = new sqlite("/pds/account.sqlite", { readonly: true })
  const row = db.prepare("select token from email_token where did = ? and purpose = ?")
    .get(process.argv[1], "plc_operation")
  if (!row) { console.error("no PLC token for " + process.argv[1] + "; request one first"); process.exit(1) }
  console.log(row.token)
' "$DID"
