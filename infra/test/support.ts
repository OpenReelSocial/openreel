import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'

import { addStacks } from '../lib/app.ts'
import { devConfig, type EnvironmentConfig } from '../lib/config.ts'

export const testAccount = '123456789012'

/** Synthesizes the app as `cdk deploy` would and returns both templates. */
export function synthesize(overrides: Partial<EnvironmentConfig> = {}) {
  const app = new App()
  const stacks = addStacks(app, { ...devConfig, account: testAccount, ...overrides })
  return {
    stacks,
    dev: Template.fromStack(stacks.dev),
    certificate: Template.fromStack(stacks.certificate),
  }
}

interface Statement {
  Effect: string
  Action: string | string[]
  Resource: unknown
  Condition?: Record<string, Record<string, unknown>>
}

/** Every Allow statement in the stack's inline IAM policies. */
export function allowStatements(template: Template): Statement[] {
  return Object.values(template.findResources('AWS::IAM::Policy'))
    .flatMap(
      (policy) =>
        (policy as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties
          .PolicyDocument.Statement,
    )
    .filter((statement) => statement.Effect === 'Allow')
}

export function actionsOf(statement: Statement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action]
}
