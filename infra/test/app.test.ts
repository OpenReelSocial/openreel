import { App } from 'aws-cdk-lib'
import { describe, expect, it } from 'vitest'

import { addStacks } from '../lib/app.ts'
import { devConfig, resourceName, standardTags } from '../lib/config.ts'

describe('CDK app', () => {
  it('synthesizes the dev stack in us-east-1 with termination protection', () => {
    const app = new App()
    const { dev } = addStacks(app, { ...devConfig, account: '123456789012' })
    const assembly = app.synth()
    const stack = assembly.getStackByName(dev.stackName)

    expect(stack.environment.region).toBe('us-east-1')
    expect(stack.environment.account).toBe('123456789012')
    expect(stack.terminationProtection).toBe(true)
  })

  it('synthesizes without an account, as CI does', () => {
    const app = new App()
    addStacks(app, { ...devConfig, account: undefined })
    expect(() => app.synth()).not.toThrow()
  })

  it('tags every stack with the standard tags', () => {
    const app = new App()
    const { dev } = addStacks(app, devConfig)
    app.synth()

    expect(dev.tags.tagValues()).toEqual(standardTags(devConfig))
  })
})

describe('resourceName', () => {
  it('prefixes names with the project and environment', () => {
    expect(resourceName(devConfig, 'media')).toBe('openreel-dev-media')
  })

  it('rejects names AWS would mangle or refuse', () => {
    expect(() => resourceName(devConfig, 'Media_Bucket')).toThrow(/lowercase/)
  })
})
