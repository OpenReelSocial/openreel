#!/usr/bin/env bash
# Exports the AWS host's secrets from SSM Parameter Store to a private file,
# for moving the environment to another account (#111, infra/README.md).
# import-secrets.sh loads the file into the new account.
#
#   AWS_PROFILE=<old account> infra/scripts/export-secrets.sh <file>
#
# The file holds every parameter under $PARAMETER_PATH (default /openreel/dev),
# including the PDS's PLC rotation key: whoever has it controls every DID the
# PDS created. It is created mode 600, must not already exist, and must be
# outside any Git working tree. Delete it once imported. Values are never
# printed.
set -euo pipefail

file="${1:?usage: export-secrets.sh <file>}"
path="${PARAMETER_PATH:-/openreel/dev}"
region="${AWS_REGION:-us-east-1}"

for tool in aws jq; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done
[[ ! -e "$file" ]] || { echo "error: $file exists; choose a new file" >&2; exit 1; }
if git -C "$(dirname "$file")" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: $file is inside a Git working tree; write it somewhere else" >&2
  exit 1
fi

(umask 077 && : >"$file")
aws ssm get-parameters-by-path --region "$region" --path "$path" --recursive \
  --with-decryption --output json |
  jq --arg path "$path" '{path: $path, parameters: [.Parameters[] | {name: .Name, type: .Type, value: .Value}]}' \
    >"$file"

echo "Exported to $file (mode 600):"
jq -r '.parameters[].name' "$file"
