#!/usr/bin/env node
// CDK entrypoint, run by `cdk` through cdk.json. See infra/README.md.
import { App } from 'aws-cdk-lib'

import { addStacks } from '../lib/app.ts'
import { devConfig } from '../lib/config.ts'

const app = new App()
const alertEmail: unknown = app.node.tryGetContext('alertEmail')
addStacks(app, {
  ...devConfig,
  alertEmail: typeof alertEmail === 'string' && alertEmail !== '' ? alertEmail : undefined,
})
app.synth()
