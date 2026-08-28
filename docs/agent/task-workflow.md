# Structured task → GitHub Issue workflow

OpenReel uses GitHub Issues as the durable execution record for both humans and coding agents.

The structured YAML backlog is useful for planning and bulk creation, but it is not intended to become a second live project tracker. Once a task is seeded, discussion, blockers, assignees, PR links, and execution state belong in GitHub.

## Files

- `docs/dev-environment-tasks.yaml` — structured seed backlog.
- `.github/ISSUE_TEMPLATE/task.yml` — form for manually created bounded tasks.
- `scripts/github/seed_issues.py` — deterministic YAML → GitHub Issue renderer/seeder.
- `.github/workflows/seed-backlog.yml` — manual, permission-scoped way to run the seeder in GitHub.

## Stable IDs

Seeded issue titles start with a stable task ID:

```text
[DEV-016] Scaffold AppView service
```

The importer treats that ID as the idempotency key. Running the seeder again skips an existing task by default.

## Local dry run

Requires Python, PyYAML, and an authenticated GitHub CLI:

```bash
python -m pip install PyYAML

python scripts/github/seed_issues.py   --file docs/dev-environment-tasks.yaml   --repo OpenReelSocial/openreel   --label dev-infra
```

Dry-run is the default. It prints what would be created or skipped.

Seed a small slice:

```bash
python scripts/github/seed_issues.py   --file docs/dev-environment-tasks.yaml   --repo OpenReelSocial/openreel   --ids DEV-006,DEV-007,DEV-008   --label dev-infra   --apply
```

Or select a phase:

```bash
python scripts/github/seed_issues.py   --file docs/dev-environment-tasks.yaml   --repo OpenReelSocial/openreel   --phase ci   --label dev-infra   --apply
```

## GitHub Action

Use **Actions → Seed task backlog → Run workflow**.

Leave `apply` false for the first run. Review the Action log, then run again with `apply=true`.

The workflow uses the repository-scoped `GITHUB_TOKEN` with:

```yaml
permissions:
  contents: read
  issues: write
```

No developer PAT or long-lived bot credential is required.

## Updating existing seeded issues

By default, an existing `[DEV-xxx]` issue is never rewritten. That protects human discussion and edits.

`--update-existing` (or the workflow checkbox) opts into regenerating the managed task body from YAML. Use it deliberately.

This tool does not automatically close issues when YAML says `done`, change assignees, or synchronize arbitrary issue state. It is a seed/import tool, not a bidirectional tracker.

## Agent usage

A human can tell a coding agent:

```text
Implement DEV-016. Find the corresponding GitHub issue, read AGENTS.md and relevant ADRs,
work in an isolated branch/worktree, satisfy the issue acceptance criteria, and run the
repository's available verification before preparing a PR.
```

The issue should contain enough durable context that the agent does not need private chat history to understand the task.
