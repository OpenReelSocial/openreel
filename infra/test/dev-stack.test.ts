import { App } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { beforeAll, describe, expect, it } from 'vitest'

import { addStacks } from '../lib/app.ts'
import { devConfig } from '../lib/config.ts'
import { serviceImages } from '../lib/dev-stack.ts'

let template: Template

beforeAll(() => {
  const app = new App()
  const { dev } = addStacks(app, { ...devConfig, account: '123456789012' })
  template = Template.fromStack(dev)
})

describe('ECR repositories', () => {
  it('has one repository per service image, named by convention', () => {
    template.resourceCountIs('AWS::ECR::Repository', serviceImages.length)
    for (const image of serviceImages) {
      template.hasResourceProperties('AWS::ECR::Repository', {
        RepositoryName: `openreel-dev-${image}`,
      })
    }
  })

  it('scans every image on push', () => {
    const repositories = template.findResources('AWS::ECR::Repository')
    for (const repository of Object.values(repositories)) {
      expect(repository).toMatchObject({
        Properties: { ImageScanningConfiguration: { ScanOnPush: true } },
      })
    }
  })

  it('caps how many images each repository keeps', () => {
    template.allResourcesProperties('AWS::ECR::Repository', {
      LifecyclePolicy: {
        LifecyclePolicyText: Match.stringLikeRegexp('"countNumber":20'),
      },
    })
  })

  it('keeps repositories if the stack is deleted', () => {
    const repositories = template.findResources('AWS::ECR::Repository')
    for (const repository of Object.values(repositories)) {
      expect(repository).toMatchObject({ DeletionPolicy: 'Retain' })
    }
  })
})
