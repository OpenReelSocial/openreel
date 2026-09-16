// Public surface of @openreel/lexicons. Everything re-exported here comes from
// src/generated, which `make lex` produces from the JSON documents under
// lexicons/. Edit the JSON, not the generated code.

export {
  AtpBaseClient,
  ComAtprotoLabelDefs,
  ComAtprotoRepoStrongRef,
  SocialOpenreelEngagementCompletionRate,
  SocialOpenreelEngagementWatchEvent,
  SocialOpenreelFeedGenerator,
  SocialOpenreelVideoPost,
} from './generated/index.ts'
export { ids, lexicons, schemaDict, schemas, validate } from './generated/lexicons.ts'
export { asPredicate, type $Typed, type Un$Typed } from './generated/util.ts'
