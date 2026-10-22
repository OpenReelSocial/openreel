# ADR-0007: Shared dev/demo backend on AWS

- **Status:** Proposed
- **Date:** 2026-10-21
- **Deciders:** Andrew Hellman (pending review: Zack Murry, Hfarah-1)

## Context

ADR-0005 put the shared dev/demo backend on a Hetzner VM shared with other
projects (`openreel.zackmurry.com`), deployed by GitHub Actions over SSH. It
works, and it deliberately deferred the backlog's AWS track (DEV-048 to
DEV-066) because that track looked like weeks of work before anything ran.

The midpoint demo needs the backend on the project's own infrastructure and
domain, with an architecture we can show: infrastructure as code (ADR-0002
chose AWS CDK v2 in TypeScript), CI/CD without long-lived cloud keys, media
behind a CDN, and monitoring. It also has to be ready in weeks, cost a student
budget, and run the stack we already have.

That stack constrains the shape. The PDS keeps SQLite databases and blobs on
local disk; PLC and Jetstream are pinned upstream images with their own state;
`infra/dev-server/compose.yaml` already runs all of it, plus our services,
on one 8 GB host. ADR-0006 left media on a filesystem behind nginx, with an S3
store and a CDN as the planned next step, and ADR-0002 left the CDN choice
open (the project plan contradicts itself between CloudFront and Cloudflare).

## Decision

Run the shared dev/demo backend on AWS in `us-east-1`, defined in a CDK app at
`infra/` (stacks under `infra/lib/`), as one environment named `dev`:

- **Compute.** One EC2 instance (x86, `t3a.large` class, Ubuntu 24.04 LTS)
  in a public subnet with an Elastic IP, running the existing Compose stack
  from ECR images. No NAT gateway, no load balancer. nginx and certbot on the
  host terminate TLS, as on the Hetzner server. Ubuntu ships Docker Compose,
  nginx, and certbot as distribution packages, so host setup matches the
  Hetzner server's; its AMI is pinned, because a new AMI replaces the
  instance and the Compose volumes on its disk.
- **Images.** CI builds each backend image and pushes it to ECR, tagged with
  the commit SHA and `latest` for main.
- **Media.** Renditions go to a private S3 bucket (Block Public Access on)
  through an S3 implementation of the existing `MediaStore` interface, served
  by **CloudFront** with Origin Access Control. This resolves ADR-0002's open
  CDN item for now: CloudFront, because the bucket and the CDN then share one
  IaC tool, one account, and one IAM model.
- **Deploys.** GitHub Actions assumes a deploy role through **GitHub OIDC**
  (no stored AWS keys), pushes images, and runs the deploy on the instance
  through **SSM Run Command** (no SSH port, no SSH key). Same steps as today:
  pull, migrate (ADR-0003), `up --wait`, smoke test.
- **Access.** Operators use SSM Session Manager and port forwarding for the
  host and the loopback-only admin page. The security group allows only 80
  and 443.
- **Secrets.** Generated once into SSM Parameter Store SecureStrings under
  `/openreel/dev/`; the deploy renders the host's `.env` from them. Never
  committed or passed through CI.
- **DNS.** `openreel.social` stays on Cloudflare. `dev.openreel.social` points
  at the Elastic IP and `media.dev.openreel.social` at CloudFront, both as
  DNS-only (unproxied) records, added by hand. ACM validation records too.
- **Monitoring.** Container logs go to CloudWatch Logs (14-day retention)
  through the `awslogs` driver. Alarms on instance status, CPU, disk, and
  public health notify an SNS email topic. A dashboard shows the same, and an
  AWS Budget alerts on spend.
- **Change control.** Humans run `cdk bootstrap` and `cdk deploy`. Agents and
  CI synthesize, diff, and test the CDK app; application deploys go through
  the CI workflow only. `infra/AGENTS.md` holds the rules.

The Hetzner server keeps running until the AWS environment has passed its
smoke tests and the iOS app points at it; then ADR-0005 is marked superseded.

## Alternatives considered

| Option | Why not |
|---|---|
| ECS Fargate per service, RDS, ElastiCache, EFS for the PDS | Closer to production, but weeks more work and several times the cost. The PDS's SQLite-on-disk storage is awkward on EFS, and nothing at demo scale needs independent scaling. Remains the direction if dev data starts to matter. |
| Stay on the Hetzner server | Free and working, but on a personal domain and shared host, with SSH-key deploys and no CDN; it does not exercise the AWS architecture the backlog and ADR-0002 commit to. |
| Application Load Balancer + ACM in front of the instance | About $16+/month more for TLS we already terminate with nginx and certbot, and one more thing to explain in the demo. Worth adding with a second instance or with ECS. |
| Cloudflare as the CDN | Keeps DNS and CDN together, but the bucket would need a public or signed origin outside the CDK app, and the free plan's 100 MB request limit matches the PDS blob limit exactly. |
| Route 53 for `openreel.social` | Automatic DNS and certificate validation from CDK, but moves a domain the team already manages in Cloudflare. A few manual records is cheaper. |
| SSH deploys as on Hetzner | Needs port 22 open and a long-lived private key in GitHub; SSM needs neither. |

## Consequences

- One host is a single point of failure and nothing is backed up. Dev data is
  disposable, as before; accounts on the new PDS start empty.
- Cost is roughly $65–80/month with the instance running (instance, 60 GB gp3,
  public IPv4, logs); stopping the instance between demos cuts most of it.
- `PDS_HOSTNAME` becomes `dev.openreel.social` and is baked into every DID
  document created there. Moving hostnames again means recreating accounts.
- Services are still under path prefixes (`/appview/`), the stopgap ADR-0005
  noted; dedicated hostnames remain a later change.
- `MEDIA_PUBLIC_URL` points at CloudFront, so clients stream from the CDN and
  the instance never serves video.
- The Compose file for this host is shared with the Hetzner deployment through
  variables rather than copied a third time.
- DNS and certificate validation are manual steps documented in
  `infra/README.md`, not IaC.
- Reversal is cheap: the CDK app can be destroyed and the Hetzner deployment
  is untouched until cutover.

## Revisit if

Dev data starts to matter (backups, managed Postgres), the host runs out of
capacity or needs a second instance (ALB, ECS), `openreel.social` moves to
Route 53, or a production environment is planned.
