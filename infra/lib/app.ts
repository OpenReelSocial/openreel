import { Tags, type App } from 'aws-cdk-lib'

import { CertificateStack } from './certificate-stack.ts'
import { standardTags, type EnvironmentConfig } from './config.ts'
import { DevStack } from './dev-stack.ts'

export interface OpenReelStacks {
  readonly certificate: CertificateStack
  readonly dev: DevStack
}

/**
 * Adds every stack for an environment to the app. Kept apart from
 * `bin/openreel.ts` so tests synthesize exactly what `cdk deploy` would.
 */
export function addStacks(app: App, config: EnvironmentConfig): OpenReelStacks {
  for (const [key, value] of Object.entries(standardTags(config))) {
    Tags.of(app).add(key, value)
  }

  // Without an account the stack synthesizes account-agnostic, as in CI.
  const env =
    config.account === undefined
      ? { region: config.region }
      : { account: config.account, region: config.region }
  const certificate = new CertificateStack(app, 'OpenReel-Dev-Certificate', {
    env,
    config,
    description: `TLS certificate for ${config.mediaDomain} (ADR-0007)`,
  })
  const dev = new DevStack(app, 'OpenReel-Dev', {
    env,
    config,
    mediaCertificate: certificate.mediaCertificate,
    description: 'OpenReel shared dev/demo backend (ADR-0007)',
    terminationProtection: true,
  })

  return { certificate, dev }
}
