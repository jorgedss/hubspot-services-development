---
name: github-merge-pr
description: Merges an open pull request into main on the hubspot-services-development GitHub repository with the gh CLI, then returns confirmation with the merge link. Resolves the repo root from the current git working tree, reads the owner and repo name from the configured git remote, verifies the PR exists and is open, verifies its base branch is main and that it has no conflicts, then merges it. Atomic and strictly per-instruction: it receives the PR number, executes the merge, and returns the result without taking orchestration decisions. The merge decision always comes from the caller and only after explicit operator confirmation; this skill never decides to merge on its own and never merges a closed or already-merged PR. Triggers: any request to merge a pull request on hubspot-services-development into main.
argument-hint: "<pr number>"
---

<!--
Changelog:
- 1.0: initial. Atomic merge-a-PR skill for the hubspot-services-development GitHub repository, used by a contributing subagent to close the loop after a PR is approved.
- 2.0 (2026-09-30): migrated to Claude Code. The repo root comes from git rev-parse plus an origin remote name check, replacing the OS path scan and persisted path. PR lookup and merge use gh pr view and gh pr merge instead of raw GET/PUT calls, so the token is resolved by gh and never passes through a command line. The conflict check reads the mergeable field before merging.
-->

# github-merge-pr

## What it does

Merges an open pull request into `main` on the `hubspot-services-development` GitHub repository, then returns a confirmation carrying the merge link. The caller (the contribution flow) invokes this after a pull request (opened by `github-create-pr`) is approved and the operator has explicitly confirmed the merge.

Strictly atomic: receives the PR number, verifies the PR and its base branch, executes the merge, and returns the result. It never decides whether a PR should be merged, and it never merges without an explicit operator-confirmed decision by the caller. All orchestration, approval, operator-confirmation, and follow-up decisions belong to the caller.

## When to invoke

- The contribution flow, after the operator explicitly confirmed the merge of a PR on `hubspot-services-development`, wants to merge it into `main`.
- "Merge PR #X", "mergea o PR", "faz o merge do PR #X", any request to merge an open pull request on this repository into `main`.

## When NOT to invoke

- The repo is not `hubspot-services-development`. This skill never operates outside that repo or merges a PR on any other repository.
- The merge was not preceded by explicit operator confirmation in this session. Without it the caller must not call this skill.
- The caller wants to open a PR (`github-create-pr`), push a branch (`git-push-branch`), or resolve conflicts. This skill only merges and never resolves conflicts.
- The PR is closed or already merged (handled as an error, described below).

## Parameters

| Parameter | Required | Values | Meaning |
|---|---|---|---|
| `pr_number` | Yes | Number | The number of the pull request to merge. |

This is the only parameter. The merge target branch is always `main`.

## Workflow

### 1. Locate the repository root

1. Run `git rev-parse --show-toplevel`. If it fails, return an error: the session is not inside a git repository. No merge is attempted.
2. Run `git -C <root> remote get-url origin`. If the repository name is not `hubspot-services-development`, return an error and stop.

### 2. Read the owner and repository from the git remote

Determine the GitHub `owner` and repository name from the `origin` URL (HTTPS or SSH), never from fixed values, and pass it to every `gh` call as `--repo <owner>/<repo>`.

### 3. Verify the PR exists and is open

Run:

```
gh pr view {pr_number} --repo <owner>/<repo> --json number,state,baseRefName,mergeable,url
```

- If the PR does not exist, return a descriptive error.
- If `state` is `CLOSED` or `MERGED`, return an error stating its current state. Do not attempt a merge.
- Only an `OPEN` PR proceeds.

### 4. Verify the base branch is main

If `baseRefName` is not `main`, return an error and stop. This skill only merges PRs whose base branch is `main`.

### 5. Verify there are no conflicts

If `mergeable` is `CONFLICTING`, return a descriptive error instructing the operator to resolve the conflicts manually, and stop. If it is `UNKNOWN` (GitHub still computing), wait a few seconds and run step 3 once more; if it is still `UNKNOWN`, proceed and let the merge call report any problem.

### 6. Merge the pull request

Run:

```
gh pr merge {pr_number} --repo <owner>/<repo> --merge
```

A merge commit applies unless the caller and operator explicitly requested another method (`--squash` or `--rebase`); the skill does not decide the merge method on its own. Do not pass `--delete-branch`, `--admin` or `--auto` unless the operator explicitly asked for it.

`gh` resolves the authentication itself. The token never appears in a command or in the output.

- If the merge is blocked (conflicts, required reviews, failing required checks), return the reason as a descriptive error. Do not force, bypass protections, or auto-resolve.
- If the token is invalid or lacks permission, return a descriptive error. If connecting to GitHub fails, return a descriptive error.

### 7. Return confirmation

On success, return a confirmation with the PR number and its `url` (the merged PR page). No further action is taken.

## Expected output

- On success: a confirmation with the merge link.
- On PR not found: a descriptive error.
- On PR already merged or closed: an error stating its current state, with no merge attempted.
- On PR base not `main`: an error stating that only PRs targeting `main` are merged, with no merge attempted.
- On merge conflicts or a blocking branch protection: a descriptive error instructing the operator what must be resolved.
- On an invalid token or missing permission: a descriptive error.
- On a GitHub connection failure: a descriptive error.

Every error is a single clear, descriptive message identifying the defect and, when relevant, the PR number and state involved.

## Restrictions

- The repository is always `hubspot-services-development`. Never merge a PR on any other repo.
- The owner and repo are read from the `origin` remote. Never use fixed owner/repo values.
- Only merge a PR whose base branch is `main`. Never merge a PR with any other base.
- Never merge a PR that is closed or already merged. Only an open PR is merged.
- Never bypass branch protection (`--admin`) and never resolve conflicts.
- The token never appears in a command or in the output.
- Never decide the merge on its own. The decision always comes from the caller after explicit operator confirmation; this skill only executes the merge it is told to perform.
- Never invent an owner, repo, or PR number.

## Examples

**Example 1, successful merge**
```
pr_number=42
```
```
✓ Merged PR #42 into main
  https://github.com/<owner>/hubspot-services-development/pull/42
```

**Example 2, PR was already merged**
```
pr_number=42
```
```
Error: PR #42 is already merged. No merge was attempted.
```

**Example 3, PR is closed**
```
pr_number=41
```
```
Error: PR #41 is closed. Only open PRs are merged. No merge was attempted.
```

**Example 4, PR base branch is not main**
```
pr_number=44
```
```
Error: PR #44 targets branch 'release/2.0', not 'main'. Only PRs targeting main are merged. No merge was attempted.
```

**Example 5, merge blocked by conflicts**
```
pr_number=45
```
```
Error: PR #45 has merge conflicts. Resolve the conflicts manually and confirm, then retry. No merge was attempted.
```

**Example 6, PR not found**
```
pr_number=999
```
```
Error: pull request #999 was not found in <owner>/hubspot-services-development.
```

## References

- Related skill: `github-create-pr` (opens the PR on the same repository that this skill merges).
- Related skill: `git-push-branch` (pushes the branch that became the PR, and every adjustment commit).
- Related skill: `git-onboarding` (validates that the GitHub authentication and remote are ready before this merge skill runs).
