---
name: git-push-branch
description: Pushes the active branch of the hubspot-services-development repository to its remote, then returns confirmation. Resolves the repo root from the current git working tree, rejects a push from main, and pushes the active branch to the remote without force. Atomic and strictly per-instruction: it resolves the repository, executes the push, and returns the result without taking orchestration decisions. Takes no input parameters; it always operates on the active branch. Intended for the contribution flow after the work was committed with git-commit. Never resolves conflicts or forces a push; any rejection is returned as an error. Triggers: any request to push the active branch of hubspot-services-development to the remote.
---

<!--
Changelog:
- 1.0: initial. Atomic push-active-branch skill for the local hubspot-services-development repository, used by a contributing subagent after it has committed its work on its branch.
- 2.0 (2026-09-30): migrated to Claude Code. The repo root comes from git rev-parse plus an origin remote name check, replacing the OS path scan and persisted path. References updated from commit-file/create-branch to git-commit/git-create-branch.
-->

# git-push-branch

## What it does

Pushes the active branch of the `hubspot-services-development` repository to its configured remote, then returns a confirmation naming the branch and the remote used. The caller (the contribution flow) invokes this after it has committed its work on a branch with `git-commit`, to publish that branch to the remote.

Strictly atomic: resolves the repository, executes the push, and returns the result. It takes no input parameters and never decides which branch to push, where to push, or any next action. It always pushes the active branch, never from `main`, without force, and without resolving conflicts. All orchestration, sequencing, and conflict-resolution decisions belong to the caller.

## When to invoke

- The contribution flow committed work on its branch with `git-commit` and now wants to push that branch to the remote.
- "Push the current branch", "push my work to the remote", "envia a branch para o remoto", any request to push the active branch of `hubspot-services-development`.
- As the step between `git-commit` and `github-create-pr` in the contribution flow, and after every adjustment commit on an open PR.

## When NOT to invoke

- The repo is not `hubspot-services-development`. This skill never operates outside that folder; use plain git for any other repository.
- The caller needs to create a branch (`git-create-branch`) or commit files (`git-commit`). This skill only pushes an existing active branch.
- The push would require force or resolve a merge conflict. This skill neither forces nor resolves; any rejection is returned as an error for the caller to handle.

## Parameters

No parameters. This skill always operates on the active branch of the resolved repository.

## Workflow

### 1. Locate the repository root

1. Run `git rev-parse --show-toplevel`. If it fails, return an error: the session is not inside a git repository. No git operation runs.
2. Run `git -C <root> remote get-url origin` and parse the repository name from the URL (HTTPS or SSH). If it is not `hubspot-services-development`, return an error and stop.

Run every later command as `git -C <root> ...`.

### 2. Reject a push from `main`

Run `git -C <root> branch --show-current`. If the active branch is `main` (or the output is empty, meaning a detached HEAD), return an error and stop. No push runs. Pushing directly from `main` is never allowed; the caller must push a work branch instead.

### 3. Push the active branch

Push the active branch to `origin` without a force flag:
- If the branch has no upstream (`git -C <root> rev-parse --abbrev-ref --symbolic-full-name '@{u}'` fails; keep the quotes, PowerShell otherwise parses `@{u}` as a hashtable): `git -C <root> push -u origin {branch}`.
- Otherwise: `git -C <root> push`.

If the remote rejects the push, return the rejection as a descriptive error and do not retry with `--force` or `--force-with-lease`. The skill does not attempt to overwrite and does not resolve conflicts; any conflict or rejection is passed back to the caller to handle.

### 4. Handle connection and permission failures

- If there is no write permission on the remote, return a descriptive error. Do not retry, do not guess.
- If there is a connection failure to the remote (network, SSH key rejected), return a descriptive error.

### 5. Return confirmation

On success, return a confirmation with the name of the branch that was pushed and the remote it was pushed to.

## Expected output

- On success: the branch name and the remote used, confirming the push landed.
- On active branch `main`: an error stating that a direct push from `main` is not allowed, with no operation run.
- On remote rejection or conflict: a descriptive error naming the rejection, with no force retry and no conflict resolution attempted.
- On no remote write permission: a descriptive error.
- On remote connection failure: a descriptive error.

Every error is a single clear, descriptive message identifying the defect and, when relevant, the branch and remote involved.

## Restrictions

- The repository is always `hubspot-services-development`. Never run git on any other folder.
- Never push directly from `main`. A push from `main` is rejected before any operation runs.
- Never use `--force` or `--force-with-lease`. A remote rejection is returned as an error, never overwritten.
- Does not resolve conflicts. Any conflict or rejection is returned as an error for the caller to handle.
- No parameters and no orchestration decisions. The skill only pushes the active branch and returns the result.

## Examples

**Example 1, successful push of the active branch**
```
(no parameters; active branch: feat/grupo-iter-integracao-sig, remote: origin)
```
```
✓ Pushed branch feat/grupo-iter-integracao-sig to origin
```

**Example 2, active branch is main**
```
(no parameters; active branch: main)
```
```
Error: a direct push from 'main' is not allowed. Push a work branch instead. No operation ran.
```

**Example 3, remote rejects the push because it is behind**
```
(no parameters; active branch: fix/acme-nav)
```
```
Error: push of 'fix/acme-nav' was rejected by origin because the remote branch has commits this branch does not have. Pull or reconcile first; no force push was attempted.
```

**Example 4, no write permission on the remote**
```
(no parameters)
```
```
Error: no write permission on the 'origin' remote.
```

**Example 5, connection failure**
```
(no parameters)
```
```
Error: failed to connect to remote 'origin'. Check the network, the SSH key and the remote configuration.
```

## References

- Related skill: `git-create-branch` (creates and pushes the initial work branch on the same repository).
- Related skill: `git-commit` (commits the work on the active branch that this skill then pushes).
- Related skill: `git-onboarding` (diagnoses connection and authentication failures against the remote).
