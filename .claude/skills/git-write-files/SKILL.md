---
name: git-write-files
description: Writes one or more files into the hubspot-services-development repository on the active branch, without running any git operation that changes state, so the operator can test the code locally before it is committed. Resolves the repo root from the current git working tree, rejects a write on main and every file path that does not resolve inside the repository, then writes each file's content, creating intermediate directories as needed. Takes a non-empty list of files, each with a relative path and its full content. Atomic and strictly per-instruction: it receives the files, writes them to disk, and returns the result without taking orchestration decisions and without executing git add, commit, or push. Intended for the contribution flow after a branch was created and before the commit. Triggers: any request to place or update files on the active branch of hubspot-services-development without committing.
---

<!--
Changelog:
- 1.0: initial. Atomic no-git file-write skill for the local hubspot-services-development repository, used by a contributing subagent so the operator can test changes locally before they are committed.
- 2.0 (2026-09-30): migrated to Claude Code. The repo root comes from git rev-parse plus an origin remote name check, replacing the OS path scan and persisted path. Files are written with the Write tool, always with their full content (an existing file is read first, then overwritten). Only read-only git commands run (rev-parse, remote get-url, branch --show-current).
-->

# git-write-files

## What it does

Writes one or more files into the `hubspot-services-development` repository on the active branch, purely to disk, so the operator can test the code locally before it is committed. No state-changing git command runs: no `git add`, no `git commit`, no `git push`, no branch switching. The caller (the contribution flow) invokes this after it has created a branch, writes the file content, and returns so the operator can validate the working tree before the changes are staged and committed by a later step.

Strictly atomic: receives the files, validates them, writes them, and returns the result. It never decides which branch, which files, which content, or any next action. All orchestration, staging, commit, push, and follow-up decisions belong to the caller.

## When to invoke

- The contribution flow wants to place or update files on the active branch of `hubspot-services-development` so the operator can test locally before any commit.
- "Write these files so I can test", "grava esses arquivos na branch para eu testar", "escreve os arquivos no repositório sem commitar", any request to write file content into this repository's working tree without committing.
- As the step after `git-create-branch` and before the files are reviewed, tested, and later committed with `git-commit`.

## When NOT to invoke

- The repo is not `hubspot-services-development`. This skill never writes outside that folder.
- The caller wants to stage or commit the files: that is `git-commit`.
- The caller wants to create a branch (`git-create-branch`) or push (`git-push-branch`). This skill does not create branches and never pushes.
- The active branch is `main`. Writing on `main` is always rejected before any file is touched.

## Parameters

| Parameter | Required | Values | Meaning |
|---|---|---|---|
| `files` | Yes | List of objects, non-empty | Each object has `path` (the file's relative path from the repo root) and `content` (the file's full content). |

`files` must contain at least one entry; an empty list is rejected before any operation.

## Workflow

### 1. Locate the repository root

1. Run `git rev-parse --show-toplevel`. If it fails, return an error: the session is not inside a git repository. No file is written.
2. Run `git -C <root> remote get-url origin` and parse the repository name from the URL (HTTPS or SSH). If it is not `hubspot-services-development`, return an error and stop.

### 2. Reject a write on `main`

Run `git -C <root> branch --show-current`. If the active branch is `main` (or the output is empty, meaning a detached HEAD), return an error and stop. No file is written. Writing directly on `main` is never allowed; the caller must work from a branch created by `git-create-branch` first.

### 3. Validate every file path before writing anything

For each entry in `files`, reject invalid `path` values before writing any file, so no file is written until all paths are confirmed valid:

- Reject absolute paths (for example `C:\...` or `/...`) and any traversal with `..` that would escape the repository root.
- Reject any path inside `.git/`.
- Every `path` must be relative and resolve strictly inside `hubspot-services-development`.

If any path is invalid, return an error identifying that path and stop without writing any file. No partial write happens from a path-validation failure.

### 4. Write every file's content

After all paths pass validation, write the `content` of each `files` entry to its resolved absolute path (the relative `path` joined to the repository root) with the Write tool, which creates intermediate directories as needed. For an existing file, read it first (the Write tool requires it) and then overwrite it with the full received content.

If writing any single file fails (for example a missing write permission on the target directory), return an error identifying that file and stop. No remaining file is written after a failure; the skill never writes partially beyond the point of failure. If there is no write permission, return a descriptive error.

### 5. Return confirmation

On success, return a confirmation listing the files written and their paths, and the active branch name. No state-changing git command is executed.

## Expected output

- On success: the list of files written and their paths, confirming they are on disk on the active non-`main` branch.
- On active branch `main`: an error stating that writing on `main` is not allowed, with no file written.
- On an invalid path: an error identifying the invalid path (absolute, `..` traversal, or inside `.git/`), with no file written.
- On an empty `files` list: an error stating that at least one file is required.
- On a file-write failure: an error identifying the file that failed, with no remaining file written.
- On no write permission: a descriptive error.

Every error is a single clear, descriptive message identifying the defect and, when relevant, the exact path or file involved.

## Restrictions

- The repository is always `hubspot-services-development`. Never write outside that folder.
- Never write on `main`. Writing on `main` is rejected before any file is touched.
- Every file path must resolve inside the repository. Absolute paths, `..` traversal and `.git/` are always rejected.
- No state-changing git operation is ever executed. No `git add`, `git commit`, `git push`, branch switching, stash, or reset. Only `rev-parse`, `remote get-url` and `branch --show-current` run.
- Never write files partially. All paths are validated before any write, and a write failure stops the remaining files.
- No orchestration decisions. The skill does not choose the branch, the file contents, or any subsequent action; it only writes what it received and returns the result.

## Examples

**Example 1, successful write**
```
files=[
  { path: "custom-code/js/clients/acme-corp/checkout/purchaseSuccess.js", content: "..." },
  { path: "custom-code/js/clients/acme-corp/README.md", content: "..." }
]
```
```
✓ Wrote 2 files on branch feat/acme-corp-integracao-erp:
  - custom-code/js/clients/acme-corp/checkout/purchaseSuccess.js
  - custom-code/js/clients/acme-corp/README.md
```

**Example 2, empty file list**
```
files=[]
```
```
Error: provide at least one file to write. No file was written.
```

**Example 3, active branch is main**
```
(active branch: main)
```
```
Error: writing files on 'main' is not allowed. Create a branch with git-create-branch first. No file was written.
```

**Example 4, path escapes the repository**
```
files=[ { path: "../secrets.json", content: "..." } ]
```
```
Error: path '../secrets.json' resolves outside the hubspot-services-development repository. No file was written.
```

**Example 5, a later write fails after an earlier one succeeded**
```
(second file path is read-only or unwritable)
```
```
Error: failed to write 'custom-code/js/clients/acme/locked.js'. Files after this point were not written.
```

## References

- Related skill: `git-onboarding` (validates the repository and environment before the session proceeds).
- Related skill: `git-create-branch` (creates the branch that this skill writes files onto).
- Related skill: `explore-repository` (inspects the repository before writing, to place files correctly and avoid duplication).
- Related skill: `git-commit` (stages and commits the files after the operator tests them); `git-push-branch` and `github-create-pr` then publish and open the PR.
