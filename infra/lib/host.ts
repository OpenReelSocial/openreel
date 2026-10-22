import { Stack, Validations } from 'aws-cdk-lib'
import {
  BlockDeviceVolume,
  CfnEIP,
  CfnEIPAssociation,
  EbsDeviceVolumeType,
  Instance,
  InstanceType,
  MachineImage,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  UserData,
  Vpc,
} from 'aws-cdk-lib/aws-ec2'
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import type { ILogGroup } from 'aws-cdk-lib/aws-logs'
import { Construct } from 'constructs'

import { resourceName, type EnvironmentConfig } from './config.ts'

/** Where the deploy puts compose.yaml and .env on the host. */
export const hostDeployDir = '/srv/openreel'

/** SSM Parameter Store path the host reads its secrets from (ADR-0007). */
export function parameterPath(config: EnvironmentConfig): string {
  return `/openreel/${config.name}/`
}

export interface HostProps {
  readonly config: EnvironmentConfig
  /** Every container's stdout/stderr, via Docker's awslogs driver. */
  readonly logGroup: ILogGroup
}

/**
 * The single EC2 host that runs the Compose stack (ADR-0007): a public subnet
 * with an Elastic IP, HTTP and HTTPS only, reached by operators and the
 * deploy workflow through SSM rather than SSH.
 */
export class Host extends Construct {
  readonly instance: Instance
  readonly role: Role
  readonly securityGroup: SecurityGroup
  readonly elasticIp: CfnEIP

  constructor(scope: Construct, id: string, props: HostProps) {
    super(scope, id)
    const { config, logGroup } = props
    const stack = Stack.of(this)

    // Public subnets only: a NAT gateway would cost more than the instance.
    const vpc = new Vpc(this, 'Vpc', {
      vpcName: resourceName(config, 'vpc'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 }],
    })

    this.securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc,
      securityGroupName: resourceName(config, 'host'),
      description: 'OpenReel host: HTTP for ACME challenges, HTTPS for clients',
      allowAllOutbound: true,
    })
    this.securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80), 'HTTP (redirect, ACME)')
    this.securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(443), 'HTTPS')

    this.role = new Role(this, 'Role', {
      roleName: resourceName(config, 'host'),
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      description: 'OpenReel host: pull images, write media and logs, read its secrets',
    })
    // Secrets under /openreel/<env>/; SecureStrings use the AWS-managed
    // aws/ssm key, whose key policy already allows decryption through SSM.
    this.role.addToPolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
        resources: [
          stack.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: parameterPath(config).slice(1) + '*',
          }),
          stack.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: parameterPath(config).slice(1, -1),
          }),
        ],
      }),
    )
    logGroup.grantWrite(this.role)
    // The CloudWatch agent's disk and memory metrics. PutMetricData has no
    // resource-level permissions, so the namespace condition is the limit.
    this.role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': 'CWAgent' } },
      }),
    )

    this.instance = new Instance(this, 'Instance', {
      instanceName: resourceName(config, 'host'),
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      instanceType: new InstanceType(config.instanceType),
      machineImage: MachineImage.genericLinux({ [config.region]: config.hostAmi }),
      securityGroup: this.securityGroup,
      role: this.role,
      requireImdsv2: true,
      ssmSessionPermissions: true,
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: BlockDeviceVolume.ebs(config.hostVolumeGiB, {
            volumeType: EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      userData: hostUserData(stack.region, logGroup.logGroupName),
    })

    Validations.of(this.instance).acknowledge({
      id: 'CloudFormation-Validate::W9010',
      reason: 'The AMI is pinned on purpose: a new one replaces the instance and its data',
    })

    this.elasticIp = new CfnEIP(this, 'ElasticIp', {
      tags: [{ key: 'Name', value: resourceName(config, 'host') }],
    })
    new CfnEIPAssociation(this, 'ElasticIpAssociation', {
      allocationId: this.elasticIp.attrAllocationId,
      instanceId: this.instance.instanceId,
    })
  }
}

/**
 * First-boot setup only: packages, Docker logging to CloudWatch, and the
 * CloudWatch agent. Everything that changes per release (compose.yaml, .env,
 * nginx site, images) arrives through the deploy workflow over SSM, so this
 * script rarely changes. Editing it does not re-run it on the existing host.
 */
function hostUserData(region: string, logGroupName: string): UserData {
  const userData = UserData.forLinux()
  const dockerDaemon = JSON.stringify({
    'log-driver': 'awslogs',
    'log-opts': {
      'awslogs-region': region,
      'awslogs-group': logGroupName,
      // One stream per container, named like `openreel-appview-1`.
      tag: '{{.Name}}',
      mode: 'non-blocking',
    },
  })
  const cloudWatchAgent = JSON.stringify({
    metrics: {
      append_dimensions: { InstanceId: '${aws:InstanceId}' },
      aggregation_dimensions: [['InstanceId']],
      metrics_collected: {
        disk: { resources: ['/'], measurement: ['used_percent'], drop_device: true },
        mem: { measurement: ['used_percent'] },
      },
    },
  })
  userData.addCommands(
    'set -euxo pipefail',
    'export DEBIAN_FRONTEND=noninteractive',
    'apt-get update',
    'apt-get install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx unzip jq',
    // AWS CLI v2: ECR login and SSM parameter reads during deploys.
    'curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip',
    'unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install',
    'curl -fsSL https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb -o /tmp/cwagent.deb',
    'dpkg -i /tmp/cwagent.deb',
    `cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<'EOF'\n${cloudWatchAgent}\nEOF`,
    '/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json',
    'mkdir -p /etc/docker',
    `cat > /etc/docker/daemon.json <<'EOF'\n${dockerDaemon}\nEOF`,
    'systemctl enable docker',
    'systemctl restart docker',
    `install -d -m 700 ${hostDeployDir}`,
  )
  return userData
}
