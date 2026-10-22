# OpenReel infrastructure

The AWS CDK app for the shared dev/demo environment (ADR-0007), plus Compose
configuration for operated components (`pds/`) and the Hetzner dev server
(`dev-server/`, ADR-0005, superseded). Rules for changing anything here are in
[`AGENTS.md`](AGENTS.md).

**The shared environment is live at https://dev.openreel.social** (media at
https://media.dev.openreel.social), deployed from `main` by
`.github/workflows/deploy-aws.yml`. The iOS app uses it by default.

## Layout

| Path | Contents |
|---|---|
| `bin/openreel.ts` | CDK entrypoint (`cdk.json` runs it with `tsx`) |
| `lib/config.ts` | Environment settings, `resourceName()`, standard tags |
| `lib/app.ts` | `addStacks()`: every stack for an environment |
| `lib/certificate-stack.ts` | `OpenReel-Dev-Certificate`: ACM certificate for the media hostname |
| `lib/dev-stack.ts` | `OpenReel-Dev`: ECR, container log group, and the constructs below |
| `lib/host.ts` | VPC, security group, EC2 host, Elastic IP, host role, first-boot setup |
| `lib/media.ts` | Private S3 bucket and CloudFront distribution for HLS |
| `lib/deploy-access.ts` | GitHub OIDC provider and the deploy role |
| `lib/monitoring.ts` | SNS alerts, alarms, Route 53 health checks, dashboard, budget |
| `aws/scripts/deploy.sh` | Runs on the host for every deploy (see below) |
| `aws/nginx/` | The host's nginx site, and the HTTP-only site used before TLS exists |
| `scripts/init-secrets.sh` | One-time generation of the host's secrets in Parameter Store |
| `test/` | Vitest + `aws-cdk-lib/assertions` tests, run by `make test` |

Every resource is tagged `Project=openreel`, `Environment=dev`,
`ManagedBy=cdk`, and `Repository=OpenReelSocial/openreel`. Physical names
are `openreel-dev-<name>`.

## Commands

| Command | What it does | Needs AWS credentials |
|---|---|---|
| `make infra-synth` | Synthesizes CloudFormation into `infra/cdk.out/` | No |
| `pnpm --filter @openreel/infra test` | Runs the CDK assertion tests | No |
| `make infra-diff` | Compares the app with what is deployed | Yes |
| `pnpm --filter @openreel/infra cdk deploy` | Deploys (humans only) | Yes |

CI runs `make infra-synth` and the tests on every pull request.

## One-time account setup

Done once per AWS account, by a human with admin access.

1. **Secure the root user.** Turn on MFA, and don't create access keys for
   it.
2. **Create your everyday identity.** In IAM Identity Center, enable the
   service, create a user for yourself, and assign it the
   `AdministratorAccess` permission set on the account.
3. **Add a budget.** Deploying with `-c alertEmail=...` creates a $100
   monthly budget with email alerts. Until then, or if you skip the email,
   create one by hand in AWS Budgets.
4. **Install the tools.** Install the AWS CLI (`brew install awscli`) and
   the Session Manager plugin (`brew install --cask session-manager-plugin`).
   The CDK CLI comes with this package, so run it as
   `pnpm --filter @openreel/infra cdk`.
5. **Sign in from the CLI.** Run `aws configure sso` with profile name
   `openreel-dev` and region `us-east-1`. Later, `aws sso login --profile
   openreel-dev` refreshes the session.
6. **Bootstrap CDK.** Run this once per account and region:

   ```sh
   export AWS_PROFILE=openreel-dev
   pnpm --filter @openreel/infra cdk bootstrap aws://<account-id>/us-east-1
   ```

Check access with `aws sts get-caller-identity --profile openreel-dev`.

## Deploying the environment

A human runs these, in order, with `AWS_PROFILE=openreel-dev`. Below,
`cdk` means `pnpm --filter @openreel/infra cdk`.

1. **Certificate.** Run `cdk deploy OpenReel-Dev-Certificate`. The deploy
   waits for DNS validation. While it waits, open ACM in `us-east-1`, copy
   the certificate's CNAME name and value, and add them in Cloudflare as a
   **DNS only** record. The stack finishes a few minutes after that.
2. **Everything else.** Run
   `cdk deploy OpenReel-Dev -c alertEmail=<your address>`. AWS emails a
   subscription confirmation; accept it, or the alarms go nowhere. Leaving
   out `alertEmail` deploys without the email subscription and the budget.
3. **DNS.** From the stack outputs, add two records in Cloudflare, both
   **DNS only** (grey cloud). Cloudflare's proxy would sit in front of the
   PDS's large uploads and long-lived WebSockets.

   | Type | Name | Value |
   |---|---|---|
   | A | `dev` | `HostIp` |
   | CNAME | `media.dev` | `MediaDistributionDomain` |

4. **Secrets.** Run `AWS_PROFILE=openreel-dev infra/scripts/init-secrets.sh`
   once. It generates the PDS and database secrets into Parameter Store
   under `/openreel/dev/` without printing them, and skips any that exist.
5. **GitHub.** In the repository settings, create the `aws-dev` environment
   (Settings → Environments). Add required reviewers there if every deploy
   should wait for approval. Then add these repository variables from the
   stack outputs:

   | Variable | Value |
   |---|---|
   | `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` |
   | `AWS_INSTANCE_ID` | `InstanceId` |
   | `ACME_EMAIL` (optional) | address for Let's Encrypt expiry notices |

   The deploy role trusts only jobs in the `aws-dev` environment (or
   unscoped jobs on `main`); `.github/workflows/deploy-aws.yml` runs every
   job there. The workflow skips itself until `AWS_DEPLOY_ROLE_ARN` is set.

