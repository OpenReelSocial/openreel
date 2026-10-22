import { Duration } from 'aws-cdk-lib'
import { CfnBudget } from 'aws-cdk-lib/aws-budgets'
import type { Distribution } from 'aws-cdk-lib/aws-cloudfront'
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  LogQueryWidget,
  Metric,
  SingleValueWidget,
  TextWidget,
  TreatMissingData,
  type IAlarmAction,
} from 'aws-cdk-lib/aws-cloudwatch'
import { Ec2Action, Ec2InstanceAction, SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'
import type { Instance } from 'aws-cdk-lib/aws-ec2'
import type { ILogGroup } from 'aws-cdk-lib/aws-logs'
import { HealthCheck, HealthCheckType } from 'aws-cdk-lib/aws-route53'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions'
import { Construct } from 'constructs'

import { resourceName, type EnvironmentConfig } from './config.ts'

/** Public endpoints probed from outside AWS, and what each one proves. */
export const healthProbes = [
  { id: 'Pds', name: 'PDS', path: '/xrpc/_health' },
  { id: 'AppView', name: 'AppView', path: '/appview/health' },
] as const

export interface MonitoringProps {
  readonly config: EnvironmentConfig
  readonly instance: Instance
  readonly distribution: Distribution
  readonly logGroup: ILogGroup
}

/**
 * Just enough monitoring for a demo environment (DEV-066): alarms on the
 * host, the public endpoints, and the CDN, emailed through one SNS topic; a
 * dashboard showing the same; and a budget alert.
 */
export class Monitoring extends Construct {
  readonly topic: Topic
  readonly alarms: Alarm[] = []
  readonly dashboard: Dashboard
  readonly #config: EnvironmentConfig

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id)
    const { config, instance, distribution, logGroup } = props
    this.#config = config

    this.topic = new Topic(this, 'Alerts', {
      topicName: resourceName(config, 'alerts'),
      displayName: `OpenReel ${config.name} alerts`,
    })
    if (config.alertEmail !== undefined) {
      this.topic.addSubscription(new EmailSubscription(config.alertEmail))
    }
    const notify = new SnsAction(this.topic)

    const instanceMetric = (namespace: string, metricName: string, statistic: string) =>
      new Metric({
        namespace,
        metricName,
        statistic,
        period: Duration.minutes(5),
        dimensionsMap: { InstanceId: instance.instanceId },
      })

    const cpu = instanceMetric('AWS/EC2', 'CPUUtilization', 'Average')
    const disk = instanceMetric('CWAgent', 'disk_used_percent', 'Maximum')
    const memory = instanceMetric('CWAgent', 'mem_used_percent', 'Average')

    // A stopped instance (between demos) reports nothing; that is not an outage.
    this.alarm('SystemStatus', [notify, new Ec2Action(Ec2InstanceAction.RECOVER)], {
      metric: instanceMetric('AWS/EC2', 'StatusCheckFailed_System', 'Maximum').with({
        period: Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      description: 'AWS hardware or network problem; the instance is recovered automatically',
    })
    this.alarm('InstanceStatus', [notify], {
      metric: instanceMetric('AWS/EC2', 'StatusCheckFailed_Instance', 'Maximum').with({
        period: Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 3,
      description: 'The OS is not responding; reboot the instance',
    })
    this.alarm('Cpu', [notify], {
      metric: cpu,
      threshold: 85,
      evaluationPeriods: 3,
      description: 'CPU above 85% for 15 minutes (transcoding backlog?)',
    })
    this.alarm('Disk', [notify], {
      metric: disk,
      threshold: 80,
      evaluationPeriods: 1,
      description: 'Root volume above 80%: prune images or grow the volume',
    })
    this.alarm('Memory', [notify], {
      metric: memory,
      threshold: 90,
      evaluationPeriods: 3,
      description: 'Memory above 90% for 15 minutes',
    })

    const healthMetrics: Metric[] = []
    for (const probe of healthProbes) {
      const check = new HealthCheck(this, `${probe.id}HealthCheck`, {
        type: HealthCheckType.HTTPS,
        fqdn: config.domain,
        port: 443,
        resourcePath: probe.path,
        enableSNI: true,
        requestInterval: Duration.seconds(30),
        failureThreshold: 3,
      })
      const status = new Metric({
        namespace: 'AWS/Route53',
        metricName: 'HealthCheckStatus',
        statistic: 'Minimum',
        period: Duration.minutes(1),
        dimensionsMap: { HealthCheckId: check.healthCheckId },
        label: probe.name,
      })
      healthMetrics.push(status)
      this.alarm(`${probe.id}Health`, [notify], {
        metric: status,
        threshold: 1,
        comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 2,
        description: `${probe.name} at https://${config.domain}${probe.path} is failing`,
      })
    }

    const errorRate = distribution.metric5xxErrorRate({ period: Duration.minutes(5) })
    this.alarm('Media5xx', [notify], {
      metric: errorRate,
      threshold: 5,
      evaluationPeriods: 3,
      description: 'More than 5% of media requests failing at CloudFront',
    })

    this.dashboard = new Dashboard(this, 'Dashboard', {
      dashboardName: resourceName(config, 'overview'),
      widgets: [
        [
          new TextWidget({
            markdown: `# OpenReel ${config.name}\nhttps://${config.domain} · media https://${config.mediaDomain}`,
            width: 24,
            height: 2,
          }),
        ],
        [
          new SingleValueWidget({
            title: 'Endpoint health (1 = up)',
            metrics: healthMetrics,
            width: 8,
          }),
          new GraphWidget({ title: 'Host CPU %', left: [cpu], width: 8 }),
          new GraphWidget({ title: 'Disk and memory %', left: [disk, memory], width: 8 }),
        ],
        [
          new GraphWidget({
            title: 'Media requests (CloudFront)',
            left: [distribution.metricRequests({ period: Duration.minutes(5) })],
            right: [distribution.metricBytesDownloaded({ period: Duration.minutes(5) })],
            width: 12,
          }),
          new GraphWidget({ title: 'Media 5xx error rate %', left: [errorRate], width: 12 }),
        ],
        [
          new LogQueryWidget({
            title: 'Recent errors across containers',
            logGroupNames: [logGroup.logGroupName],
            queryLines: [
              'fields @timestamp, @logStream, @message',
              'filter @message like /(?i)(error|fatal|exception)/',
              'sort @timestamp desc',
              'limit 50',
            ],
            width: 24,
            height: 8,
          }),
        ],
      ],
    })

    if (config.alertEmail !== undefined) {
      new CfnBudget(this, 'Budget', {
        budget: {
          budgetName: resourceName(config, 'monthly'),
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: config.monthlyBudgetUsd, unit: 'USD' },
        },
        notificationsWithSubscribers: [
          { type: 'ACTUAL', threshold: 50 },
          { type: 'ACTUAL', threshold: 100 },
          { type: 'FORECASTED', threshold: 100 },
        ].map(({ type, threshold }) => ({
          notification: {
            notificationType: type,
            comparisonOperator: 'GREATER_THAN',
            threshold,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: config.alertEmail! }],
        })),
      })
    }
  }

  private alarm(
    id: string,
    actions: IAlarmAction[],
    props: {
      metric: Metric
      threshold: number
      evaluationPeriods: number
      description: string
      comparisonOperator?: ComparisonOperator
    },
  ): void {
    const alarm = new Alarm(this, `${id}Alarm`, {
      alarmName: resourceName(this.#config, kebab(id)),
      metric: props.metric,
      threshold: props.threshold,
      evaluationPeriods: props.evaluationPeriods,
      comparisonOperator:
        props.comparisonOperator ?? ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmDescription: props.description,
    })
    alarm.addAlarmAction(...actions)
    this.alarms.push(alarm)
  }
}

/** `AppViewHealth` -> `app-view-health`, for alarm names. */
function kebab(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}
