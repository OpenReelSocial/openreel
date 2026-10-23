#!/usr/bin/env bash
# Imports secrets written by export-secrets.sh into SSM Parameter Store, in
# place of init-secrets.sh, when moving the environment to another account
# (#111, infra/README.md). The PLC rotation key and the PDS secrets must move
# with the data, or restored accounts stop working.
#
#   AWS_PROFILE=<new account> infra/scripts/import-secrets.sh <file> [--overwrite]
#
# A parameter that already exists with the same value is left alone. One with
# a different value (for example from init-secrets.sh) is an error unless
# --overwrite is given. Values never appear in output or in command-line
# arguments: each reaches the AWS CLI through a mode-600 temporary file.
set -euo pipefail

file="${1:?usage: import-secrets.sh <file> [--overwrite]}"
overwrite=false
[[ "${2:-}" == --overwrite ]] && overwrite=true
region="${AWS_REGION:-us-east-1}"

for tool in aws jq; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done

scratch="$(mktemp -d)"
chmod 700 "$scratch"
trap 'rm -rf "$scratch"' EXIT

conflicts=()
count="$(jq '.parameters | length' "$file")"
for ((i = 0; i < count; i++)); do
  name="$(jq -r ".parameters[$i].name" "$file")"
  (umask 077 && jq -r ".parameters[$i].value" "$file" >"$scratch/wanted")
  if aws ssm get-parameter --region "$region" --name "$name" --with-decryption \
    --query Parameter.Value --output text >"$scratch/current" 2>/dev/null; then
    if cmp -s "$scratch/wanted" "$scratch/current"; then
      echo "unchanged: $name"
      continue
    fi
    if [[ "$overwrite" != true ]]; then
      echo "differs:   $name"
      conflicts+=("$name")
      continue
    fi
  fi
  (umask 077 && jq --argjson i "$i" --argjson overwrite "$overwrite" \
    '.parameters[$i] | {Name: .name, Type: .type, Value: .value, Overwrite: $overwrite}' \
    "$file" >"$scratch/parameter.json")
  aws ssm put-parameter --region "$region" --cli-input-json "file://$scratch/parameter.json" >/dev/null
  rm -f "$scratch/parameter.json"
  echo "imported:  $name"
done
rm -f "$scratch/wanted" "$scratch/current"

if ((${#conflicts[@]})); then
  echo "error: ${#conflicts[@]} parameter(s) already exist with other values; rerun with --overwrite to replace them" >&2
  exit 1
fi