The stack outputs are shown after a deploy, or with
`aws cloudformation describe-stacks --stack-name OpenReel-Dev --query 'Stacks[0].Outputs'`.

The host's first boot installs Docker, nginx, certbot, the AWS CLI, and the
CloudWatch agent, and sends every container's logs to CloudWatch. The deploy
workflow installs the application itself.

`infra/cdk.context.json` records the availability zones CDK looked up in the
account. It is committed, so every synth picks the same subnets.

## Deploying the application

`.github/workflows/deploy-aws.yml` deploys after CI passes on `main`, or from
any branch with **Run workflow** in the Actions tab. It builds the six images,
pushes them to ECR as `openreel-dev-<image>:<sha>`, and runs
[`aws/scripts/deploy.sh`](aws/scripts/deploy.sh) on the host through SSM Run
Command. That script, as root on the host:

1. downloads this commit's `compose.yaml` (shared with the Hetzner server,
   `dev-server/compose.yaml`), the media CDN config, and the nginx sites
   from GitHub, pinned to the commit SHA;
2. writes `/srv/openreel/.env` from Parameter Store plus non-secret settings;
3. on the first run, obtains a Let's Encrypt certificate for
   `dev.openreel.social` through a webroot challenge (needs the A record in
   place), then installs [`aws/nginx/openreel.conf`](aws/nginx/openreel.conf),
   TLS included. certbot renews it and reloads nginx on its own;
4. logs in to ECR with the instance role, pulls, migrates, and starts every
   container, failing if any is unhealthy after five minutes.

The workflow then checks the public endpoints and that the AppView reports
the deployed SHA. The host's output, truncated to its last 24,000
characters, is in the workflow log; container logs are in CloudWatch.

Media is written to S3 and served by CloudFront: the repository variables
`MEDIA_STORE=s3`, `AWS_MEDIA_BUCKET` (the `MediaBucket` output), and
`MEDIA_PUBLIC_URL=https://media.dev.openreel.social` are set. Without them the
host falls back to `MEDIA_STORE=fs`, serving renditions itself at `/media/`;
videos transcoded under one setting are not visible under the other and need
re-seeding.

To check the environment from outside, and to seed demo content:

```sh
PUBLIC_URL=https://dev.openreel.social make smoke
PUBLIC_URL=https://dev.openreel.social PDS_ADMIN_PASSWORD=... make seed-videos
PUBLIC_URL=https://dev.openreel.social PDS_ADMIN_PASSWORD=... make e2e-upload
```

`PDS_ADMIN_PASSWORD` is the `/openreel/dev/PDS_ADMIN_PASSWORD` parameter. To
use it without printing it:
`PDS_ADMIN_PASSWORD="$(AWS_PROFILE=openreel-dev aws ssm get-parameter --region us-east-1 --name /openreel/dev/PDS_ADMIN_PASSWORD --with-decryption --query Parameter.Value --output text)"`.

To create an account (sign-up needs an invite), open a shell with
`aws ssm start-session` and run:

```sh
sudo -i
cd /srv/openreel && set -a && . ./.env && set +a
curl -s -u "admin:$PDS_ADMIN_PASSWORD" -H 'content-type: application/json' \
  -d '{"useCount":1}' http://127.0.0.1:4100/xrpc/com.atproto.server.createInviteCode
```

Until DNS points at the host and the application is running, the PDS and
AppView health alarms are in `ALARM`. That is expected.

## Operating

```sh
# Shell on the host (no SSH; needs the Session Manager plugin)
aws ssm start-session --target <InstanceId>

# The admin page, which listens only on the host's loopback.
aws ssm start-session --target <InstanceId> \
  --document-name AWS-StartPortForwardingSession \
  --parameters portNumber=4104,localPortNumber=4104

# Follow one container's logs
aws logs tail /openreel/dev/containers --follow --log-stream-name-prefix openreel-appview
```

**Debug portal:** https://dev.openreel.social/debug shows every SQL statement
live, with the pipeline's state. It has no password; only `/debug` is public,
and the rest of the admin service stays on loopback. To require one, set
`DEBUG_PASSWORD` on the admin service in `dev-server/compose.yaml` (Basic auth,
user `admin`).

The services report each query to the debug portal (`DEBUG_QUERY_TAP`, on by
default; it costs one extra Postgres round trip per query). To turn it off,
add a `DEBUG_QUERY_TAP` parameter with value `0` under the Parameter Store path
and redeploy: `deploy.sh` copies every parameter there into `.env`.

The `openreel-dev-overview` dashboard (the `DashboardUrl` output) shows
endpoint health, host CPU, disk, and memory, CloudFront traffic and errors,
and recent error lines from all containers.

**Stopping to save money.**
`aws ec2 stop-instances --instance-ids <InstanceId>` stops the host but keeps
its disk, Elastic IP, and data; `start-instances` brings it back, and Compose
restarts the containers. While it is stopped, the health alarms fire.

**Cost.** About $65–80 a month while running: the instance, a 60 GB gp3
volume, a public IPv4 address, two Route 53 health checks, and logs. S3 and
CloudFront cost cents at demo traffic. A stopped instance leaves roughly
$10 a month.

**Changing the host.** The AMI is pinned in `lib/config.ts`. Changing it, or
anything else that replaces the instance, destroys every Compose volume on
it: PDS accounts, Postgres, and PLC. The PR should say so. First-boot setup
in `lib/host.ts` runs only on a new instance, so editing it does not change
the running host.
