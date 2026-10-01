---
name: git-create-branch
description: Creates a git branch off main on the hubspot-services-development repository and pushes it to the remote, then returns confirmation. Resolves the repo root from the current git working tree, validates the branch type, normalizes the client and description into kebab-case, and builds the branch name as {type}/{client}-{description}. Atomic and strictly per-instruction: it receives the parameters, runs the git operations, and returns the result without taking orchestration decisions. Intended for the contribution flow before making file changes. Triggers: any request to open a new branch on hubspot-services-development before committing work.
argument-hint: "<type> <client> <description>"
---

<!--
Changelog:
- 1.0: initial. Atomic create-branch-plus-push skill for the local hubspot-services-development repository, used by a contributing subagent before any write work.
- 2.0 (2026-09-30): migrated to Claude Code. The repo root comes from git rev-parse plus an origin remote name check, replacing the OS path scan and persisted path. Added a check for uncommitted tracked changes before switching to main, so uncommitted work is never carried into the new branch or lost. Normalization also strips characters outside [a-z0-9-].
-->

# git-create-branch

## What it does

Creates a git branch off `main` on the `hubspot-services-development` repository and pushes it to the remote in a single atomic operation, then returns a confirmation carrying the created branch name. The caller (the contribution flow) invokes this right before doing file work on the repo, so the base branch stays clean and the work lands on its own remote branch.

Strictly atomic: receives the parameters, resolves the repo root, executes the git operations, and returns the result. It never decides the branch type, the client, the description, or any next action. All orchestration, sequencing, and what-to-do-after decisions belong to the caller.

## When to invoke

- The contribution flow is about to change files in `hubspot-services-development` and must open a work branch off `main` first.
- "Create a branch for this change on the repo", "open a branch before I start editing", "cria a branch para essa mudança", any request to start a new `{type}/{client}-{description}` work branch.
- Any request to create a local branch and push it to the remote for this repository.

## When NOT to invoke

- The repo is not `hubspot-services-development`. This skill never operates outside that folder; use plain git for any other repository.
- The request is only to inspect the repo (that is `explore-repository`) or to commit/merge/delete branches. This skill only creates a branch off `main` and pushes it.
- The caller only wants a local branch with no push. This skill always pushes. Pushing is part of the single atomic operation, never skippable.

## Parameters

| Parameter | Required | Values | Meaning |
|---|---|---|---|
| `type` | Yes | `feat`, `fix`, `chore`, `refactor`, `docs`, `enh` | Branch kind. Only these six values are accepted. |
| `client` | Yes | Any string | Client name, normalized to kebab-case before the branch name is built. |
| `description` | Yes | Any string | Short description of the branch, normalized to kebab-case before the branch name is built. |

The branch name is built internally as `{type}/{client}-{description}` after normalization. The caller never passes a branch name; it passes `type`, `client`, and `description`.

## Workflow

### 1. Locate the repository root

1. Run `git rev-parse --show-toplevel`. If it fails, return an error: the session is not inside a git repository. No git operation runs.
2. Run `git -C <root> remote get-url origin` and parse the repository name from the URL (HTTPS or SSH). If it is not `hubspot-services-development`, return an error and stop.

Run every later command as `git -C <root> ...`.

### 2. Validate `type`

Confirm `type` is exactly one of `feat`, `fix`, `chore`, `refactor`, `docs`, `enh`. If it is not, return an error listing the six accepted values and stop. No git operation runs on an invalid type.

### 3. Normalize `client` and `description` and build the branch name

Normalize both `client` and `description` to kebab-case before building the branch name:

- Convert all characters to lowercase.
- Remove accents and diacritics (so `café` becomes `cafe`, `integração` becomes `integracao`).
- Replace whitespace, underscores and any other character outside `[a-z0-9-]` with a hyphen `-`.
- Collapse repeated hyphens into one.
- Strip leading and trailing hyphens.

Then build the branch name as `{type}/{client}-{description}` using the normalized values. If either value is empty after normalization, return an error and stop.

### 4. Update the base branch and create the new branch

