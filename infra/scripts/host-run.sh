#!/usr/bin/env bash
# Runs one of infra/aws/scripts/ as root on the AWS host through SSM Run
# Command, using the operator's credentials, and prints its output. The script
# is sent from this checkout, not fetched from GitHub. Used by the Makefile:
#
#   AWS_PROFILE=openreel-dev make aws-backup
#   AWS_PROFILE=openreel-dev make aws-restore BACKUP=dev/2026-10-23T120000Z
#
#   infra/scripts/host-run.sh <script> [NAME=value ...]
#
# The host and backup bucket come from the OpenReel-Dev stack outputs; the
# NAME=value pairs become the script's environment (never pass secrets).
set -euo pipefail

script="${1:?usage: host-run.sh <script> [NAME=value ...]}"
shift
stack="${STACK_NAME:-OpenReel-Dev}"
region="${AWS_REGION:-us-east-1}"

for tool in aws jq base64; do
  command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done

output() {
  aws cloudformation describe-stacks --region "$region" --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
instance="$(output InstanceId)"
bucket="$(output BackupBucket)"
[[ -n "$bucket" && "$bucket" != None ]] || {
  echo "error: $stack has no BackupBucket output; deploy the stack first" >&2
  exit 1
}

env_lines="export BACKUP_BUCKET=$(printf '%q' "$bucket")"
for pair in "$@"; do
  [[ "$pair" =~ ^[A-Z_][A-Z0-9_]*= ]] || { echo "error: expected NAME=value, got $pair" >&2; exit 1; }
  env_lines+=$'\n'"export ${pair%%=*}=$(printf '%q' "${pair#*=}")"
done
payload="$(base64 <"$script" | tr -d '\n')"
command="$env_lines
echo $payload | base64 -d >/tmp/openreel-host-run.sh
bash /tmp/openreel-host-run.sh; status=\$?
rm -f /tmp/openreel-host-run.sh
exit \$status"

echo "Running $(basename "$script") on $instance ($stack)"
command_id="$(aws ssm send-command --region "$region" \
  --instance-ids "$instance" \
  --document-name AWS-RunShellScript \
  --comment "$(basename "$script")" \
  --parameters "$(jq -n --arg c "$command" '{commands: [$c], executionTimeout: ["3600"]}')" \
  --query Command.CommandId --output text)"

status=Pending
while :; do
  sleep 5
  status="$(aws ssm get-command-invocation --region "$region" --command-id "$command_id" \
    --instance-id "$instance" --query Status --output text 2>/dev/null || echo Pending)"
  case "$status" in Pending | InProgress | Delayed) printf . ;; *) echo; break ;; esac
done

# SSM keeps the last 24,000 characters of each stream.
aws ssm get-command-invocation --region "$region" --command-id "$command_id" \
  --instance-id "$instance" --query StandardOutputContent --output text
aws ssm get-command-invocation --region "$region" --command-id "$command_id" \
  --instance-id "$instance" --query StandardErrorContent --output text >&2
[[ "$status" == Success ]] || { echo "error: $(basename "$script") ended with $status" >&2; exit 1; }
