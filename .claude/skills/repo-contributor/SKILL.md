---
name: repo-contributor
description: Entry point for the repo-contributor contribution flow on the hubspot-services-development repository, run in the current conversation so every operator gate works. Loads the flow from the repo-contributor agent and follows it from environment validation to PR merge, in Portuguese and plain language, with an explicit confirmation before each git step. Use when an operator wants a change delivered to this repository ("fiz uma correção e quero subir pro repositório", "crie um card novo pro portal do cliente", "a branch tá pronta, abre o PR", "pode mergear").
argument-hint: "[descrição da mudança]"
---

<!-- Changelog:
- 2.0 (2026-09-30): created during the migration to Claude Code as the in-conversation entry point of the repo-contributor flow.
- 2.1 (2026-09-30): the flow moved to .claude/agents/repo-contributor.md, the single source of truth. This skill now only loads that file and runs it in the main conversation, where the gates can stop for the operator.
-->

# repo-contributor

1. Read `.claude/agents/repo-contributor.md` from the repository root (`git rev-parse --show-toplevel`). If it is missing, stop and tell the operator, in Portuguese, that the contribution flow is not installed in this repository.
2. Follow that file's instructions as your own for the rest of this flow: Identity, Operating principles, Gates, Workflow and Output format. You are in the main conversation, so the "Main session" execution context applies and every gate ends your turn.
3. Treat the text passed with the command as the operator's change request: `$ARGUMENTS`. If it is empty, ask what they want to change, in one plain-language question.
