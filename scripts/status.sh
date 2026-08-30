#!/usr/bin/env bash
# Print the local service status from the admin service's status API.
#
# The probing logic lives in services/admin so the page and this script cannot
# disagree; this is just a terminal renderer for it.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f .env ]] && set -a && . ./.env && set +a

url="http://localhost:${ADMIN_PORT:-3003}/api/status"

if ! body=$(curl -sS --max-time 5 "$url" 2>&1); then
  echo "Could not reach the admin service at $url" >&2
  echo "Start the stack with 'make up', or see 'docker compose logs admin'." >&2
  exit 1
fi

python3 - "$body" <<'PY'
import json, sys

report = json.loads(sys.argv[1])
GREEN, RED, DIM, RESET = '\033[32m', '\033[31m', '\033[2m', '\033[0m'

banner = 'All services operational' if report['allUp'] else 'DEGRADED'
print(f"{GREEN if report['allUp'] else RED}{banner}{RESET}  {DIM}{report['checkedAt']}{RESET}\n")

for r in report['results']:
    up = r['status'] == 'up'
    print(f"  {GREEN + 'up  ' if up else RED + 'down'}{RESET}  "
          f"{r['name']:<9} {r['latencyMs']:>5}ms  {r['detail']:<22} {DIM}{r['role']}{RESET}")

sys.exit(0 if report['allUp'] else 1)
PY
