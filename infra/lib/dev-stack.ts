import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import type { ICertificate } from 'aws-cdk-lib/aws-certificatemanager'
import { Repository, TagStatus } from 'aws-cdk-lib/aws-ecr'
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs'
import type { Construct } from 'constructs'

import { resourceName, type EnvironmentConfig } from './config.ts'
import { DeployAccess } from './deploy-access.ts'
import { Host, parameterPath } from './host.ts'
import { Media } from './media.ts'
import { Monitoring } from './monitoring.ts'

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
  /** From CertificateStack: `config.mediaDomain`, validated in Cloudflare. */
  readonly mediaCertificate: ICertificate
}

/**
 * The shared dev/demo backend on AWS (ADR-0007): one EC2 host running the
 * Compose stack, ECR, S3 + CloudFront for media, GitHub OIDC deploys, and
 * CloudWatch. infra/README.md has the deploy order and the manual DNS steps.
 */
export class DevStack extends Stack {
  readonly config: EnvironmentConfig
  readonly repositories: Readonly<Record<ServiceImage, Repository>>
  readonly host: Host
  readonly media: Media
  readonly deployAccess: DeployAccess
  readonly monitoring: Monitoring

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

    const logGroup = new LogGroup(this, 'ContainerLogs', {
      logGroupName: `/openreel/${this.config.name}/containers`,
      retention: RetentionDays.TWO_WEEKS,
      // Logs are diagnostic only; a deleted stack should not leave them behind.
      removalPolicy: RemovalPolicy.DESTROY,
    })

    this.host = new Host(this, 'Host', { config: this.config, logGroup })
    for (const repository of Object.values(repositories)) {
      repository.grantPull(this.host.role)
    }

    this.media = new Media(this, 'Media', {
      config: this.config,
      certificate: props.mediaCertificate,
    })
    this.media.grantPublish(this.host.role)

    this.deployAccess = new DeployAccess(this, 'DeployAccess', {
      config: this.config,
      repositories: Object.values(repositories),
      host: this.host.instance,
    })

    this.monitoring = new Monitoring(this, 'Monitoring', {
      config: this.config,
      instance: this.host.instance,
      distribution: this.media.distribution,
      logGroup,
    })

    const outputs: Record<string, { value: string; description: string }> = {
      RegistryUri: {
        value: `${this.account}.dkr.ecr.${this.region}.amazonaws.com`,
        description: 'ECR registry the deploy workflow pushes to',
      },
      InstanceId: {
        value: this.host.instance.instanceId,
        description: 'Host for SSM sessions and the deploy workflow',
      },
      HostIp: {
        value: this.host.elasticIp.attrPublicIp,
        description: `Cloudflare A record for ${this.config.domain} (DNS only)`,
      },
      MediaDistributionDomain: {
        value: this.media.distribution.distributionDomainName,
        description: `Cloudflare CNAME target for ${this.config.mediaDomain} (DNS only)`,
      },
      MediaBucket: {
        value: this.media.bucket.bucketName,
        description: 'MEDIA_S3_BUCKET for the media worker',
      },
      DeployRoleArn: {
        value: this.deployAccess.role.roleArn,
        description: 'AWS_DEPLOY_ROLE_ARN repository variable for the deploy workflow',
      },
      ContainerLogGroup: {
        value: logGroup.logGroupName,
        description: 'CloudWatch Logs group with one stream per container',
      },
      ParameterPath: {
        value: parameterPath(this.config),
        description: 'SSM Parameter Store path for host secrets',
      },
      DashboardUrl: {
        value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/dashboard/${resourceName(this.config, 'overview')}`,
        description: 'CloudWatch dashboard',
      },
    }
    for (const [id, output] of Object.entries(outputs)) {
      new CfnOutput(this, id, output)
    }
  }
}
