import { Duration, RemovalPolicy } from 'aws-cdk-lib'
import type { IGrantable } from 'aws-cdk-lib/aws-iam'
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'

/** How long a backup is kept, including versions replaced or deleted since. */
export const backupRetentionDays = 30

/**
 * Backups of the host's stateful data (#111): the PDS data volume and dumps of
 * the AppView and PLC databases, written by infra/aws/scripts/backup.sh under
 * one timestamped prefix per run. Private and versioned, so the host can add
 * backups but not destroy them.
 */
export class Backups extends Construct {
  readonly bucket: Bucket

  constructor(scope: Construct, id: string) {
    super(scope, id)

    this.bucket = new Bucket(this, 'Bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      lifecycleRules: [
        {
          expiration: Duration.days(backupRetentionDays),
          noncurrentVersionExpiration: Duration.days(backupRetentionDays),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      // The only copy of every account if the host is lost.
      removalPolicy: RemovalPolicy.RETAIN,
    })
  }

  /** What the host needs to take and restore backups: no deletes. */
  grantBackupAndRestore(grantee: IGrantable): void {
    this.bucket.grantPut(grantee)
    this.bucket.grantRead(grantee)
  }
}
