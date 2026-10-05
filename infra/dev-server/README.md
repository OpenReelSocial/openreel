# Dev/demo server

The shared backend at **https://openreel.zackmurry.com**, deployed by
`.github/workflows/deploy-dev-server.yml` (rationale in ADR-0005). It runs on
`dvk-server` (178.104.184.37) at `/srv/openreel`, alongside other projects.

| Path | Service | Server loopback port |
|---|---|---|
| `/` | PDS (XRPC, OAuth, `/.well-known`, subscribeRepos) | 4100 |
| `/plc/` | private PLC directory, read-only | 4101 |
| `/appview/` | AppView | 4102 |
| `/feedgen/` | feed generator | 4103 |
| — | admin status page | 4104 |
| — | event-consumer | 4105 |

Postgres, Redis, the PLC database, and Jetstream are only on the Compose
network.

## Deploying

When CI passes on `main`, the workflow builds every image, pushes it to GHCR
tagged with the commit SHA, then over SSH:

1. copies `compose.yaml`, `.env.example`, and `scripts/init-env.sh`,
2. runs `init-env.sh`, which creates `.env` and fills any empty secret,
3. writes `IMAGE_TAG=<sha>` into `.env`,
4. pulls, runs `migrate`, then `docker compose up -d --wait`,
5. smoke-tests the public URLs and checks AppView reports the new SHA.

To deploy a branch, run the workflow from the Actions tab (**Run workflow**).
It skips CI and leaves `:latest` alone. The next main deploy replaces it.

## Operating

```sh
ssh dvk-server
cd /srv/openreel
docker compose ps
docker compose logs -f pds
docker compose run --rm migrate status
```

Admin page and event stream, through an SSH tunnel:

```sh
ssh -L 4104:127.0.0.1:4104 -L 4105:127.0.0.1:4105 dvk-server
# http://localhost:4104 and http://localhost:4105/events
```

Sign-up needs an invite (`PDS_INVITE_REQUIRED=true`). To make one, run on the
server:

```sh
cd /srv/openreel && set -a && . ./.env && set +a
curl -s -u "admin:$PDS_ADMIN_PASSWORD" -H 'content-type: application/json' \
  -d '{"useCount":1}' http://127.0.0.1:4100/xrpc/com.atproto.server.createInviteCode
```

Handles are `<name>.openreel.zackmurry.com`. There is no wildcard DNS: clients
resolve handles through the PDS's `com.atproto.identity.resolveHandle` and DIDs
through `https://openreel.zackmurry.com/plc`.

Data on this server is disposable. Nothing backs up the volumes.

## One-time server setup

Already done on `dvk-server`. Here for rebuilding it or moving hosts.

1. Docker with the Compose plugin, nginx, certbot (`python3-certbot-nginx`),
   `openssl`, and `xxd` installed. A DNS A record points at the host.
2. Install the nginx site and get a certificate:

   ```sh
   cp nginx/openreel.zackmurry.com /etc/nginx/sites-available/
   ln -s /etc/nginx/sites-available/openreel.zackmurry.com /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   # This host has two ACME accounts, so certbot needs --account
   # (see 'account =' in /etc/letsencrypt/renewal/*.conf).
   certbot --nginx -d openreel.zackmurry.com --redirect
   ```

   The repo copy is the pre-certbot version. Certbot adds the 443 block on the
   server. After changing the repo copy, re-apply it by hand and re-run certbot.

3. Deploy key: generate an ed25519 key pair, append the public half to root's
   `~/.ssh/authorized_keys`, and store the private half as the
   `DEPLOY_SSH_KEY` repository secret. The first deploy creates
   `/srv/openreel` and its `.env`.

## Changing the hostname

`PDS_HOSTNAME` is written into every DID document the PDS creates, so changing
it strands existing accounts (recreate them, since they are disposable). Update
`PDS_HOSTNAME` and `PDS_SERVICE_HANDLE_DOMAINS` in the server's `.env`, the
nginx `server_name`, `PUBLIC_URL` in the workflow, and the hostname in
`.env.example` and here.
