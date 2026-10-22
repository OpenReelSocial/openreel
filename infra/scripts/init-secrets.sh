#!/usr/bin/env bash
# Creates the AWS host's secrets in SSM Parameter Store (ADR-0007). Run once by
# a human with admin credentials, from any directory:
#
#   AWS_PROFILE=openreel-dev infra/scripts/init-secrets.sh
#
# Each missing parameter under $PARAMETER_PATH (default /openreel/dev) is
# generated locally and stored as a SecureString; existing ones are left alone,
# so re-running is safe and rotation is a deliberate
# 'aws ssm put-parameter --overwrite'. Values never appear in output or in
# command-line arguments. The host reads them on every deploy
# (infra/aws/scripts/deploy.sh). Same generators as
# infra/dev-server/scripts/init-env.sh.
set -euo pipefail

path="${PARAMETER_PATH:-/openreel/dev}"
region="${AWS_REGION:-us-east-1}"

for tool in aws openssl xxd; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done

# Values reach the AWS CLI through a private file rather than arguments, so
# they never appear in the process list. (The CLI cannot read
# --cli-input-json from /dev/stdin.)
scratch="$(mktemp -d)"
chmod 700 "$scratch"
trap 'rm -rf "$scratch"' EXIT

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
  name="$path/$key"
  if aws ssm get-parameter --name "$name" --region "$region" >/dev/null 2>&1; then
    echo "exists:    $name"
    continue
  fi
  value="$(generate "$key")"
  [[ "$value" =~ ^[0-9a-f]+$ ]] || { echo "error: generating $key failed" >&2; exit 1; }
  (umask 077 && printf '{"Name":"%s","Type":"SecureString","Value":"%s"}' "$name" "$value" \
    >"$scratch/parameter.json")
  aws ssm put-parameter --region "$region" --cli-input-json "file://$scratch/parameter.json" >/dev/null
  rm -f "$scratch/parameter.json"
  echo "created:   $name"
done
