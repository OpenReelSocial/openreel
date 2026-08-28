# OpenReel Documentation

This directory contains OpenReel's durable engineering documentation.

The repository is the primary working environment for implementation, architecture decisions, protocol contracts, and agent-accessible technical context. External documents such as the project Google Doc may remain useful as reports or stakeholder-facing artifacts, but engineering decisions should be captured in repository sources that can be reviewed and versioned alongside the code.

## Documentation Model

Different artifacts are authoritative for different questions.

### GitHub Issues

GitHub Issues define the work currently being requested:

* desired outcome,
* scope and out-of-scope work,
* dependencies,
* acceptance criteria,
* blockers and implementation discussion.

Once a structured backlog task has been seeded into GitHub, the GitHub Issue is the durable execution record for that task.

### Architecture Decision Records

`docs/adr/` records durable architectural and technical decisions.

Accepted ADRs govern decisions such as:

* protocol and namespace choices,
* major infrastructure technologies,
* service boundaries,
* persistence technologies,
* deployment patterns,
* externally visible compatibility decisions.

When an accepted ADR conflicts with older planning or reference documentation, the ADR wins for the decision it governs.

### Protocol Contracts

Published OpenReel Lexicons and other externally visible protocol contracts define interoperable data formats and APIs.

These should be treated more conservatively than ordinary internal implementation details because other applications and services may depend on them.

### Code, Tests, and Configuration

Current code, tests, migrations, generated artifacts, and checked-in configuration define implemented system behavior.

Documentation should be updated when implementation materially changes the architecture or externally visible behavior, but documentation should not be used to pretend that unimplemented behavior already exists.

### Current Engineering Documentation

As the architecture becomes concrete, current engineering documentation should live in focused repository documents, for example:

```text
docs/
├── architecture/
│   ├── overview.md
│   ├── media.md
│   └── moderation.md
├── requirements/
│   ├── functional.md
│   └── non-functional.md
├── roadmap/
│   └── development-plan.md
├── agent/
│   ├── git-workflow.md
│   └── task-workflow.md
└── adr/
```

These directories should be created only when real content belongs in them.

Current engineering documents describe the system as it is presently intended to work. They may evolve through ordinary pull requests.

If a documentation change represents a durable architectural decision rather than an explanation of an existing decision, add or update an ADR as appropriate.

### Reference Documentation

`docs/reference/` contains imported, historical, or otherwise non-canonical design context.

The initial OpenReel project plan/report should be imported here, for example:

```text
docs/reference/project-plan.md
```

Reference documents are useful for:

* product motivation,
* original requirements,
* research and citations,
* planned user experiences,
* historical architecture proposals,
* implementation ideas that have not yet been reconciled with the current system.

Reference documents may contain stale or contradictory implementation details.

They do **not** override:

* accepted ADRs,
* published protocol contracts,
* current engineering documentation,
* current code/tests/configuration,
* the scope and acceptance criteria of an active GitHub Issue.

Agents and contributors should still consult reference documentation when it contains relevant context.

## Promoting Reference Material

OpenReel does not need to fully normalize the original project plan before implementation begins.

Instead, relevant material should be reconciled as development reaches each area.

A typical workflow is:

```text
reference project plan
        ↓
implementation reaches that area
        ↓
review relevant assumptions
        ↓
resolve contradictions / make decisions
        ↓
ADR if a durable decision is required
        ↓
update or create focused current documentation
        ↓
implement
```

For example, when work reaches media infrastructure, contributors may consult the original project plan's S3/CDN/HLS sections. If the reference document contains conflicting Cloudflare and CloudFront assumptions, the team should resolve the actual design rather than silently adopting whichever statement the contributor encountered first.

The resulting decision should then be reflected in an ADR and/or current architecture documentation.

## Google Doc Relationship

The original Google Doc may remain useful as a project report, academic deliverable, or stakeholder-readable overview.

The intended direction of synchronization is:

```text
repository engineering truth
        ↓
periodic Google Doc updates
```

The Google Doc and repository should not be treated as two independently editable canonical engineering specifications.

When technical decisions change, update the repository source of truth first. The external report can then be refreshed from the current repository documentation when useful.

## Superseded and Conflicting Material

Reference documentation may contain assumptions, identifiers, technologies, or architectural details that have since changed.

Do not maintain a manual catalog of every superseded statement.

Instead:

* accepted ADRs govern the decisions they explicitly address,
* current protocol contracts govern externally visible schemas and identifiers,
* current engineering documentation describes the present intended design,
* current code, tests, and configuration describe implemented behavior.

When older reference material conflicts with one of these sources, treat the reference material as historical context and follow the current repository source.

If a conflict is important and not already resolved by a current source, surface it in the issue or PR rather than silently choosing an interpretation.

## Documentation Expectations

When changing OpenReel:

* update documentation when behavior or architecture materially changes,
* prefer focused documents over one continuously growing master specification,
* use ADRs for durable decisions,
* preserve useful historical context rather than rewriting history,
* clearly distinguish current design from proposals and reference material,
* avoid duplicating the same authoritative information across several documents,
* link to existing authoritative sources rather than copying them where practical.

Documentation should make it possible for a contributor or fresh-context coding agent to understand the relevant system without relying on private chat history or team meetings.
