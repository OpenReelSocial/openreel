#!/usr/bin/env bash
# Create the dev server's .env if missing and generate any empty secret.
# Runs on the server (the deploy job copies it over), next to compose.yaml:
#   scripts/init-env.sh /srv/openreel
# Never prints secret values.
set -euo pipefail

dir="${1:-$(pwd)}"
env_file="$dir/.env"
example="$dir/.env.example"

command -v openssl >/dev/null || { echo "error: openssl not found" >&2; exit 1; }
command -v xxd >/dev/null || { echo "error: xxd not found" >&2; exit 1; }

if [[ ! -f "$env_file" ]]; then
  install -m 600 "$example" "$env_file"
  echo "Created $env_file from .env.example"
fi
chmod 600 "$env_file"

generate() {
  case $1 in
    PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX)
      openssl ecparam -name secp256k1 -genkey -noout -outform DER \
        | tail -c +8 | head -c 32 | xxd -p -c 32 ;;
    *) openssl rand -hex 16 ;;
  esac
}

for key in POSTGRES_PASSWORD PLC_DB_PASSWORD PDS_JWT_SECRET PDS_ADMIN_PASSWORD \
  PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX; do
  grep -qE "^${key}=.+" "$env_file" && continue
  value="$(generate "$key")"
  if grep -qE "^${key}=" "$env_file"; then
    # Values are hex, so they need no sed escaping.
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
  echo "Generated $key"
done
