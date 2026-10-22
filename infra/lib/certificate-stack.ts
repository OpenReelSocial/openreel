import { Stack, type StackProps } from 'aws-cdk-lib'
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager'
import type { Construct } from 'constructs'

import type { EnvironmentConfig } from './config.ts'

export interface CertificateStackProps extends StackProps {
  readonly config: EnvironmentConfig
}

/**
 * The CloudFront certificate for the media hostname, in its own stack. DNS
 * lives in Cloudflare (ADR-0007), so ACM cannot write its validation record:
 * deploy this stack first, copy the CNAME that the ACM console shows into
 * Cloudflare, and the stack finishes once ACM sees it. The main stack then
 * deploys without waiting on DNS.
 */
export class CertificateStack extends Stack {
  readonly mediaCertificate: Certificate

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, props)
    this.mediaCertificate = new Certificate(this, 'MediaCertificate', {
      domainName: props.config.mediaDomain,
      validation: CertificateValidation.fromDns(),
    })
  }
}
