# 0004. Keep Riverpod and the feature-first structure in the Flutter app

- Status: accepted
- Date: 2026-11-25
- Decided by: the engineer (within the owner-approved plan)

## Context

The Flutter team's guidance (flutter/agent-plugins) recommends ChangeNotifier view
models with provider/get_it and a layer-first folder layout. The app already uses
Riverpod 3 and feature folders, with a solid networking layer and 754 tests. The audit
found real problems, but in boundaries and duplication, not in the state library.

## Decision

Keep Riverpod 3 and `lib/features/<feature>/{data, domain, presentation}` with shared
code in `lib/core`. Adopt the Flutter team's principles (thin views, repositories as the
single source of truth, mapping API models to domain models, tests per notifier and
repository) and enforce two boundaries in CI: no imports between features, no literal
user-facing strings outside l10n.

## Consequences

- No rewrite; problems are fixed in stages M1–M3.
- Advice written for ChangeNotifier is translated to Notifier/AsyncNotifier.

## Alternatives considered

- Adopt the Flutter team's architecture literally: rewrites working, tested code for no
  user-visible gain.
