#!/usr/bin/env node
// CDK entrypoint, run by `cdk` through cdk.json. See infra/README.md.
import { App } from 'aws-cdk-lib'

import { addStacks } from '../lib/app.ts'
import { devConfig } from '../lib/config.ts'

const app = new App()
addStacks(app, devConfig)
app.synth()
