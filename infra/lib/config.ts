/**
 * Settings for one deployed OpenReel environment (ADR-0007). Only `dev`
 * exists; it is the shared dev/demo backend, not production.
 */
export interface EnvironmentConfig {
  /** Short environment name, used in resource names and the Environment tag. */
  readonly name: string
  /** Target account. Undefined synthesizes an account-agnostic template (CI). */
  readonly account: string | undefined
  readonly region: string
  /** Public hostname of the PDS, PLC, AppView, and feed generator. */
  readonly domain: string
  /** Hostname CloudFront serves HLS renditions on. */
  readonly mediaDomain: string
  /** `owner/name` of the repository GitHub Actions deploys from. */
  readonly githubRepository: string
  /**
   * GitHub environment whose jobs may deploy from any branch (manual
   * dispatch). Pushes to main may always deploy.
   */
  readonly githubDeployEnvironment: string
  /** EC2 instance type of the single Compose host. */
  readonly instanceType: string
  /**
   * Ubuntu 24.04 LTS amd64 AMI for the host. Pinned rather than resolved from
   * Canonical's SSM parameter at deploy time, because a new AMI replaces the
   * instance and with it every volume the Compose stack keeps on its disk.
   */
  readonly hostAmi: string
  /** Root volume size; holds Docker images and every Compose volume. */
  readonly hostVolumeGiB: number
  /** Where alarm and budget notifications go. No subscriptions when undefined. */
  readonly alertEmail: string | undefined
  /** Monthly AWS Budget, in USD, that triggers email alerts. */
  readonly monthlyBudgetUsd: number
}

export const devConfig: EnvironmentConfig = {
  name: 'dev',
  account: process.env['CDK_DEFAULT_ACCOUNT'],
  // CloudFront only accepts ACM certificates from us-east-1, so keeping the
  // whole environment there avoids a cross-region certificate stack.
  region: 'us-east-1',
  domain: 'dev.openreel.social',
  mediaDomain: 'media.dev.openreel.social',
  githubRepository: 'OpenReelSocial/openreel',
  githubDeployEnvironment: 'aws-dev',
  instanceType: 't3a.large',
  // ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20261004
  hostAmi: 'ami-0fa5967347d08d2df',
  hostVolumeGiB: 60,
  // Passed at deploy time (`cdk deploy -c alertEmail=...`) so no personal
  // address is committed.
  alertEmail: undefined,
  monthlyBudgetUsd: 100,
}

/** `openreel-<env>-<name>`: the prefix every named AWS resource carries. */
export function resourceName(config: EnvironmentConfig, name: string): string {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`Resource name "${name}" must be lowercase letters, digits, and dashes`)
  }
  return `openreel-${config.name}-${name}`
}

/** Tags applied to every resource, for cost reports and console filtering. */
export function standardTags(config: EnvironmentConfig): Record<string, string> {
  return {
    Project: 'openreel',
    Environment: config.name,
    ManagedBy: 'cdk',
    Repository: config.githubRepository,
  }
}
