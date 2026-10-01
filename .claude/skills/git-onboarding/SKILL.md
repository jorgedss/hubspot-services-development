---
name: git-onboarding
description: Validates at the start of every session that the environment is correctly configured to contribute to the hubspot-services-development repository. Runs three validations in sequence without taking input: the repository is the current git working tree and its origin remote is hubspot-services-development; the GitHub authentication used by the gh CLI is configured and valid; and the configured remote can be reached both over git and through the GitHub API. Reports each failure with concrete fix instructions, waits for operator confirmation, and revalidates only the items that failed until all pass. The session never proceeds while any validation is pending, and the token never appears in output. Triggers: any session start before contributing to hubspot-services-development, "check the environment", "está tudo pronto para operar", "valida o ambiente".
---

<!--
Changelog:
- 1.0: initial. Session-start environment validation skill for contributing subagents on the local hubspot-services-development repository.
- 2.0 (2026-09-30): migrated to Claude Code. Validation A resolves the repository from the current working tree (git rev-parse) and checks the origin remote name, replacing the OS path scan and persisted path. Validation B checks the gh CLI authentication (which honors GITHUB_TOKEN, GH_TOKEN and the keyring) instead of reading the token directly. Validation C checks the git transport (the remote may be SSH, which does not use the token) and the GitHub API separately.
-->

# git-onboarding

## What it does

Validates that the environment is ready to contribute to the `hubspot-services-development` repository, before any other skill in the contribution flow runs. It checks, in sequence and without taking input parameters: (1) the current working tree is a git repository whose `origin` remote is `hubspot-services-development`, (2) the GitHub authentication is configured and valid, (3) the remote can be reached over git and through the GitHub API. It reports every failure with objective fix instructions, waits for the operator to confirm a fix, then revalidates only the failed items, repeating until all three pass.

The session never proceeds while any validation is pending. Orchestration of the actual work still belongs to the caller; this skill only gates the start of the session on a clean environment.

## When to invoke

- At the start of every session in which the flow will contribute (create a branch, commit, push, or open a PR) to `hubspot-services-development`, before any of the contribution skills run.
- "Check the environment is ready", "valida o ambiente antes de começar", "está tudo pronto para operar", "prepara o ambiente", any session-start readiness request for this repository.

## When NOT to invoke

- The repo to operate on is not `hubspot-services-development`. This skill validates only the environment for that repository.
- The session already passed onboarding and the environment has not changed; do not rerun the passed validations.
- Fixing HubSpot portal/account credentials or PAKs: that is `account-safety`. This skill validates the GitHub authentication and the git remote, not HubSpot account auth.

## Parameters

No parameters. This skill operates on the current environment, and never accepts values that would skip a validation.

## Workflow

### 1. Run the three validations in sequence

Run the validations below strictly in order, stopping each one at its own pass or fail, and record only which ones passed and which failed.

**Validation A, the repository is accessible.**
1. Run `git rev-parse --show-toplevel`. It must succeed and return the repository root. Use that root for every later command (`git -C <root> ...`).
2. Run `git -C <root> remote get-url origin` and parse the repository name from the URL (HTTPS `https://github.com/<owner>/<repo>.git` or SSH `git@github.com:<owner>/<repo>.git`). The name must be `hubspot-services-development`.

Pass requires both. A working directory outside a git repository, a missing `origin` remote, or a remote pointing to another repository fails Validation A.

**Validation B, the GitHub authentication is configured and valid.** The `gh` CLI resolves the credential in this order on its own: `GH_TOKEN`, then `GITHUB_TOKEN`, then the keyring from `gh auth login`. Run `gh api user --jq .login`. Pass requires `gh` to be installed and the call to return a login. A missing `gh`, a missing credential, or an expired or rejected token fails Validation B. Do not run `gh auth token` or any command whose output contains the token.

**Validation C, the remote is reachable.** Using the `<owner>/<repo>` parsed in Validation A (never fixed values):
1. Git transport: `git -C <root> ls-remote --heads origin main`. This uses whatever the remote URL requires (SSH key for `git@github.com:` remotes, credential helper for HTTPS).
2. GitHub API: `gh api repos/<owner>/<repo> --jq .permissions.push`. It must return `true`, meaning the authenticated account can push and open PRs.

