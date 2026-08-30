#!/usr/bin/env bash
# Generate the three secrets the PDS requires and write them into
# services/pds/.env, creating it from .env.example if needed.
#
# Local development only. Production secrets belong in a managed secret store,
# not on a developer machine.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$here/.env"
example="$here/.env.example"

command -v openssl >/dev/null || { echo "error: openssl not found" >&2; exit 1; }
command -v xxd >/dev/null || { echo "error: xxd not found (install vim-common or xxd)" >&2; exit 1; }

if [[ ! -f "$env_file" ]]; then
  cp "$example" "$env_file"
  echo "Created services/pds/.env from .env.example"
fi

# Refuse to clobber existing secrets; rotating is a deliberate act.
existing=()
while IFS= read -r key; do
  if grep -qE "^${key}=.+" "$env_file"; then existing+=("$key"); fi
done <<'KEYS'
PDS_JWT_SECRET
PDS_ADMIN_PASSWORD
PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX
KEYS

if [[ ${#existing[@]} -gt 0 ]]; then
  echo "services/pds/.env already has values for: ${existing[*]}"
  echo "Delete those lines' values first if you intend to rotate them."
  exit 0
fi

set_key() {
  local key=$1 value=$2
  if grep -qE "^${key}=" "$env_file"; then
    # Value is hex, so it needs no sed escaping.
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

set_key PDS_JWT_SECRET "$(openssl rand -hex 16)"
set_key PDS_ADMIN_PASSWORD "$(openssl rand -hex 16)"
set_key PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX \
  "$(openssl ecparam -name secp256k1 -genkey -noout -outform DER \
     | tail -c +8 | head -c 32 | xxd -p -c 32)"

echo "Wrote PDS development secrets to services/pds/.env"
