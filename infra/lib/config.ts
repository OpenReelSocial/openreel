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
