/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  type LexiconDoc,
  Lexicons,
  ValidationError,
  type ValidationResult,
} from '@atproto/lexicon'
import { type $Typed, is$typed, maybe$typed } from './util.js'

export const schemaDict = {
  ComAtprotoLabelDefs: {
    lexicon: 1,
    id: 'com.atproto.label.defs',
    defs: {
      label: {
        type: 'object',
        description:
          'Metadata tag on an atproto resource (eg, repo or record).',
        required: ['src', 'uri', 'val', 'cts'],
        properties: {
          ver: {
            type: 'integer',
            description: 'The AT Protocol version of the label object.',
          },
          src: {
            type: 'string',
            format: 'did',
            description: 'DID of the actor who created this label.',
          },
          uri: {
            type: 'string',
            format: 'uri',
            description:
              'AT URI of the record, repository (account), or other resource that this label applies to.',
          },
          cid: {
            type: 'string',
            format: 'cid',
            description:
              "Optionally, CID specifying the specific version of 'uri' resource this label applies to.",
          },
          val: {
            type: 'string',
            maxLength: 128,
            description:
              'The short string name of the value or type of this label.',
          },
          neg: {
            type: 'boolean',
            description:
              'If true, this is a negation label, overwriting a previous label.',
          },
          cts: {
            type: 'string',
            format: 'datetime',
            description: 'Timestamp when this label was created.',
          },
          exp: {
            type: 'string',
            format: 'datetime',
            description:
              'Timestamp at which this label expires (no longer applies).',
          },
          sig: {
            type: 'bytes',
            description: 'Signature of dag-cbor encoded label.',
          },
        },
      },
      selfLabels: {
        type: 'object',
        description:
          'Metadata tags on an atproto record, published by the author within the record.',
        required: ['values'],
        properties: {
          values: {
            type: 'array',
            items: {
              type: 'ref',
              ref: 'lex:com.atproto.label.defs#selfLabel',
            },
            maxLength: 10,
          },
        },
      },
      selfLabel: {
        type: 'object',
        description:
          'Metadata tag on an atproto record, published by the author within the record. Note that schemas should use #selfLabels, not #selfLabel.',
        required: ['val'],
        properties: {
          val: {
            type: 'string',
            maxLength: 128,
            description:
              'The short string name of the value or type of this label.',
          },
        },
      },
      labelValueDefinition: {
        type: 'object',
        description:
          'Declares a label value and its expected interpretations and behaviors.',
        required: ['identifier', 'severity', 'blurs', 'locales'],
        properties: {
          identifier: {
            type: 'string',
            description:
              "The value of the label being defined. Must only include lowercase ascii and the '-' character ([a-z-]+).",
            maxLength: 100,
            maxGraphemes: 100,
          },
          severity: {
            type: 'string',
            description:
              "How should a client visually convey this label? 'inform' means neutral and informational; 'alert' means negative and warning; 'none' means show nothing.",
            knownValues: ['inform', 'alert', 'none'],
          },
          blurs: {
            type: 'string',
            description:
              "What should this label hide in the UI, if applied? 'content' hides all of the target; 'media' hides the images/video/audio; 'none' hides nothing.",
            knownValues: ['content', 'media', 'none'],
          },
          defaultSetting: {
            type: 'string',
            description: 'The default setting for this label.',
            knownValues: ['ignore', 'warn', 'hide'],
            default: 'warn',
          },
          adultOnly: {
            type: 'boolean',
            description:
              'Does the user need to have adult content enabled in order to configure this label?',
          },
          locales: {
            type: 'array',
            items: {
              type: 'ref',
              ref: 'lex:com.atproto.label.defs#labelValueDefinitionStrings',
            },
          },
        },
      },
      labelValueDefinitionStrings: {
        type: 'object',
        description:
          'Strings which describe the label in the UI, localized into a specific language.',
        required: ['lang', 'name', 'description'],
        properties: {
          lang: {
            type: 'string',
            description:
              'The code of the language these strings are written in.',
            format: 'language',
          },
          name: {
            type: 'string',
            description: 'A short human-readable name for the label.',
            maxGraphemes: 64,
            maxLength: 640,
          },
          description: {
            type: 'string',
            description:
              'A longer description of what the label means and why it might be applied.',
            maxGraphemes: 10000,
            maxLength: 100000,
          },
        },
      },
      labelValue: {
        type: 'string',
        knownValues: [
          '!hide',
          '!warn',
          '!no-unauthenticated',
          'porn',
          'sexual',
          'nudity',
          'graphic-media',
          'bot',
        ],
      },
    },
  },
  ComAtprotoRepoCreateRecord: {
    lexicon: 1,
    id: 'com.atproto.repo.createRecord',
    defs: {
      main: {
        type: 'procedure',
        description:
          'Create a single new repository record. Requires auth, implemented by PDS.',
        input: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['repo', 'collection', 'record'],
            properties: {
              repo: {
                type: 'string',
                format: 'at-identifier',
                description:
                  'The handle or DID of the repo (aka, current account).',
              },
              collection: {
                type: 'string',
                format: 'nsid',
                description: 'The NSID of the record collection.',
              },
              rkey: {
                type: 'string',
                format: 'record-key',
                description: 'The Record Key.',
                maxLength: 512,
              },
              validate: {
                type: 'boolean',
                description:
                  "Can be set to 'false' to skip Lexicon schema validation of record data, 'true' to require it, or leave unset to validate only for known Lexicons.",
              },
              record: {
                type: 'unknown',
                description: 'The record itself. Must contain a $type field.',
              },
              swapCommit: {
                type: 'string',
                format: 'cid',
                description:
                  'Compare and swap with the previous commit by CID.',
              },
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['uri', 'cid'],
            properties: {
              uri: {
                type: 'string',
                format: 'at-uri',
              },
              cid: {
                type: 'string',
                format: 'cid',
              },
              commit: {
                type: 'ref',
                ref: 'lex:com.atproto.repo.defs#commitMeta',
              },
              validationStatus: {
                type: 'string',
                knownValues: ['valid', 'unknown'],
              },
            },
          },
        },
        errors: [
          {
            name: 'InvalidSwap',
            description:
              "Indicates that 'swapCommit' didn't match current repo commit.",
          },
        ],
      },
    },
  },
  ComAtprotoRepoDefs: {
    lexicon: 1,
    id: 'com.atproto.repo.defs',
    defs: {
      commitMeta: {
        type: 'object',
        required: ['cid', 'rev'],
        properties: {
          cid: {
            type: 'string',
            format: 'cid',
          },
          rev: {
            type: 'string',
            format: 'tid',
          },
        },
      },
    },
  },
  ComAtprotoRepoDeleteRecord: {
    lexicon: 1,
    id: 'com.atproto.repo.deleteRecord',
    defs: {
      main: {
        type: 'procedure',
        description:
          "Delete a repository record, or ensure it doesn't exist. Requires auth, implemented by PDS.",
        input: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['repo', 'collection', 'rkey'],
            properties: {
              repo: {
                type: 'string',
                format: 'at-identifier',
                description:
                  'The handle or DID of the repo (aka, current account).',
              },
              collection: {
                type: 'string',
                format: 'nsid',
                description: 'The NSID of the record collection.',
              },
              rkey: {
                type: 'string',
                format: 'record-key',
                description: 'The Record Key.',
              },
              swapRecord: {
                type: 'string',
                format: 'cid',
                description:
                  'Compare and swap with the previous record by CID.',
              },
              swapCommit: {
                type: 'string',
                format: 'cid',
                description:
                  'Compare and swap with the previous commit by CID.',
              },
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            properties: {
              commit: {
                type: 'ref',
                ref: 'lex:com.atproto.repo.defs#commitMeta',
              },
            },
          },
        },
        errors: [
          {
            name: 'InvalidSwap',
          },
        ],
      },
    },
  },
  ComAtprotoRepoGetRecord: {
    lexicon: 1,
    id: 'com.atproto.repo.getRecord',
    defs: {
      main: {
        type: 'query',
        description:
          'Get a single record from a repository. Does not require auth.',
        parameters: {
          type: 'params',
          required: ['repo', 'collection', 'rkey'],
          properties: {
            repo: {
              type: 'string',
              format: 'at-identifier',
              description: 'The handle or DID of the repo.',
            },
            collection: {
              type: 'string',
              format: 'nsid',
              description: 'The NSID of the record collection.',
            },
            rkey: {
              type: 'string',
              description: 'The Record Key.',
              format: 'record-key',
            },
            cid: {
              type: 'string',
              format: 'cid',
              description:
                'The CID of the version of the record. If not specified, then return the most recent version.',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['uri', 'value'],
            properties: {
              uri: {
                type: 'string',
                format: 'at-uri',
              },
              cid: {
                type: 'string',
                format: 'cid',
              },
              value: {
                type: 'unknown',
              },
            },
          },
        },
        errors: [
          {
            name: 'RecordNotFound',
          },
        ],
      },
    },
  },
  ComAtprotoRepoListRecords: {
    lexicon: 1,
    id: 'com.atproto.repo.listRecords',
    defs: {
      main: {
        type: 'query',
        description:
          'List a range of records in a repository, matching a specific collection. Does not require auth.',
        parameters: {
          type: 'params',
          required: ['repo', 'collection'],
          properties: {
            repo: {
              type: 'string',
              format: 'at-identifier',
              description: 'The handle or DID of the repo.',
            },
            collection: {
              type: 'string',
              format: 'nsid',
              description: 'The NSID of the record type.',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
              description: 'The number of records to return.',
            },
            cursor: {
              type: 'string',
            },
            reverse: {
              type: 'boolean',
              description: 'Flag to reverse the order of the returned records.',
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['records'],
            properties: {
              cursor: {
                type: 'string',
              },
              records: {
                type: 'array',
                items: {
                  type: 'ref',
                  ref: 'lex:com.atproto.repo.listRecords#record',
                },
              },
            },
          },
        },
      },
      record: {
        type: 'object',
        required: ['uri', 'cid', 'value'],
        properties: {
          uri: {
            type: 'string',
            format: 'at-uri',
          },
          cid: {
            type: 'string',
            format: 'cid',
          },
          value: {
            type: 'unknown',
          },
        },
      },
    },
  },
  ComAtprotoRepoPutRecord: {
    lexicon: 1,
    id: 'com.atproto.repo.putRecord',
    defs: {
      main: {
        type: 'procedure',
        description:
          'Write a repository record, creating or updating it as needed. Requires auth, implemented by PDS.',
        input: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['repo', 'collection', 'rkey', 'record'],
            nullable: ['swapRecord'],
            properties: {
              repo: {
                type: 'string',
                format: 'at-identifier',
                description:
                  'The handle or DID of the repo (aka, current account).',
              },
              collection: {
                type: 'string',
                format: 'nsid',
                description: 'The NSID of the record collection.',
              },
              rkey: {
                type: 'string',
                format: 'record-key',
                description: 'The Record Key.',
                maxLength: 512,
              },
              validate: {
                type: 'boolean',
                description:
                  "Can be set to 'false' to skip Lexicon schema validation of record data, 'true' to require it, or leave unset to validate only for known Lexicons.",
              },
              record: {
                type: 'unknown',
                description: 'The record to write.',
              },
              swapRecord: {
                type: 'string',
                format: 'cid',
                description:
                  'Compare and swap with the previous record by CID. WARNING: nullable and optional field; may cause problems with golang implementation',
              },
              swapCommit: {
                type: 'string',
                format: 'cid',
                description:
                  'Compare and swap with the previous commit by CID.',
              },
            },
          },
        },
        output: {
          encoding: 'application/json',
          schema: {
            type: 'object',
            required: ['uri', 'cid'],
            properties: {
              uri: {
                type: 'string',
                format: 'at-uri',
              },
              cid: {
                type: 'string',
                format: 'cid',
              },
              commit: {
                type: 'ref',
                ref: 'lex:com.atproto.repo.defs#commitMeta',
              },
              validationStatus: {
                type: 'string',
                knownValues: ['valid', 'unknown'],
              },
            },
          },
        },
        errors: [
          {
            name: 'InvalidSwap',
          },
        ],
      },
    },
  },
  ComAtprotoRepoStrongRef: {
    lexicon: 1,
    id: 'com.atproto.repo.strongRef',
    description: 'A URI with a content-hash fingerprint.',
    defs: {
      main: {
        type: 'object',
        required: ['uri', 'cid'],
        properties: {
          uri: {
            type: 'string',
            format: 'at-uri',
          },
          cid: {
            type: 'string',
            format: 'cid',
          },
        },
      },
    },
  },
  SocialOpenreelEngagementCompletionRate: {
    lexicon: 1,
    id: 'social.openreel.engagement.completionRate',
    defs: {
      main: {
        type: 'object',
        description:
          'Anonymized aggregate engagement for one video, computed by an indexing service from many watch events and published to feed generators. This is a derived value returned by services, not a record stored in user repositories. Lexicon has no floating-point type, so ratios are expressed in basis points (1/100 of a percent, 0-10000).',
        required: [
          'subject',
          'totalViews',
          'avgCompletionRateBps',
          'computedAt',
        ],
        properties: {
          subject: {
            type: 'string',
            description:
              'AT-URI of the social.openreel.video.post the aggregate describes.',
            format: 'at-uri',
          },
          totalViews: {
            type: 'integer',
            description:
              'Number of watch events included in the aggregate. Publishers should withhold aggregates below their anonymity threshold.',
            minimum: 0,
          },
          avgCompletionRateBps: {
            type: 'integer',
            description:
              'Mean of min(watchDurationMs / videoDurationMs, 1) across included watch events, in basis points.',
            minimum: 0,
            maximum: 10000,
          },
          likeRatioBps: {
            type: 'integer',
            description: 'Likes divided by totalViews, in basis points.',
            minimum: 0,
            maximum: 10000,
          },
          computedAt: {
            type: 'string',
            description: 'When the aggregate was computed.',
            format: 'datetime',
          },
        },
      },
    },
  },
  SocialOpenreelEngagementWatchEvent: {
    lexicon: 1,
    id: 'social.openreel.engagement.watchEvent',
    defs: {
      main: {
        type: 'record',
        description:
          "A single watch session of one video by the repository owner. Written to the viewer's own repository so the viewer retains ownership of their engagement history. Records in a public repository are readable by anyone; clients must only write watch events the viewer has consented to publish.",
        key: 'tid',
        record: {
          type: 'object',
          required: [
            'subject',
            'watchDurationMs',
            'videoDurationMs',
            'createdAt',
          ],
          properties: {
            subject: {
              type: 'ref',
              description:
                'The social.openreel.video.post that was watched, pinned to the version seen.',
              ref: 'lex:com.atproto.repo.strongRef',
            },
            watchDurationMs: {
              type: 'integer',
              description:
                'Total milliseconds of playback across the session, including any rewatches. May exceed videoDurationMs.',
              minimum: 0,
            },
            videoDurationMs: {
              type: 'integer',
              description:
                'Duration of the video in milliseconds at the time it was watched, so completion can be derived without hydrating the post.',
              minimum: 1,
            },
            soundEnabled: {
              type: 'boolean',
              description:
                'Whether audio was unmuted for at least part of the session.',
            },
            rewatchCount: {
              type: 'integer',
              description:
                'Number of times playback looped or was restarted within the session. Zero for a single pass.',
              minimum: 0,
            },
            context: {
              type: 'string',
              description: 'Surface the video was watched from.',
              knownValues: ['feed', 'profile', 'search', 'direct'],
            },
            createdAt: {
              type: 'string',
              description:
                'Client-declared timestamp when the watch session ended.',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  SocialOpenreelFeedGenerator: {
    lexicon: 1,
    id: 'social.openreel.feed.generator',
    defs: {
      main: {
        type: 'record',
        description:
          'Declares a video feed generator and the ranking approach it uses, so clients can present user-selectable feeds with their method disclosed. The record can exist in any repository; its AT-URI is the feed URI passed to getFeedSkeleton.',
        key: 'any',
        record: {
          type: 'object',
          required: ['did', 'displayName', 'rankingCriteria', 'createdAt'],
          properties: {
            did: {
              type: 'string',
              description: 'DID of the service that serves this feed.',
              format: 'did',
            },
            displayName: {
              type: 'string',
              maxGraphemes: 24,
              maxLength: 240,
            },
            description: {
              type: 'string',
              maxGraphemes: 300,
              maxLength: 3000,
            },
            avatar: {
              type: 'blob',
              accept: ['image/png', 'image/jpeg'],
              maxSize: 1000000,
            },
            rankingCriteria: {
              type: 'string',
              description:
                "Self-declared family of ranking method. 'chronological' and 'heuristic' use no individual data; 'social' uses the public follow graph; 'personalized' and 'collaborative' require opted-in engagement data; 'hybrid' combines families.",
              knownValues: [
                'chronological',
                'heuristic',
                'social',
                'personalized',
                'collaborative',
                'hybrid',
              ],
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
            },
          },
        },
      },
    },
  },
  SocialOpenreelVideoPost: {
    lexicon: 1,
    id: 'social.openreel.video.post',
    defs: {
      main: {
        type: 'record',
        description:
          'A short-form video post. The record holds portable canonical metadata and a reference to the uploaded video blob; transcoded renditions (HLS) are derived by the media pipeline and are not part of the record.',
        key: 'tid',
        record: {
          type: 'object',
          required: ['video', 'durationMs', 'createdAt'],
          properties: {
            video: {
              type: 'blob',
              description: 'The source video as uploaded by the author.',
              accept: ['video/*'],
              maxSize: 100000000,
            },
            caption: {
              type: 'string',
              description: 'Author-written caption shown with the video.',
              maxGraphemes: 300,
              maxLength: 3000,
            },
            tags: {
              type: 'array',
              description:
                "Hashtags without the leading '#', used for discovery.",
              maxLength: 8,
              items: {
                type: 'string',
                maxGraphemes: 64,
                maxLength: 640,
              },
            },
            durationMs: {
              type: 'integer',
              description:
                'Duration of the video in milliseconds, as measured by the client at upload time.',
              minimum: 1,
            },
            aspectRatio: {
              type: 'ref',
              ref: 'lex:social.openreel.video.post#aspectRatio',
            },
            thumbnail: {
              type: 'blob',
              description: 'Poster image displayed before playback starts.',
              accept: ['image/*'],
              maxSize: 1000000,
            },
            alt: {
              type: 'string',
              description: 'Alt text describing the video for accessibility.',
              maxGraphemes: 1000,
              maxLength: 10000,
            },
            langs: {
              type: 'array',
              description:
                'Languages spoken or captioned in the video, as BCP-47 tags.',
              maxLength: 3,
              items: {
                type: 'string',
                format: 'language',
              },
            },
            labels: {
              type: 'union',
              description:
                'Self-applied labels, for example adult content markers.',
              refs: ['lex:com.atproto.label.defs#selfLabels'],
            },
            createdAt: {
              type: 'string',
              description:
                'Client-declared timestamp when the post was created.',
              format: 'datetime',
            },
          },
        },
      },
      aspectRatio: {
        type: 'object',
        description:
          'Display aspect ratio as a width:height pair. Only the ratio is meaningful; the values are not pixel dimensions.',
        required: ['width', 'height'],
        properties: {
          width: {
            type: 'integer',
            minimum: 1,
          },
          height: {
            type: 'integer',
            minimum: 1,
          },
        },
      },
    },
  },
} as const satisfies Record<string, LexiconDoc>
export const schemas = Object.values(schemaDict) satisfies LexiconDoc[]
export const lexicons: Lexicons = new Lexicons(schemas)

export function validate<T extends { $type: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType: true,
): ValidationResult<T>
export function validate<T extends { $type?: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: false,
): ValidationResult<T>
export function validate(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: boolean,
): ValidationResult {
  return (requiredType ? is$typed : maybe$typed)(v, id, hash)
    ? lexicons.validate(`${id}#${hash}`, v)
    : {
        success: false,
        error: new ValidationError(
          `Must be an object with "${hash === 'main' ? id : `${id}#${hash}`}" $type property`,
        ),
      }
}

export const ids = {
  ComAtprotoLabelDefs: 'com.atproto.label.defs',
  ComAtprotoRepoCreateRecord: 'com.atproto.repo.createRecord',
  ComAtprotoRepoDefs: 'com.atproto.repo.defs',
  ComAtprotoRepoDeleteRecord: 'com.atproto.repo.deleteRecord',
  ComAtprotoRepoGetRecord: 'com.atproto.repo.getRecord',
  ComAtprotoRepoListRecords: 'com.atproto.repo.listRecords',
  ComAtprotoRepoPutRecord: 'com.atproto.repo.putRecord',
  ComAtprotoRepoStrongRef: 'com.atproto.repo.strongRef',
  SocialOpenreelEngagementCompletionRate:
    'social.openreel.engagement.completionRate',
  SocialOpenreelEngagementWatchEvent: 'social.openreel.engagement.watchEvent',
  SocialOpenreelFeedGenerator: 'social.openreel.feed.generator',
  SocialOpenreelVideoPost: 'social.openreel.video.post',
} as const
