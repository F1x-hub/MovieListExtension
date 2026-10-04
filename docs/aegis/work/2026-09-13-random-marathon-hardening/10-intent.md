# Random marathon hardening — 2026-09-13

## User-visible goal

Make the shared Random-page movie marathon reliable for multi-user collection,
administrator-controlled random selection, per-user display names, and adding
movies from the device-local random pool.

## Scope

- Harden the current Random Marathon service, UI, Firestore rules, and focused tests.
- Preserve the existing `randomPool` storage contract and unrelated dirty worktree changes.
- Keep the current single-round product model unless an implementation constraint requires a bounded compatibility change.

## Explicit non-goals

- No reset, cleanup, stash, checkout, commit, push, or broad formatting.
- No migration or deletion of existing Firestore data in this slice.
- No change to the device-local personal random pool ownership.

## Acceptance criteria

- Collection closes after the administrator starts the round and the server rejects late writes.
- A normal participant cannot exceed three active proposals; an administrator has no proposal cap.
- State transitions cannot select two films or resolve a stale current film.
- Author display follows each author's `displayNameFormat` and username setting.
- Pool-to-marathon controls update immediately and show actionable errors.
- Focused contracts, lint, and build checks pass; remaining live browser/Firebase gaps are reported.

## Baseline and boundaries

- Root: `D:/Programing/JS/Projects/MovieListExstension`
- HEAD: `d7bc50b3216eaabfacdd0e5a21d22db37b3861f9`
- Branch: `master`
- Pre-existing dirty worktree is preserved.
- Required owners: `RandomMarathonService.js`, `random.js`, `random.html`, `random.css`, `rules/firestore.rules`, focused tests.

## Change necessity

The requested reliability and permission behavior cannot be guaranteed by the
current client-only count checks and stale snapshot reads. A code change is
required; the minimum boundary is to harden the existing service/rules/UI and
add focused regression coverage without replacing the personal pool owner.

## Complexity and verification posture

- Artifact class: existing shared service plus page wiring and Firestore rules.
- Pressure: service and page are already mixed-purpose; keep edits local and do not add a second runtime owner.
- Decision: edit in place for local fixes and use the existing Firebase Functions owner for the server mutation boundary.
- TDD mode: off; user approved implementation plan, but no strict test-first authority was requested.
