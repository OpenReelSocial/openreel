# Git and pull request workflow

OpenReel uses a lightweight, trunk-oriented workflow. Work starts from `main`, proceeds on a short-lived branch or isolated worktree, and returns through a pull request that is squash-merged.

The pull request is the durable record of a change. Reviews are encouraged, especially for architecture, infrastructure, security-sensitive code, and public Lexicons, but the capstone workflow does not require an approval or Code Owner review for every merge.

## VS Code workflow

The repository recommends the GitHub Pull Requests and Issues extension. After installing the workspace recommendations and signing in to GitHub, routine work can stay in VS Code:

1. Open the GitHub Issues view, select the assigned issue, and choose **Start Working on Issue**. The extension creates and checks out a task-based branch from `main`.
2. Make the scoped changes.
3. Open Source Control, review the changed files, stage the intended files with the `+` button, enter a focused commit message, and select **Commit**.
4. Select **Publish Branch**.
5. Open the GitHub Pull Requests view, select **Create Pull Request**, complete the repository template, and create the pull request against `main`.
6. Review the pull request and use **Merge Pull Request** when it is ready. Squash is the repository's only enabled merge method.

VS Code fetches remote updates in the background and prunes remote-tracking branches that GitHub has deleted. It does not automatically stage or commit changes; explicit staging keeps unrelated work out of the commit.

If changes were accidentally started on `main`, select `main` in the status bar and choose **Create new branch** before committing. The working changes will follow to the new branch.

The command-line instructions below remain the recovery path and are useful for automation or diagnosing Git problems.

## Branches

Use one task or issue per branch where practical. Keep branches short-lived and delete them after merge.

Prefer names that describe the work:

```text
feature/42-appview-health
fix/81-player-audio
```

Do not encode whether a human or coding agent authored the branch. The task is the organizing unit.

Start a branch from an up-to-date `main`:

```bash
git switch main
git pull --ff-only
git switch -c feature/42-appview-health
```

When isolation or concurrent work is useful, create a separate worktree from `origin/main`:

```bash
git fetch origin
git worktree add ../openreel-42 -b feature/42-appview-health origin/main
```

Do not create a separate worktree when an ordinary branch is sufficient. Coordinate before editing shared hotspot files from multiple worktrees.

## Pull requests

Push the branch and open a pull request targeting `main`:

```bash
git push -u origin feature/42-appview-health
gh pr create --fill
```

Pull requests should:

- link the issue they close;
- explain what changed and why;
- describe validation performed and anything that could not be run;
- identify important risks, tradeoffs, and follow-up work;
- note architecture, infrastructure, or Lexicon changes;
- request relevant reviewers when their context would improve the change.

Keep commits and diffs focused. Do not mix unrelated cleanup into the task.

## Review and merge

Changes to `main` go through a pull request, including changes made by repository administrators. Maintainers may merge their own pull requests when the change is ready; an approval is not a mechanical requirement.

Use squash merging so each pull request becomes one coherent commit on `main`. Merge commits and rebase merging are disabled. Delete the topic branch after merge.

`CODEOWNERS` provides ownership context and automatically suggests reviewers. It does not impose a required approval. This keeps domain experts visible without blocking capstone progress when a listed owner is unavailable.

## Repository settings

The following GitHub settings enforce the intended workflow and require repository administration access to configure:

- enable squash merging and disable merge commits and rebase merging;
- delete head branches automatically after pull requests merge;
- activate the `main protection` branch ruleset for the default branch;
- require a pull request before merging, with zero required approvals;
- do not require Code Owner review, stale-review dismissal, last-push approval, or review-thread resolution;
- allow only squash merges through the ruleset;
- require linear history and block branch deletion and force pushes;
- allow organization administrators to bypass other protections only through a pull request.

Required status checks are intentionally deferred until stable CI exists. DEV-040 is responsible for making important checks merge requirements; do not add placeholder or unstable required checks as part of this workflow setup.

Repository rules are guardrails, not a substitute for judgment. Contributors should still seek review for consequential or unfamiliar changes even when GitHub does not require it.
