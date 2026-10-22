import { Match } from 'aws-cdk-lib/assertions'
import { describe, expect, it } from 'vitest'

import { devConfig } from '../lib/config.ts'
import { actionsOf, allowStatements, synthesize } from './support.ts'

const { dev, certificate } = synthesize()

describe('host exposure', () => {
  it('opens only HTTP and HTTPS, and never SSH', () => {
    const groups = dev.findResources('AWS::EC2::SecurityGroup')
    const ingress = Object.values(groups).flatMap(
      (group) =>
        (group as { Properties: { SecurityGroupIngress?: { FromPort: number }[] } }).Properties
          .SecurityGroupIngress ?? [],
    )
    expect(ingress.map((rule) => rule.FromPort).sort()).toEqual([443, 80])
    expect(dev.findResources('AWS::EC2::SecurityGroupIngress')).toEqual({})
  })

  it('requires IMDSv2', () => {
    dev.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: { MetadataOptions: { HttpTokens: 'required' } },
    })
  })

  it('encrypts a pinned-size gp3 root volume', () => {
    dev.hasResourceProperties('AWS::EC2::Instance', {
      ImageId: devConfig.hostAmi,
      InstanceType: devConfig.instanceType,
      BlockDeviceMappings: [
        {
          DeviceName: '/dev/sda1',
          Ebs: { Encrypted: true, VolumeType: 'gp3', VolumeSize: devConfig.hostVolumeGiB },
        },
      ],
    })
  })

  it('sends container logs to CloudWatch from first boot', () => {
    const instance = Object.values(dev.findResources('AWS::EC2::Instance'))[0]
    expect(JSON.stringify(instance)).toContain('awslogs')
  })
})

describe('IAM', () => {
  const statements = allowStatements(dev)

  it('never grants a wildcard action', () => {
    for (const statement of statements) {
      for (const action of actionsOf(statement)) {
        expect(action).not.toBe('*')
        expect(action).not.toMatch(/^[a-z0-9]+:\*$/)
      }
    }
  })

  it('uses "*" resources only for APIs without resource-level permissions', () => {
    const allowed = new Set([
      'ecr:GetAuthorizationToken',
      'cloudwatch:PutMetricData',
      'ssm:GetCommandInvocation',
      'ssm:ListCommandInvocations',
    ])
    for (const statement of statements.filter((s) => s.Resource === '*')) {
      for (const action of actionsOf(statement)) {
        expect(allowed).toContain(action)
      }
    }
  })

  it('limits metric publishing to the CloudWatch agent namespace', () => {
    const putMetric = statements.find((s) => actionsOf(s).includes('cloudwatch:PutMetricData'))
    expect(putMetric?.Condition).toEqual({ StringEquals: { 'cloudwatch:namespace': 'CWAgent' } })
  })

  it('lets only main and the protected deploy environment assume the deploy role', () => {
    dev.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'openreel-dev-github-deploy',
      MaxSessionDuration: 3600,
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                // This repository's tokens use GitHub's immutable subject form.
                'token.actions.githubusercontent.com:sub': [
                  'repo:OpenReelSocial@321618312/openreel@1348002581:ref:refs/heads/main',
                  'repo:OpenReelSocial@321618312/openreel@1348002581:environment:aws-dev',
                  'repo:OpenReelSocial/openreel:ref:refs/heads/main',
                  'repo:OpenReelSocial/openreel:environment:aws-dev',
                ],
              },
            },
          },
        ],
      },
    })
  })

  it('lets the deploy role run commands only through AWS-RunShellScript on the host', () => {
    const sendCommand = statements.find((s) => actionsOf(s).includes('ssm:SendCommand'))
    const resources = JSON.stringify(sendCommand?.Resource)
    expect(resources).toContain('document/AWS-RunShellScript')
    expect(resources).toContain(':instance/')
    expect(resources).not.toContain('"*"')
  })

  it('scopes host secret reads to the environment parameter path', () => {
    const read = statements.find((s) => actionsOf(s).includes('ssm:GetParametersByPath'))
    expect(JSON.stringify(read?.Resource)).toContain('parameter/openreel/dev/*')
  })
})

describe('media', () => {
  it('blocks all public access to the bucket', () => {
    dev.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
    })
  })

  it('lets only this CloudFront distribution read, over TLS', () => {
    dev.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
          Match.objectLike({
            Effect: 'Allow',
            Action: 's3:GetObject',
            Principal: { Service: 'cloudfront.amazonaws.com' },
            Condition: { StringEquals: { 'AWS:SourceArn': Match.anyValue() } },
          }),
        ]),
      },
    })
    dev.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1)
  })

  it('serves the media hostname over HTTPS only', () => {
    dev.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: [devConfig.mediaDomain],
        ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021' }),
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    })
  })

  it('keeps the bucket if the stack is deleted', () => {
    dev.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' })
  })

  it('validates the media certificate through DNS', () => {
    certificate.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: devConfig.mediaDomain,
      ValidationMethod: 'DNS',
    })
  })
})
