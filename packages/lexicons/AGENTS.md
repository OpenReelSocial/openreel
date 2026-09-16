# Lexicon workspace instructions

This file adds to the repository-level `AGENTS.md` for everything under
`packages/lexicons/`. Where the two disagree, this file governs this subtree.

## What this package is

`@openreel/lexicons` holds OpenReel's AT Protocol Lexicons and the TypeScript
bindings generated from them. Lexicons are **public protocol contracts**: once a
record is written to the network under an NSID, that record is immutable and
other AT Protocol implementations may read it. They are not internal types and
must not be edited with the casualness of internal types.

The namespace is `social.openreel.*`, decided in
[ADR-0001](../../docs/adr/0001-domain-and-lexicon-namespace.md). Do not author
documents under any other namespace. References to `io.openreel.*` in
`docs/reference/` are historical.

## Layout

```text
packages/lexicons/
├── lexicons/
│   ├── social/openreel/**/*.json   # OpenReel Lexicons: the source of truth (hand-edited)
│   └── com/atproto/**/*.json       # upstream Lexicons, vendored VERBATIM (never hand-edited)
├── scripts/lex.ts                  # validate / generate / check, driven by the Makefile
├── src/
│   ├── index.ts                    # public surface; re-exports from src/generated (hand-edited)
│   └── generated/                  # @atproto/lex-cli output (GENERATED, never hand-edited)
└── test/                           # contract tests
```

One file per NSID. The file path must equal the NSID:
`lexicons/social/openreel/video/post.json` defines `social.openreel.video.post`.
`make lex-check` enforces this.

## Generated files

Everything under `src/generated/` is produced by `@atproto/lex-cli gen-api` and
carries a `GENERATED CODE - DO NOT MODIFY` header. Do not edit it; edit the JSON
and regenerate. It is committed so consumers do not need the code generator, and
CI (`make lex-check`) fails when it is stale.

Prettier and ESLint ignore `src/generated/` because `lex-cli` formats its own
output and `make lex-check` compares byte for byte.

The build relaxes `exactOptionalPropertyTypes` for this package only, because
the generated client does not compile under it. Consumers keep the strict base.

## Vendored upstream Lexicons

`lexicons/com/atproto/` contains copies of upstream `bluesky-social/atproto`
Lexicons that OpenReel documents `ref` (`com.atproto.repo.strongRef`,
`com.atproto.label.defs`) plus the `com.atproto.repo.*` record methods the
generated client needs. They exist only so codegen and runtime validation can
resolve references. They are copied verbatim from upstream commit
`d442d037d33d68061df6b44d4269b5ee7309c66f` and are ignored by Prettier so they
stay byte-identical.

- Never edit them here. Refresh them from upstream and record the new commit.
- Do not add an upstream document unless an OpenReel document or the generated
  client needs it.
- `make lex-check` rejects any document outside `social.openreel.*` that is not
  under `lexicons/com/atproto/`.

## Workflow for changing a Lexicon

1. Read the AT Protocol Lexicon specification and the existing documents for
   style. Fields are lowerCamelCase; use `knownValues` rather than `enum`;
   prefer `format` (`datetime`, `at-uri`, `cid`, `did`, `language`) over ad hoc
   strings; set `maxLength`/`maxGraphemes` on free text; blobs declare `accept`
   and `maxSize`.
2. Edit or add the JSON under `lexicons/social/openreel/`.
3. Run `make lex`. It validates every document (parse, NSID/path match, all refs
   resolve) and regenerates `src/generated/`.
4. Update `src/index.ts` if a new document adds a namespace export.
5. Add or extend contract tests in `test/`: a representative valid value and
   representative invalid values for every new constraint.
6. Run `make check`; it includes `make lex-check`.
7. Commit the JSON, generated output, and tests together.

Note what `@atproto/lexicon` does and does not enforce at record validation
time: blob `accept` and `maxSize` are enforced by the PDS at upload, and unions
are open unless `closed: true`. Tests assert those constraints on the schema
rather than expecting runtime rejection.

## Compatibility rules

Records already on the network cannot be rewritten, so schema changes are
constrained by what existing data and existing readers can tolerate.

Safe (additive) changes:

- adding an **optional** property,
- adding a value to `knownValues`,
- adding a new definition or a new Lexicon document,
- loosening a constraint (raising `maxLength`, widening `accept`),
- clarifying a `description`.

Breaking changes, which require explicit human review before merging and, when
they alter a durable decision, an ADR:

- renaming, removing, or changing the type of a published property,
- adding a **required** property, or making an optional one required,
- tightening a constraint (lowering `maxLength`, narrowing `accept`, adding
  `minimum`/`maximum`),
- replacing `knownValues` with a closed `enum`, or closing a union,
- changing a record's `key` type,
- changing the semantics of an existing field (e.g., switching units),
- renaming or deleting an NSID.

Until the first `social.openreel.*` records are written to a live PDS the
shapes may still change through ordinary review, but treat every change as if
it were breaking so the habit is in place before it matters. When in doubt,
flag the change as potentially breaking in the PR rather than deciding alone.

## Design decisions recorded here

- **Durations are integer milliseconds** (`durationMs`, `watchDurationMs`,
  `videoDurationMs`). Lexicon has no floating-point type.
- **Ratios are integer basis points** (`avgCompletionRateBps`, `likeRatioBps`,
  0-10000) for the same reason.
- **`social.openreel.engagement.completionRate` is an `object`, not a
  `record`.** It is an anonymized aggregate computed by an indexing service, so
  it has no natural owner repository; the `main` def is an object (like
  `com.atproto.repo.strongRef`) intended for XRPC outputs. It follows the NSID
  from ADR-0001 rather than a `getCompletionRate` query so the shape can be
  reused by whichever endpoint eventually returns it.
- **`watchEvent` stores durations, not a completion ratio.** The ratio is
  derivable, and storing `videoDurationMs` alongside lets feed generators
  compute it without hydrating the post.
- **`feed.generator.rankingCriteria` is required.** Method disclosure is the
  point of user-selectable feeds; a generator that will not self-classify is
  the case OpenReel is designed to avoid. The feed URI is the record's own
  AT-URI, so there is no `feedUri` field.

## Not decided here

- **Swift bindings for the iOS client.** ADR-0002 leaves the Swift generation
  path unresolved. Nothing in this package targets Swift yet; the JSON is the
  input any future generator would consume.
- **Request validation for Express 5** (ADR-0002). The generated `validate*`
  helpers cover records; how HTTP inputs are validated is a separate choice.
- **Private engagement data.** AT Protocol repositories are public, so
  `watchEvent` records written to a user's PDS are readable by anyone. The
  project plan's opt-in, tiered sharing model needs a mechanism that does not
  exist in the protocol today; until then clients must treat writing a
  `watchEvent` as publishing it.
