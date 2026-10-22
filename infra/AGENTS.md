# Infrastructure agent instructions

Applies to everything under `infra/`. Adds to the root `AGENTS.md`; where they
differ, this file wins for this subtree.

`infra/` holds two kinds of content:

- **The AWS CDK v2 app** (`bin/`, `lib/`, `test/`, `cdk.json`), which defines
  the shared dev environment on AWS (ADR-0007).
- **Configuration for operated components and hosts**: `pds/` (upstream PDS,
  PLC, Jetstream for local development) and `dev-server/` (the Hetzner
  deployment, ADR-0005).

## Rules

- **Infrastructure changes are code.** Every AWS resource is created by the
  CDK app. Do not create, modify, or delete resources in the console or with
  ad-hoc CLI calls, except the manual steps `infra/README.md` documents (DNS
  records in Cloudflare, `cdk bootstrap`, secret generation).
- **Synthesize and test before proposing.** Run `make infra-synth` and
  `pnpm --filter @openreel/infra test` for any change under `bin/` or `lib/`.
  Behavior that matters for security (public exposure, IAM, trust policies,
  open ports) gets an assertion test in `test/`.
- **Least privilege.** Grant actions on specific resources. No `"*"` actions;
  `"*"` resources only where the AWS API offers nothing narrower, with a
  comment saying so. Prefer CDK `grant*` methods over hand-written policies.
- **Nothing public by accident.** S3 buckets keep Block Public Access on and
  are read through CloudFront Origin Access Control. Security groups open
  only what a documented requirement needs; no SSH (use SSM).
- **No credentials in the repository or CI.** Secrets live in SSM Parameter
  Store; GitHub Actions reaches AWS only through OIDC.
- **New primitives need a decision.** A new AWS service category (database,
  queue, load balancer, cluster, NAT) is an architecture change: check the
  ADRs and raise it before adding it.
- **Humans deploy infrastructure.** Agents may run `make infra-synth`,
  `make infra-diff`, and read-only AWS calls. `cdk bootstrap`, `cdk deploy`,
  `cdk destroy`, and anything that deletes data or changes IAM in a live
  account need explicit human approval and are normally run by a human.
- **Stateful resources are retained.** Buckets, volumes, and log groups that
  hold data use a retain or snapshot removal policy unless the task says the
  data is disposable.
- **Name and tag consistently.** Use `resourceName()` and the standard tags
  in `lib/config.ts` for anything with a physical name.
