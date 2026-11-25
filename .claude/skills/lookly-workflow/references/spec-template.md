# Spec template

Use for features and stages. Keep it behavioural: no file paths or code, so the spec
stays true while the implementation changes.

```markdown
# <Feature or stage name>

## Problem
What the user or the product cannot do today, in one paragraph.

## Solution
What will be true when this is done, from the user's side.

## User stories
1. As a <user>, I want <capability>, so that <benefit>.
2. ...
(Number every story; cover the unhappy paths: no network, empty wardrobe, AI unavailable,
quota reached, session expired, consent required.)

## Decisions
- <Decision>: <choice> — <why>. (Owner-approved / default.)

## Contract impact
None | the exact OpenAPI change (new field, new error code) and why the mobile app is
unaffected or how it adapts.

## Testing
- Seam: where the behaviour is tested (as high as possible: HTTP handler for the
  backend, notifier or screen for Flutter).
- Cases that must have a test (one line each).

## Out of scope
- What this deliberately does not do, so nobody "finishes" it by accident.
```
