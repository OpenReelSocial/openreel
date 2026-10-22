import { Duration, Stack } from 'aws-cdk-lib'
import type { Repository } from 'aws-cdk-lib/aws-ecr'
import type { Instance } from 'aws-cdk-lib/aws-ec2'
import { FederatedPrincipal, OidcProviderNative, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam'
import { Construct } from 'constructs'

import { resourceName, type EnvironmentConfig } from './config.ts'

const githubIssuer = 'token.actions.githubusercontent.com'

export interface DeployAccessProps {
  readonly config: EnvironmentConfig
  readonly repositories: readonly Repository[]
  readonly host: Instance
}

/**
 * Lets GitHub Actions deploy without stored AWS keys (DEV-056): the
 * workflow exchanges its OIDC token for this role, pushes images, and runs
 * the deploy script on the host through SSM Run Command.
 */
export class DeployAccess extends Construct {
  readonly role: Role

  constructor(scope: Construct, id: string, props: DeployAccessProps) {
    super(scope, id)
    const { config, repositories, host } = props
    const stack = Stack.of(this)

    const provider = new OidcProviderNative(this, 'GitHubOidc', {
      url: `https://${githubIssuer}`,
      clientIds: ['sts.amazonaws.com'],
    })

    const repo = config.githubRepository
    // Immutable subjects (what this repository's tokens use) first; the
    // classic form keeps deploys working if that setting is ever turned off.
    const subjects = [config.githubRepositoryImmutable, repo].flatMap((name) => [
      `repo:${name}:ref:refs/heads/main`,
      `repo:${name}:environment:${config.githubDeployEnvironment}`,
    ])
    this.role = new Role(this, 'Role', {
      roleName: resourceName(config, 'github-deploy'),
      description: `Assumed by GitHub Actions in ${repo} to deploy the ${config.name} environment`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new FederatedPrincipal(
        provider.oidcProviderArn,
        {
          StringEquals: {
            [`${githubIssuer}:aud`]: 'sts.amazonaws.com',
            // Pushes to main, or any job in the protected deploy environment
            // (manual dispatch of a branch). Pull requests and forks match
            // neither.
            [`${githubIssuer}:sub`]: subjects,
          },
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    })

    for (const repository of repositories) {
      repository.grantPullPush(this.role)
    }

    this.role.addToPolicy(
      new PolicyStatement({
        actions: ['ssm:SendCommand'],
        resources: [
          stack.formatArn({ service: 'ec2', resource: 'instance', resourceName: host.instanceId }),
          stack.formatArn({
            service: 'ssm',
            account: '',
            resource: 'document',
            resourceName: 'AWS-RunShellScript',
          }),
        ],
      }),
    )
    // Reading a command's result has no resource-level permissions.
    this.role.addToPolicy(
      new PolicyStatement({
        actions: ['ssm:GetCommandInvocation', 'ssm:ListCommandInvocations'],
        resources: ['*'],
      }),
    )
  }
}
