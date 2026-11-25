# 0006. Project rules live in CLAUDE.md and project skills; external skills are not vendored

- Status: accepted
- Date: 2026-11-25
- Decided by: the owner

## Context

All code is written by Claude Code across many sessions that do not share memory.
Eight public skill collections were studied (superpowers, mattpocock/skills,
anthropics/skills, flutter/agent-plugins, trailofbits/skills, ui-ux-pro-max,
mobile-stack-skills, nylo mobile-design). Most contain instructions that conflict with
this project's rules (automatic commits, worktrees, English-only interaction, a
different Flutter architecture, a generated colour palette) or with its licence needs
(Trail of Bits is CC BY-SA).

## Decision

- `CLAUDE.md` holds the standing rules and a map of the repository.
- Seven project skills in `.claude/skills/lookly-*` encode the adopted practices in
  this project's terms. `mobile-design` is kept as an unmodified MIT copy with its source.
- Trail of Bits security plugins are enabled through `.claude/settings.json`, pinned to
  a commit, used as tools; their text is not copied into the repository.
- Rules a machine can check move into CI instead of skill text.

## Consequences

- Every session starts with the same rules; changes to the rules are reviewed diffs.
- The skills must be maintained when practices change; stale rules are worse than none.

## Alternatives considered

- Installing the collections as plugins wholesale: conflicting instructions and hooks
  that run on every session.