1. Run `git -C <root> status --porcelain --untracked-files=no`. If it prints anything, return an error listing the uncommitted tracked files and stop: switching to `main` would carry or block that work. The caller decides what to do with it. Untracked files are ignored by this check; they carry across the switch, and `git switch` itself refuses if one would be overwritten.
2. Run `git -C <root> switch main`, then `git -C <root> pull --ff-only origin main` to ensure the `main` base is up to date. If either fails, return a descriptive error and stop. Do not create the branch.
3. Verify the target branch does not already exist locally (`git -C <root> rev-parse --verify --quiet refs/heads/{branch}`) or on the remote (`git -C <root> ls-remote --exit-code --heads origin {branch}`). If it exists in either place, return a descriptive error and do not attempt to overwrite.
4. Create the branch from `main`, never from any other branch: `git -C <root> switch -c {branch} main`.
5. Push the branch to the remote with upstream tracking: `git -C <root> push -u origin {branch}`.

Branch creation and push are one atomic operation. The skill never creates the branch without pushing it in the same operation.

### 5. Handle push failure

If the push fails, revert the local branch creation before returning: run `git -C <root> switch main`, then `git -C <root> branch -D {branch}`, so no stray local branch is left behind, then return a descriptive error. A failed push must never leave the newly created local branch behind.

## Expected output

- On success: a confirmation that includes the created branch name (for example `feat/acme-corp-integracao-erp`), that it exists on the remote, and that it is now the active branch.
- On `type` invalid: an error stating that `type` must be one of `feat`, `fix`, `chore`, `refactor`, `docs`, `enh`, and that no git operation ran.
- On uncommitted changes: an error listing the files, with no branch created.
- On `git pull origin main` failure: a descriptive error stating the base could not be updated, with no branch created.
- On branch already existing (local or remote): a descriptive error naming the branch, with no overwrite attempted.
- On no write permission to the repository: a descriptive error. Do not retry, do not guess.
- On push failure: a descriptive error confirming the local branch was reverted, leaving no stray local branch.

Every error is a single clear, descriptive message identifying the defect and, when relevant, the branch name involved.

## Restrictions

- The repository is always `hubspot-services-development`. Never run git operations on any other folder.
- The base branch is always `main`. The branch is never created from any other branch.
- Creation and push are atomic: never create a branch locally without pushing it in the same operation.
- Never switch branches over uncommitted changes, and never stash, reset or discard them.
- No orchestration decisions. The skill does not choose `type`, `client`, `description`, or any subsequent action; it only executes what it received and returns the result.
- Never overwrite an existing branch. If the target exists locally or on the remote, error and stop.
- Never use `--force` in any git command.
- On push failure, always revert the local branch before returning the error.

## Examples

**Example 1, successful branch creation**
```
type=feat
client=Acme Corp
description=Integração ERP
```
```
✓ Branch created and pushed: feat/acme-corp-integracao-erp
```

**Example 2, invalid type**
```
type=bugfix
client=Acme
description=login
```
```
Error: 'type' must be one of feat, fix, chore, refactor, docs, enh. Received 'bugfix'. No git operation ran.
```

**Example 3, branch already exists on the remote**
```
type=fix
client=Globex
description=renomeia coluna valor licenca
```
```
Error: branch 'fix/globex-renomeia-coluna-valor-licenca' already exists on the remote. Not overwritten.
```

**Example 4, uncommitted changes in the working tree**
```
type=chore
client=Acme
description=update-deps
```
```
Error: the working tree has uncommitted changes (custom-code/js/clients/acme/sync.js). Commit or set them aside before creating a branch. No branch was created.
```

**Example 5, push fails and the local branch is reverted**
```
type=fix
client=Acme
description=broken-nav
```
```
Error: push of 'fix/acme-broken-nav' failed. The local branch was reverted; no branch was left behind.
```

## References

- Related skill: `explore-repository` (read-only inspection of the same repository; run it before a write action, of which branch creation is the first step).
- Related skills: `git-write-files`, `git-commit`, `git-push-branch`, `github-create-pr` (later steps in the contribution flow of this repository).
