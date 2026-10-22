import { Match } from 'aws-cdk-lib/assertions'
import { describe, expect, it } from 'vitest'

import { devConfig } from '../lib/config.ts'
import { healthProbes } from '../lib/monitoring.ts'
import { synthesize } from './support.ts'

describe('monitoring', () => {
  const { dev } = synthesize()

  it('alarms on the host, each public endpoint, and media errors', () => {
    const names = Object.values(dev.findResources('AWS::CloudWatch::Alarm'))
      .map((alarm) => (alarm as { Properties: { AlarmName: string } }).Properties.AlarmName)
      .sort()
    expect(names).toEqual(
      [
        'openreel-dev-app-view-health',
        'openreel-dev-cpu',
        'openreel-dev-disk',
        'openreel-dev-instance-status',
        'openreel-dev-media5xx',
        'openreel-dev-memory',
        'openreel-dev-pds-health',
        'openreel-dev-system-status',
      ].sort(),
    )
  })

  it('notifies the alerts topic from every alarm', () => {
    for (const alarm of Object.values(dev.findResources('AWS::CloudWatch::Alarm'))) {
      expect(JSON.stringify(alarm)).toContain('MonitoringAlerts')
    }
  })

  it('recovers the instance automatically on a system status failure', () => {
    const [alarm] = Object.values(
      dev.findResources('AWS::CloudWatch::Alarm', {
        Properties: { AlarmName: 'openreel-dev-system-status' },
      }),
    )
    // The action ARN is an Fn::Join over the partition and region.
    expect(JSON.stringify(alarm)).toMatch(/:automate:.*:ec2:recover/)
  })

  it('probes every public endpoint over HTTPS', () => {
    dev.resourceCountIs('AWS::Route53::HealthCheck', healthProbes.length)
    for (const probe of healthProbes) {
      dev.hasResourceProperties('AWS::Route53::HealthCheck', {
        HealthCheckConfig: Match.objectLike({
          Type: 'HTTPS',
          FullyQualifiedDomainName: devConfig.domain,
          ResourcePath: probe.path,
        }),
      })
    }
  })

  it('keeps container logs for two weeks', () => {
    dev.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/openreel/dev/containers',
      RetentionInDays: 14,
    })
  })

  it('has a dashboard', () => {
    dev.hasResourceProperties('AWS::CloudWatch::Dashboard', {
      DashboardName: 'openreel-dev-overview',
    })
  })

  it('subscribes no email and creates no budget unless an address is given', () => {
    dev.resourceCountIs('AWS::SNS::Subscription', 0)
    dev.resourceCountIs('AWS::Budgets::Budget', 0)
  })

  it('emails alarms and budget alerts when an address is given', () => {
    const { dev: withEmail } = synthesize({ alertEmail: 'alerts@example.com' })
    withEmail.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'alerts@example.com',
    })
    withEmail.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({
        BudgetLimit: { Amount: devConfig.monthlyBudgetUsd, Unit: 'USD' },
      }),
    })
  })
})
