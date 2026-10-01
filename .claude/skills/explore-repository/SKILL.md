---
name: explore-repository
description: Read-only inspection of the hubspot-services-development repository. Resolves the repo root from the current git working tree, then lists directory contents or reads files by relative path. Use before any write action by the contribution flow on that repo, to avoid duplication and place files correctly (for example, checking custom-code/shared/ for reusable code). Triggers: "list the repo", "what's in folder X of hubspot", "read file Y in the repo", "explore the repository", any read-only inspection of hubspot-services-development.
argument-hint: "<list|read> <relative path>"
allowed-tools: Read, Glob, Grep, Bash(git rev-parse:*), Bash(git remote get-url:*), Bash(ls:*)
---

<!--
Changelog:
- 1.0: initial. Read-only exploration skill for the local hubspot-services-development repository.
- 2.0 (2026-09-30): migrated to Claude Code. The repo root comes from git rev-parse plus an origin remote name check, replacing the OS path scan and persisted path. Listing uses ls, reading uses the Read tool. Examples use real repository paths.
-->

# explore-repository

## What it does

Inspects the structure and content of the `hubspot-services-development` repository, always before any write action, to avoid duplication and guarantee files land in the correct place. Strictly read-only: lists directories and reads files. Never writes, modifies, or deletes.

## When to invoke

- Before adding, editing, or placing any file in `hubspot-services-development`, to confirm what already exists and where it belongs.
- "What is inside the folder `<path>` of the repo?"
- "Show me the content of file `<path>` in the repo."
- Any request to inspect the `hubspot-services-development` tree.
- "List the repository structure" / "explore the repository".

## When NOT to invoke

- The repo to inspect is not `hubspot-services-development`. This skill never operates outside that folder; use a plain filesystem read/list for any other repo.
- Any action that writes, modifies, deletes, creates, or git-operates on the repository. This skill is read-only.

## Parameters

| Parameter | Required | Values | Meaning |
|---|---|---|---|
| `action` | Yes | `list` or `read` | Operation to perform on `path`. |
| `path` | Yes | Relative path from the repo root | Directory to list when `action=list`, or file to read when `action=read`. |

`path` is always relative to the repository root. Empty string or `.` means the repository root itself.

## Workflow

### 1. Locate the repository root

1. Run `git rev-parse --show-toplevel`. If it fails, return an error: the session is not inside a git repository.
2. Run `git -C <root> remote get-url origin` and parse the repository name from the URL (HTTPS or SSH). If it is not `hubspot-services-development`, return an error: this skill only inspects `hubspot-services-development`.

### 2. Validate the inputs

Confirm `action` is `list` or `read`, and `path` is a valid relative path from the repo root:
- Reject absolute paths (`C:\...`, `/...`) or paths that escape the repo root (`..` traversal). The target must always resolve inside `hubspot-services-development`.

### 3. Execute the read-only operation

Resolve the absolute target below the repo root and inspect it:

**When `action=list`:**
- If the resolved path does not exist: return a descriptive error (path not found in the repository).
- If the resolved path is a file: return an error guiding the caller to use `action=read`.
- Otherwise (directory): list the items directly inside it with `ls -1Ap "<root>/<path>"` (a trailing `/` marks a directory), and mark each as `[file]` or `[dir]`. Return every direct child, `.git/` included.

**When `action=read`:**
- If the resolved path does not exist: return a descriptive error (path not found in the repository).
- If the resolved path is a directory: return an error guiding the caller to use `action=list`.
- Otherwise (file): read it with the Read tool and return the content.

### 4. Handle read permission

If the OS reports no read permission for the requested file or directory, return: there is no permission to read the requested path. Do not retry, do not guess content, do not write anything.

## Expected output

- `action=list`: one entry per line under the target directory, formatted as `<[file]|[dir]> <name>`, in a flat listing (no recursion).
- `action=read`: the full content of the target file.
- Errors: a single clear, descriptive message identifying the defect (not in the repo, missing path, wrong action type, no permission).

## Examples

**Example 1, list a directory:**
```
action=list
path=custom-code/js/clients/acme-corp
```
```
[dir]  checkout
[dir]  crm-sync
[dir]  forms
[file] README.md
```

**Example 2, read a file:**
```
action=read
path=custom-code/js/clients/acme-corp/README.md
```
```
(full content of the file)
```

**Example 3, wrong action for a file (list on a file):**
```
action=list
path=README.md
```
```
Error: 'README.md' is a file. Use action=read to read its content.
```

**Example 4, wrong action for a directory (read on a directory):**
```
action=read
path=custom-code
```
```
Error: 'custom-code' is a directory. Use action=list to see its contents.
```

**Example 5, path not found:**
```
action=list
path=no/such/folder
```
```
Error: the path 'no/such/folder' was not found in the hubspot-services-development repository.
```

## Restrictions

- Strictly read-only. No write, modification, or deletion of any kind is permitted.
- The target is always the repo `hubspot-services-development`. Never operate on any path that resolves outside this folder; reject absolute paths and `..` traversal.
- No recursion unless explicitly requested. `list` returns only the direct children of the directory.
- No inference or caching of file content. Return exactly what is on disk.

## References

- Related skill: `git-onboarding` (confirms the repository is present before the contribution flow starts).
- Related skill: `git-write-files` (writes files after this skill confirmed where they belong).
