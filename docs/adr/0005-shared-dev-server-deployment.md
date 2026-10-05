# ADR-0005: Shared dev/demo server on a single host with Compose

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** ZackMurry

## Context

The team needs a deployed backend: a PDS reachable over HTTPS so the iOS app
can sign in from a real device (OR-019 can only use `localhost` today), plus a
stable place to run demos.

ADR-0002 chose AWS CDK for infrastructure as code, and the backlog plans
shared dev on AWS (DEV-048 to DEV-059: CDK, ECR, IAM via IaC, GitHub OIDC). None
of that has started, and it is a lot of work before anything runs.

A server already exists: a 4-vCPU, 8 GB Hetzner VM (`dvk-server`) that runs
other projects behind nginx and Let's Encrypt and deploys them from GitHub
Actions. The whole backend fits on it. `openreel.social` DNS is not set up yet;
`openreel.zackmurry.com` points at the server.

## Decision

Run the shared dev/demo backend on that server with Docker Compose, deployed
by GitHub Actions:

- **Images:** CI builds each backend service, plus a one-shot `db-migrate`
  image, and pushes them to GHCR (`ghcr.io/openreelsocial/openreel-*`), tagged
  with the commit SHA (and `latest` for main).
- **Trigger:** `.github/workflows/deploy-dev-server.yml` runs once CI passes
  on main, or by hand for any branch.
- **Deploy:** over SSH with a dedicated key (`DEPLOY_SSH_KEY`): copy
  `infra/dev-server/compose.yaml`, fill in any missing secrets in the server's
  `.env`, pull, run migrations explicitly (ADR-0003), `up --wait`, and
  smoke-test the public URLs.
- **Topology:** one hostname for now. nginx terminates TLS and proxies the PDS
  at the root, read-only PLC at `/plc/`, AppView at `/appview/`, feed generator
  at `/feedgen/`. Admin and event-consumer stay on loopback.
- **Identity:** a private PLC directory, as in local development. Dev and demo
  DIDs never reach `plc.directory`. Sign-up needs an invite by default.
- **Secrets:** generated on the server into `/srv/openreel/.env` (mode 600) and
  never committed or sent to CI.

This is the shared dev environment for now. It does not replace the AWS plan
for production media infrastructure.

## Alternatives considered

| Option | Why not |
|---|---|
| Do the AWS CDK backlog first (DEV-048 onwards) | Weeks of IaC, IAM, and OIDC work before anything runs, and AWS costs that an 8 GB VM doesn't have. |
| Reuse the local `compose.yaml` + `infra/pds/compose.yaml` with an override | The local files build from source and publish dev ports; Compose appends `ports` rather than replacing them. A separate file that pulls images is simpler. |
| Public `plc.directory` | Every dev account would leave a permanent public DID. Bluesky interop isn't needed yet. |
| Self-hosted Actions runner on the server | Gives CI jobs a long-lived foothold on a shared host; push-over-SSH matches the other projects there. |

## Consequences

- Real devices and demos can reach a TLS PDS. Each merge to main redeploys.
- The server is a single point of failure, with no backups yet, so data on it
  is disposable. Uptime and capacity are shared with unrelated projects.
- Deploy access is a root SSH key in a repository secret. Access to the
  `docker` group is equivalent to root anyway, so a separate user would not
  narrow it much.
- `PDS_HOSTNAME` is baked into every DID document. Moving to `openreel.social`
  later means recreating accounts (cheap while they are disposable) or
  rotating PLC entries.
- Services under path prefixes (`/appview/`) are a stopgap. Real AT Protocol
  service routing (`atproto-proxy`, service DIDs) wants dedicated hostnames.
- `infra/dev-server/compose.yaml` duplicates service definitions from the local
  Compose files, so the two have to be kept in step.
- Infra-as-code covers the Compose file, nginx site, and env template. Initial
  host setup (Docker, nginx, certbot, DNS) is manual and documented in
  `infra/dev-server/README.md`.

## Revisit if

`openreel.social` DNS is ready (move to dedicated hostnames), dev data starts
to matter (add backups or managed storage), the backlog's AWS shared-dev work
starts, or the server runs out of capacity.
