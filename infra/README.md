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
| `lib/dev-stack.ts` | The `OpenReel-Dev` stack |
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
3. **Add a budget.** In AWS Budgets, create a monthly cost budget, for
   example $100, with email alerts at 50% and 100%.
4. **Install the tools.** Install the AWS CLI (`brew install awscli`). The
   CDK CLI comes with this package, so run it as
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
