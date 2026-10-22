# OpenReel infrastructure

The AWS CDK app for the shared dev/demo environment (ADR-0007), plus Compose
configuration for operated components (`pds/`) and the Hetzner dev server
(`dev-server/`, ADR-0005). Rules for changing anything here are in
[`AGENTS.md`](AGENTS.md).

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

4. **GitHub.** Add the repository variable `AWS_DEPLOY_ROLE_ARN` with the
   value of `DeployRoleArn`, and create the `aws-dev` environment with
   required reviewers. Only `main` and jobs in that environment can assume
   the role.

The stack outputs are shown after a deploy, or with
`aws cloudformation describe-stacks --stack-name OpenReel-Dev --query 'Stacks[0].Outputs'`.

The host's first boot installs Docker, nginx, certbot, the AWS CLI, and the
CloudWatch agent, and sends every container's logs to CloudWatch. The deploy
workflow installs the application itself.

Until DNS points at the host and the application is running, the PDS and
AppView health alarms are in `ALARM`. That is expected.

## Operating

```sh
# Shell on the host (no SSH; needs the Session Manager plugin)
aws ssm start-session --target <InstanceId>

# The admin page, which listens only on the host's loopback
aws ssm start-session --target <InstanceId> \
  --document-name AWS-StartPortForwardingSession \
  --parameters portNumber=4104,localPortNumber=4104

# Follow one container's logs
aws logs tail /openreel/dev/containers --follow --log-stream-name-prefix openreel-appview
```

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
