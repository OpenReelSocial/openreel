import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib'
import { Repository, TagStatus } from 'aws-cdk-lib/aws-ecr'
import type { Construct } from 'constructs'

import { resourceName, type EnvironmentConfig } from './config.ts'

/**
 * Backend images CI builds, one ECR repository each. Keep in step with the
 * build matrix in .github/workflows/deploy-dev-server.yml.
 */
export const serviceImages = [
  'appview',
  'feedgen',
  'admin',
  'event-consumer',
  'media',
  'db-migrate',
] as const

export type ServiceImage = (typeof serviceImages)[number]

export interface DevStackProps extends StackProps {
  readonly config: EnvironmentConfig
}

/**
 * The shared dev/demo backend on AWS (ADR-0007): one EC2 host running the
 * Compose stack, ECR, S3 + CloudFront for media, GitHub OIDC deploys, and
 * CloudWatch. Resources are added as the backlog's AWS tasks land.
 */
export class DevStack extends Stack {
  readonly config: EnvironmentConfig
  readonly repositories: Readonly<Record<ServiceImage, Repository>>

  constructor(scope: Construct, id: string, props: DevStackProps) {
    super(scope, id, props)
    this.config = props.config

    const repositories = {} as Record<ServiceImage, Repository>
    for (const image of serviceImages) {
      repositories[image] = new Repository(this, `Repository-${image}`, {
        repositoryName: resourceName(this.config, image),
        imageScanOnPush: true,
        lifecycleRules: [
          {
            description: 'Drop layers left untagged by re-pushed tags',
            tagStatus: TagStatus.UNTAGGED,
            maxImageAge: Duration.days(1),
          },
          {
            description: 'Keep the 20 most recent images; older SHAs can be rebuilt',
            tagStatus: TagStatus.ANY,
            maxImageCount: 20,
          },
        ],
      })
    }
    this.repositories = repositories

    new CfnOutput(this, 'RegistryUri', {
      description: 'ECR registry the deploy workflow pushes to',
      value: `${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
    })
  }
}
