#!/usr/bin/env bash
# Lists the newest user reports Ozone has received (ADR-0009), newest first.
# Runs as root on the AWS host, started by `make aws-reports`
# (infra/scripts/host-run.sh) through SSM. Ozone has no public hostname yet,
# so this asks it from inside its own container, with the admin password it
# already holds; nothing secret is printed.
LIMIT="${LIMIT:-25}"
OPENREEL_DIR="${OPENREEL_DIR:-/srv/openreel}"

set -euo pipefail

[[ "$LIMIT" =~ ^[0-9]+$ ]] || { echo "error: LIMIT must be a number" >&2; exit 1; }
cd "$OPENREEL_DIR"
docker compose exec -T ozone node -e '
  const auth = "Basic " + Buffer.from("admin:" + process.env.OZONE_ADMIN_PASSWORD).toString("base64")
  const query = new URLSearchParams({ types: "tools.ozone.moderation.defs#modEventReport", limit: process.argv[1] })
  fetch("http://127.0.0.1:3000/xrpc/tools.ozone.moderation.queryEvents?" + query, { headers: { authorization: auth } })
    .then(async (res) => {
      const body = await res.json()
      if (!res.ok) throw new Error(res.status + " " + JSON.stringify(body))
      if (body.events.length === 0) console.log("No reports yet.")
      for (const e of body.events) {
        const subject = e.subject.uri ?? e.subject.did
        const reason = (e.event.reportType ?? "").split("#").pop()
        console.log(e.createdAt + "  " + reason.padEnd(16) + subject)
        console.log("    from " + e.createdBy + (e.event.comment ? ": " + JSON.stringify(e.event.comment) : ""))
      }
    })
    .catch((error) => { console.error(error.message); process.exit(1) })
' "$LIMIT"
