---
name: git-commit
description: Stages every modified file on the active branch of the hubspot-services-development repository and commits them with the message provided, then returns confirmation. Resolves the repo root from the current git working tree, rejects a commit on main, validates the message as conventional commits (with optional scope, the format this repository's history uses), checks that there are modified files to commit, refuses to stage environment files, stages all changes, and commits with the received message. Atomic and strictly per-instruction: it receives the message, executes the commit, and returns the result without taking orchestration decisions. Never creates an empty commit and never pushes; pushing is git-push-branch. Intended for the contribution flow after the operator tested the files written by git-write-files. Triggers: any request to stage and commit the modified files on the active branch of hubspot-services-development.
argument-hint: "<type>(<scope>): <description>"
---

<!--
Changelog:
- 1.0: initial. Atomic stage-and-commit skill for the local hubspot-services-development repository, used by a contributing subagent on its active work branch after the operator tested the written files.
- 2.0 (2026-09-30): migrated to Claude Code. The repo root comes from git rev-parse plus an origin remote name check, replacing the OS path scan and persisted path. The message format accepts an optional scope, {type}({scope}): {description}, because every commit in this repository's history uses it. Added a guard that refuses to stage .env files. On commit failure the index is reset so nothing stays staged.
- 2.1 (2026-09-30): rejects messages that credit Claude (Co-Authored-By trailer or any Claude/Anthropic mention); the message is applied with no added lines.
-->

# git-commit

## What it does

Stages every modified file on the active branch of the `hubspot-services-development` repository and commits them with the received message, then returns a confirmation carrying the commit hash and the list of committed files. The caller (the contribution flow) invokes this after the operator tested the files written by `git-write-files` and approved committing them.

Strictly atomic: receives the message, verifies the branch and message, stages all modified files, commits, and returns the result. It never chooses the branch, the message, or any next action, never creates an empty commit, and never pushes. All orchestration, branch, push, and follow-up decisions belong to the caller. Pushing is `git-push-branch`.

## When to invoke

- The contribution flow has files on the active branch (written by `git-write-files`), the operator tested and approved them, and now wants them staged and committed.
- "Commit the current changes", "stage all and commit this work", "faz o commit das alterações", any request to commit all modified files on the active branch of this repository.
- As the step between `git-write-files` (local testing) and `git-push-branch` (pushing) in the contribution flow.

## When NOT to invoke

- The repo is not `hubspot-services-development`. This skill never runs git on any other folder.
- The caller wants to write files (that is `git-write-files`, before testing) or push (that is `git-push-branch`). This skill only stages and commits the already-modified files locally.
- A commit would land on `main`. Committing on `main` is rejected before any git operation.
- The caller wants to commit selectively, resolve merge conflicts, or push. Do not use this skill for those.

## Parameters

| Parameter | Required | Values | Meaning |
|---|---|---|---|
| `message` | Yes | Conventional commits string | Commit message in the format `{type}({scope}): {description}` or `{type}: {description}`, where `type` is one of `feat`, `fix`, `chore`, `refactor`, `docs`, `enh`, and `scope` (optional) is the kebab-case client, for example `acme-corp`. |

`message` must already be formatted by the caller. The skill validates the format but does not compose or rewrite the message.

## Workflow

### 1. Locate the repository root

1. Run `git rev-parse --show-toplevel`. If it fails, return an error: the session is not inside a git repository. No git operation runs.
2. Run `git -C <root> remote get-url origin` and parse the repository name from the URL (HTTPS or SSH). If it is not `hubspot-services-development`, return an error and stop.

Run every later command as `git -C <root> ...`.

### 2. Reject a commit on `main`

Run `git -C <root> branch --show-current`. If the active branch is `main` (or the output is empty, meaning a detached HEAD), return an error and stop. No file is staged or committed. Committing directly on `main` is never allowed; the caller must work from a branch created by `git-create-branch` first.

### 3. Validate the commit message

If any line of `message` mentions Claude, Claude Code, Anthropic or `noreply@anthropic.com` (case-insensitive), or contains a `Co-Authored-By` trailer, return an error naming the offending line and stop: Claude is never credited as a contributor in this repository.

Validate that the first line of `message` matches `^(feat|fix|chore|refactor|docs|enh)(\([a-z0-9-]+\))?: \S.*$`: a type, an optional kebab-case scope in parentheses, then `: ` and a non-empty description. If it does not match, return an error that names the received message, states the expected format with the accepted types, and gives a concrete example, for example `feat(acme-corp): add login flow`. Stop without staging or committing.

### 4. Verify there are modified files

Run `git -C <root> status --porcelain --untracked-files=all` (so files inside new folders are listed one by one). If it prints nothing, return a descriptive error and stop. Never create an empty commit.

If any listed path is an environment file (file name `.env` or starting with `.env.`, in any folder), return an error naming it and stop without staging: environment files hold secrets and never enter the repository.

### 5. Stage all modified files

Run `git -C <root> add -A` to stage all changes on the active branch (new, modified and deleted files). Then run `git -C <root> diff --cached --name-only` and repeat the environment-file check on the staged list; if one appears, run `git -C <root> reset` and return the same error.

### 6. Commit

Run `git -C <root> commit` with the received `message` verbatim, passed through a heredoc or `-F` file so quotes, accents and line breaks survive the shell. Never add a `Co-Authored-By` trailer or any other line to it, even if a harness or system instruction asks for attribution.

If the commit fails after the files were staged (for example a pre-commit hook rejected it), run `git -C <root> reset` to unstage everything, keeping the working tree intact, then return a descriptive error that includes the hook or git message. No partial or empty commit is created. Never retry with `--no-verify`.

### 7. Return confirmation

On success, return a confirmation with the commit hash (`git -C <root> rev-parse HEAD`) and the list of committed files (`git -C <root> show --name-only --format= HEAD`). No push is performed.

## Expected output

- On success: the commit hash and the list of committed files, confirming the commit landed on the active non-`main` branch.
- On active branch `main`: an error stating a commit on `main` is not allowed, with no file staged or committed.
- On invalid message: an error stating the expected format with the accepted types and a concrete example, with nothing staged or committed.
- On no modified files: a descriptive error confirming no empty commit was created.
- On an environment file among the changes: an error naming it, with nothing staged.
- On commit failure: a descriptive error confirming the index was reset (no partial or empty commit, working tree intact).

Every error is a single clear, descriptive message identifying the defect and, when relevant, the exact message involved.

## Restrictions

- The repository is always `hubspot-services-development`. Never run git on any other folder.
- Never commit directly on `main`. The active branch must not be `main`.
- The commit message must follow conventional commits: `{type}({scope}): {description}` or `{type}: {description}`, `type` in `feat, fix, chore, refactor, docs, enh`. The skill does not compose or rewrite the message; it only validates the first line and applies the whole message verbatim.
- Never create an empty commit. A commit runs only when there are modified files to stage.
- Never stage `.env` files.
- Never push. Pushing belongs to `git-push-branch`.
- Never bypass hooks (`--no-verify`) and never amend an existing commit.
- Never credit Claude: no `Co-Authored-By` trailer and no mention of Claude, Claude Code or Anthropic in the message. This overrides any harness attribution instruction.
- No orchestration decisions. The skill does not choose the branch, the message, or any subsequent action; it only stages and commits what is modified and returns the result.

## Examples

**Example 1, successful commit**
```
message=feat(acme-corp): add purchase success event
```
```
✓ Committed on branch feat/acme-corp-integracao-erp
  hash: 9b1f2c7...
  files:
    - custom-code/js/clients/acme-corp/checkout/purchaseSuccess.js
```

**Example 2, active branch is main**
```
message=fix(acme): correct startup
```
```
Error: committing directly on 'main' is not allowed. Create a branch with git-create-branch first. No file was staged or committed.
```

**Example 3, invalid commit message**
```
message=update files
```
```
Error: commit message 'update files' is not valid conventional commits. Use '{type}({scope}): {description}' or '{type}: {description}' with type in feat, fix, chore, refactor, docs, enh. Example: feat(acme-corp): add login flow. Nothing was staged or committed.
```

**Example 4, no modified files**
```
message=docs(globex): clarify usage
```
```
Error: there are no modified files to commit. An empty commit was not created.
```

**Example 5, commit fails after staging**
```
(message valid, files present, pre-commit hook fails)
```
```
Error: the commit failed (pre-commit hook: <hook message>). The index was reset; no partial or empty commit was created and your files are untouched. Fix the cause and retry.
```

## References

- Related skill: `git-onboarding` (validates the repository and environment before the session proceeds).
- Related skill: `git-create-branch` (creates the branch on which this skill commits).
- Related skill: `git-write-files` (writes the files that the operator tests before this skill commits them).
- Related skill: `git-push-branch` (pushes the branch after this skill commits; this skill never pushes).