Pass requires both. No connectivity, a rejected SSH key, a rejected credential, or no push permission fails Validation C.

### 2. If all three pass

Return confirmation that the environment is ready and the session may proceed. Do not print or echo the token at any point.

### 3. If any validation fails

Report clearly which validation(s) failed and what is missing, each with objective fix instructions:

- **Validation A failed:** instruct the operator to open the session inside the cloned `hubspot-services-development` folder, or to clone it with `git clone {url}` and open the session there. If `origin` points elsewhere, instruct them to fix it with `git remote set-url origin {url}`.
- **Validation B failed:** instruct the operator to install the GitHub CLI if missing, then either authenticate with `gh auth login`, or generate a token at `https://github.com/settings/tokens` with the `repo` scope and set it in the `GITHUB_TOKEN` environment variable. The token value is never printed or echoed.
- **Validation C failed:** name which half failed. Git transport: check the internet connection and, for an SSH remote, that the SSH key is loaded and registered on GitHub (`ssh -T git@github.com`). GitHub API: check that the authenticated account has write access to the repository. Do not print the token.

### 4. Wait for operator confirmation

After reporting the failures, stop and wait for the operator to confirm that the cited issue was corrected. Do not assume a fix happened without confirmation, and do not proceed to work while any validation is pending.

### 5. Revalidate only the failed items

Re-run only the validations that failed in the previous cycle. Never re-run a validation that already passed. Do not ask the operator to re-confirm items that are already clean.

### 6. Repeat until all pass

Repeat steps 3 through 5 until every validation passes. If an item fails again after the operator reported a fix, report the same failure with the same instructions and wait for a new confirmation, continuing the cycle until the problem is resolved. The session does not proceed until all three validations pass.

## Expected output

- All three pass: a confirmation that the environment is ready and the session may proceed.
- Any failure: a per-item report naming the failed validation, what is missing, and the objective fix instruction described above, followed by a stop-and-wait for operator confirmation.
- A persistent failure: the same per-item report and instructions again after each confirmed-but-still-failing cycle, with no pass-through until resolved.

At no output point does the GitHub token value appear.

## Restrictions

- The session never proceeds while any validation is pending or failing.
- Only items that failed are revalidated. A passed validation is never re-run in a later cycle of the same session.
- The repository under check is always `hubspot-services-development`.
- The token is never hardcoded and never printed, echoed, logged, or included in any output or returned value. Never run `gh auth token`, `gh auth status --show-token`, or `echo` of a token variable.
- The owner and repository for the remote check come from the `origin` remote, never from fixed values.
- The skill takes no input parameters and never accepts a value that would skip or bypass a validation.

## Examples

**Example 1, all validations pass**
```
Environment ready. The session can proceed.
```

**Example 2, not inside the repository**
```
Validation failed: this session is not inside the 'hubspot-services-development' repository.
  Fix: open the session inside the cloned folder, or clone it with `git clone {url}`
  and open the session there.
  Confirm once fixed.
```

**Example 3, GitHub authentication missing or invalid**
```
Validation failed: the GitHub authentication is missing or invalid.
  Fix: run `gh auth login`, or generate a token at https://github.com/settings/tokens
  with the 'repo' scope and set it as the GITHUB_TOKEN environment variable.
  Confirm once fixed.
```

**Example 4, remote unreachable over git**
```
Validation failed: cannot reach the 'origin' remote over git.
  Fix: check your internet connection and that your SSH key is loaded and registered
  on GitHub (`ssh -T git@github.com`).
  Confirm once fixed.
```

**Example 5, authentication fails again after operator confirmed a fix (cycle repeats)**
```
Validation failed again: the GitHub authentication is still missing or invalid.
  Fix: run `gh auth login`, or generate a token at https://github.com/settings/tokens
  with the 'repo' scope and set it as the GITHUB_TOKEN environment variable.
  Confirm once fixed.
```

## References

- Related skills: `git-create-branch`, `git-write-files`, `git-commit`, `git-push-branch`, `github-create-pr`, `github-merge-pr` (the contribution flow this onboarding gates and that assumes a clean environment).
- Related skill: `explore-repository` (inspects the same repository once onboarding confirms it is present).
- Related skill: `account-safety` (HubSpot account/portal auth, distinct from the GitHub authentication this skill validates).
