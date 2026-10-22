import { RemovalPolicy } from 'aws-cdk-lib'
import type { ICertificate } from 'aws-cdk-lib/aws-certificatemanager'
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront'
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'
import type { IGrantable } from 'aws-cdk-lib/aws-iam'
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'

import type { EnvironmentConfig } from './config.ts'

export interface MediaProps {
  readonly config: EnvironmentConfig
  /** ACM certificate for `config.mediaDomain`, in us-east-1. */
  readonly certificate: ICertificate
}

/**
 * HLS renditions (ADR-0006, ADR-0007): a private bucket the media worker
 * writes to, served only through CloudFront. Keys are `<did>/<cid>/...` and
 * never change once written, so everything is cached for as long as
 * CloudFront allows.
 */
export class Media extends Construct {
  readonly bucket: Bucket
  readonly distribution: Distribution

  constructor(scope: Construct, id: string, props: MediaProps) {
    super(scope, id)
    const { config, certificate } = props

    this.bucket = new Bucket(this, 'Bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Renditions can be regenerated from PDS blobs, but losing them takes
      // every video out of the feed until then.
      removalPolicy: RemovalPolicy.RETAIN,
    })

    this.distribution = new Distribution(this, 'Distribution', {
      comment: `OpenReel ${config.name} media`,
      domainNames: [config.mediaDomain],
      certificate,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: HttpVersion.HTTP2_AND_3,
      // North America and Europe edges: the cheapest class covers the demo.
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        // Lets browser players (hls.js) fetch playlists cross-origin.
        responseHeadersPolicy: ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
        compress: true,
      },
    })
  }

  /** What the media worker needs: write, replace, and remove renditions. */
  grantPublish(grantee: IGrantable): void {
    this.bucket.grantReadWrite(grantee)
    this.bucket.grantDelete(grantee)
  }
}
