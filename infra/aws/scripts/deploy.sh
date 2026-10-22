#!/usr/bin/env bash
# Deploys one commit to the AWS host (ADR-0007). Runs as root on the host,
# started by .github/workflows/deploy-aws.yml through SSM Run Command, which
# downloads this file from the same commit first.
#
#   1. Fetch the commit's deployment files from GitHub (the repository is
#      public; files are pinned by commit SHA).
#   2. Render .env from SSM Parameter Store plus the non-secret settings below.
#   3. Make sure nginx serves TLS, obtaining a certificate on the first run.
#   4. Pull the commit's images from ECR, migrate (ADR-0003), restart, and wait
#      until every container is healthy.
#
# Never prints secret values. Settings come from the environment:
: "${OPENREEL_SHA:?commit to deploy}"
: "${OPENREEL_REPO:?owner/name on GitHub}"
: "${REGISTRY:?ECR registry, <account>.dkr.ecr.<region>.amazonaws.com}"
: "${IMAGE_PREFIX:?image prefix; images are <prefix>-<service>}"
: "${AWS_REGION:?region of ECR and Parameter Store}"
: "${PARAMETER_PATH:?Parameter Store path holding the secrets, e.g. /openreel/dev}"
: "${PDS_HOSTNAME:?public hostname; must match infra/aws/nginx/openreel.conf}"
: "${PDS_SERVICE_HANDLE_DOMAINS:?handle suffix, e.g. .dev.openreel.social}"
MEDIA_STORE="${MEDIA_STORE:-fs}"
MEDIA_S3_BUCKET="${MEDIA_S3_BUCKET:-}"
MEDIA_PUBLIC_URL="${MEDIA_PUBLIC_URL:-}"
# Optional: Let's Encrypt expiry notices.
ACME_EMAIL="${ACME_EMAIL:-}"

set -euo pipefail

dir=/srv/openreel
secret_keys=(POSTGRES_PASSWORD PLC_DB_PASSWORD PDS_JWT_SECRET PDS_ADMIN_PASSWORD
  PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX)

step() { printf '\n==> %s\n' "$*"; }

install -d -m 700 "$dir"
cd "$dir"

step "Fetching deployment files for $OPENREEL_SHA"
raw="https://raw.githubusercontent.com/$OPENREEL_REPO/$OPENREEL_SHA"
fetch() { curl -fsSL --retry 3 "$raw/$1" -o "$2"; }
fetch infra/dev-server/compose.yaml compose.yaml
fetch services/media/cdn.conf media-cdn.conf
fetch infra/aws/nginx/bootstrap.conf nginx-bootstrap.conf
fetch infra/aws/nginx/openreel.conf nginx-openreel.conf

step "Rendering .env from $PARAMETER_PATH"
umask 077
env_tmp="$(mktemp "$dir/.env.XXXXXX")"
trap 'rm -f "$env_tmp"' EXIT
{
  echo "# Written by infra/aws/scripts/deploy.sh on every deploy; edits are lost."
  echo "# Secrets come from SSM Parameter Store under $PARAMETER_PATH."
  echo "PDS_HOSTNAME=$PDS_HOSTNAME"
  echo "PDS_SERVICE_HANDLE_DOMAINS=$PDS_SERVICE_HANDLE_DOMAINS"
  echo "PDS_INVITE_REQUIRED=true"
  echo "IMAGE_PREFIX=$IMAGE_PREFIX"
  echo "IMAGE_TAG=$OPENREEL_SHA"
  echo "AWS_REGION=$AWS_REGION"
  echo "MEDIA_STORE=$MEDIA_STORE"
  echo "MEDIA_S3_BUCKET=$MEDIA_S3_BUCKET"
  [[ -n "$MEDIA_PUBLIC_URL" ]] && echo "MEDIA_PUBLIC_URL=$MEDIA_PUBLIC_URL"
  # Values are hex (infra/scripts/init-secrets.sh), so they need no quoting.
  aws ssm get-parameters-by-path --path "$PARAMETER_PATH" --with-decryption \
    --region "$AWS_REGION" --query 'Parameters[].[Name,Value]' --output text |
    while IFS=$'\t' read -r name value; do
      printf '%s=%s\n' "${name##*/}" "$value"
    done
} >"$env_tmp"
for key in "${secret_keys[@]}"; do
  grep -qE "^${key}=.+" "$env_tmp" || {
    echo "error: $PARAMETER_PATH/$key is missing; run infra/scripts/init-secrets.sh" >&2
    exit 1
  }
done
mv "$env_tmp" .env
trap - EXIT
umask 022

step "Configuring nginx for $PDS_HOSTNAME"
site=/etc/nginx/sites-available/openreel
install -d /var/www/certbot
ln -sf "$site" /etc/nginx/sites-enabled/openreel
rm -f /etc/nginx/sites-enabled/default
tls_ready=true
if [[ ! -f "/etc/letsencrypt/live/$PDS_HOSTNAME/fullchain.pem" ]]; then
  install -m 644 nginx-bootstrap.conf "$site"
  nginx -t
  systemctl reload-or-restart nginx
  contact=(--register-unsafely-without-email)
  [[ -n "$ACME_EMAIL" ]] && contact=(-m "$ACME_EMAIL")
  # Fails until the A record for $PDS_HOSTNAME points at this host.
  if certbot certonly --webroot -w /var/www/certbot -d "$PDS_HOSTNAME" \
    --non-interactive --agree-tos "${contact[@]}"; then
    # certbot's timer renews through the same webroot; reload to pick it up.
    install -d /etc/letsencrypt/renewal-hooks/deploy
    printf '#!/bin/sh\nsystemctl reload nginx\n' >/etc/letsencrypt/renewal-hooks/deploy/reload-nginx
    chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx
  else
    tls_ready=false
    echo "warning: no certificate for $PDS_HOSTNAME yet (is DNS pointing here?)." >&2
    echo "warning: serving only the ACME challenge; redeploy once DNS resolves." >&2
  fi
fi
if [[ "$tls_ready" == true ]]; then
  install -m 644 nginx-openreel.conf "$site"
  nginx -t
  systemctl reload-or-restart nginx
fi

step "Pulling images from $REGISTRY"
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
trap 'docker logout "$REGISTRY" >/dev/null' EXIT
docker compose --profile tools pull --quiet

step "Migrating"
docker compose run --rm migrate

step "Starting"
docker compose up -d --remove-orphans --wait --wait-timeout 300 || {
  docker compose ps
  docker compose logs --tail 50
  exit 1
}
docker image prune -f >/dev/null
docker compose ps

step "Deployed $OPENREEL_SHA"
[[ "$tls_ready" == true ]] || echo "warning: running without TLS; public HTTPS checks will fail." >&2
