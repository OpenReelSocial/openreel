#!/usr/bin/env python3
"""
Seed structured OpenReel tasks into GitHub Issues.

Default behavior is DRY RUN. Pass --apply to create issues.

Requirements:
  - Python 3.10+
  - PyYAML
  - GitHub CLI (`gh`) authenticated with issue write permission

The script is intentionally a seeder, not a bidirectional project-management
sync. Existing issues are left alone unless --update-existing is supplied.
Stable task IDs in issue titles make repeated runs idempotent.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import yaml

TASK_ID_RE = re.compile(r"^\[([A-Za-z0-9._-]+)\]\s+")


def run_gh(args: list[str], *, capture: bool = True) -> str:
    cmd = ["gh", *args]
    proc = subprocess.run(
        cmd,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"{' '.join(cmd)} failed: {detail}")
    return (proc.stdout or "").strip()


def load_tasks(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("tasks"), list):
        raise ValueError(f"{path} must contain a top-level 'tasks' list")

    tasks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in data["tasks"]:
        if not isinstance(raw, dict):
            raise ValueError("Every task must be a mapping")
        task_id = str(raw.get("id", "")).strip()
        title = str(raw.get("title", "")).strip()
        if not task_id or not title:
            raise ValueError("Every task needs non-empty id and title")
        if task_id in seen:
            raise ValueError(f"Duplicate task id: {task_id}")
        seen.add(task_id)
        tasks.append(raw)
    return data, tasks


def list_issues(repo: str) -> dict[str, dict[str, Any]]:
    raw = run_gh([
        "issue", "list",
        "--repo", repo,
        "--state", "all",
        "--limit", "1000",
        "--json", "number,title,url,state",
    ])
    issues = json.loads(raw or "[]")
    by_id: dict[str, dict[str, Any]] = {}
    for issue in issues:
        match = TASK_ID_RE.match(issue.get("title", ""))
        if match:
            by_id[match.group(1)] = issue
    return by_id


def task_labels(task: dict[str, Any], extra_labels: list[str]) -> list[str]:
    labels = ["task", *extra_labels]
    priority = str(task.get("priority", "")).strip()
    if priority:
        labels.append(f"priority:{priority}")

    # Optional per-task GitHub labels can be added without changing the importer.
    github = task.get("github")
    if isinstance(github, dict):
        raw_labels = github.get("labels", [])
        if isinstance(raw_labels, list):
            labels.extend(str(x).strip() for x in raw_labels if str(x).strip())

    # Preserve order while removing duplicates.
    return list(dict.fromkeys(labels))


def render_dependency(dep: str, issue_map: dict[str, dict[str, Any]]) -> str:
    issue = issue_map.get(dep)
    if issue:
        return f"- #{issue['number']} — `{dep}`"
    return f"- `{dep}`"


def render_body(
    task: dict[str, Any],
    *,
    source_file: str,
    issue_map: dict[str, dict[str, Any]],
) -> str:
    task_id = str(task["id"])
    desc = str(task.get("description", "")).strip()
    phase = str(task.get("phase", "")).strip() or "unspecified"
    priority = str(task.get("priority", "")).strip() or "unspecified"
    deps = [str(x) for x in (task.get("dependencies") or [])]
    acceptance = [str(x) for x in (task.get("acceptance_criteria") or [])]
    notes = [str(x) for x in (task.get("agent_notes") or [])]

    lines = [
        f"<!-- openreel-task-id: {task_id} -->",
        "",
        "## Desired outcome",
        "",
        desc or "_No description supplied._",
        "",
        "## Acceptance criteria",
        "",
    ]

    if acceptance:
        lines.extend(f"- [ ] {item}" for item in acceptance)
    else:
        lines.append("- [ ] Define observable completion criteria before implementation.")

    lines.extend(["", "## Dependencies", ""])
    if deps:
        lines.extend(render_dependency(dep, issue_map) for dep in deps)
    else:
        lines.append("- None")

    if notes:
        lines.extend(["", "## Agent / implementation notes", ""])
        lines.extend(f"- {item}" for item in notes)

    lines.extend([
        "",
        "## Task metadata",
        "",
        f"- **Task ID:** `{task_id}`",
        f"- **Phase:** `{phase}`",
        f"- **Priority:** `{priority}`",
        f"- **Source:** `{source_file}`",
        "",
        "> This issue was rendered from the structured OpenReel task backlog. "
        "The GitHub issue is the durable execution record; accepted ADRs and current code/tests "
        "remain authoritative for architecture and implemented behavior.",
    ])
    return "\n".join(lines) + "\n"


def ensure_label(repo: str, label: str) -> None:
    # `--force` makes this idempotent. Do not prescribe colors as project semantics.
    run_gh([
        "label", "create", label,
        "--repo", repo,
        "--description", "Managed by OpenReel task seeding workflow",
        "--force",
    ])


def create_issue(
    repo: str,
    title: str,
    body: str,
    labels: list[str],
) -> dict[str, Any]:
    for label in labels:
        ensure_label(repo, label)

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as f:
        f.write(body)
        body_path = f.name
    try:
        args = [
            "issue", "create",
            "--repo", repo,
            "--title", title,
            "--body-file", body_path,
        ]
        for label in labels:
            args.extend(["--label", label])
        url = run_gh(args)
    finally:
        Path(body_path).unlink(missing_ok=True)

    match = re.search(r"/issues/(\d+)$", url)
    if not match:
        raise RuntimeError(f"Created issue but could not parse issue number from {url!r}")
    return {"number": int(match.group(1)), "url": url, "title": title, "state": "OPEN"}


def update_issue(repo: str, number: int, body: str, labels: list[str]) -> None:
    for label in labels:
        ensure_label(repo, label)

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as f:
        f.write(body)
        body_path = f.name
    try:
        args = [
            "issue", "edit", str(number),
            "--repo", repo,
            "--body-file", body_path,
        ]
        for label in labels:
            args.extend(["--add-label", label])
        run_gh(args)
    finally:
        Path(body_path).unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--file", required=True, type=Path)
    p.add_argument("--repo", default=os.getenv("GITHUB_REPOSITORY"))
    p.add_argument("--apply", action="store_true", help="Create issues; default is dry run")
    p.add_argument("--update-existing", action="store_true")
    p.add_argument("--phase")
    p.add_argument("--priority")
    p.add_argument("--ids", help="Comma-separated task IDs")
    p.add_argument("--limit", type=int, default=0, help="Maximum selected tasks; 0 means no limit")
    p.add_argument("--label", action="append", default=[], dest="extra_labels")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if not args.repo:
        print("error: --repo is required outside GitHub Actions", file=sys.stderr)
        return 2
    if shutil.which("gh") is None:
        print("error: GitHub CLI `gh` is required", file=sys.stderr)
        return 2

    _, tasks = load_tasks(args.file)
    selected_ids = {
        x.strip() for x in (args.ids or "").split(",") if x.strip()
    }

    selected: list[dict[str, Any]] = []
    for task in tasks:
        if selected_ids and str(task["id"]) not in selected_ids:
            continue
        if args.phase and str(task.get("phase", "")) != args.phase:
            continue
        if args.priority and str(task.get("priority", "")) != args.priority:
            continue
        # The seeder normally skips tasks already declared done/deferred in source.
        if str(task.get("status", "todo")) in {"done", "deferred"}:
            continue
        selected.append(task)

    if args.limit > 0:
        selected = selected[: args.limit]

    issue_map = list_issues(args.repo)

    creates = [t for t in selected if str(t["id"]) not in issue_map]
    existing = [t for t in selected if str(t["id"]) in issue_map]

    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"{mode}: {len(selected)} selected, {len(creates)} new, {len(existing)} existing")

    for task in selected:
        task_id = str(task["id"])
        title = f"[{task_id}] {task['title']}"
        existing_issue = issue_map.get(task_id)
        action = "UPDATE" if existing_issue and args.update_existing else ("SKIP" if existing_issue else "CREATE")
        suffix = f" -> #{existing_issue['number']}" if existing_issue else ""
        print(f"{action:6} {title}{suffix}")

    if not args.apply:
        print("\nDry run only. Re-run with --apply after reviewing the selection.")
        return 0

    # Pass 1: create missing issues so dependency IDs can resolve to issue numbers.
    for task in creates:
        task_id = str(task["id"])
        title = f"[{task_id}] {task['title']}"
        body = render_body(
            task,
            source_file=str(args.file),
            issue_map=issue_map,
        )
        labels = task_labels(task, args.extra_labels)
        created = create_issue(args.repo, title, body, labels)
        issue_map[task_id] = created
        print(f"created {task_id}: {created['url']}")

    # Pass 2: refresh managed bodies so dependencies point to issue numbers.
    # Existing issues are only rewritten when explicitly requested.
    for task in selected:
        task_id = str(task["id"])
        issue = issue_map.get(task_id)
        if not issue:
            continue
        was_existing_before_run = any(str(t["id"]) == task_id for t in existing)
        if was_existing_before_run and not args.update_existing:
            continue
        body = render_body(
            task,
            source_file=str(args.file),
            issue_map=issue_map,
        )
        labels = task_labels(task, args.extra_labels)
        update_issue(args.repo, int(issue["number"]), body, labels)

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
