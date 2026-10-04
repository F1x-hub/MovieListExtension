# Modular Error System — Checkpoint

## TodoCheckpointDraft

- Completed: baseline read, error-core, provider modules, localized dialog, quota status.
- Completed: movie-details, Home, person-details wiring and GamesModal normalization path.
- Active: verification and review of dirty-worktree-safe diff.
- Next: run targeted tests, inspect task-owned diff, update changelog.

## Evidence

- `node tests/errorSystem.test.js` — passed.
- `node tests/htmlScriptModuleContract.test.js` — passed.
- `node tests/personDetailsUI.test.js` — passed after compatibility fallback.
- `npm run lint` — passed.

## DriftCheckDraft

- Scope: within modular user-visible error handling boundary.
- Compatibility: old page error markup remains as fallback; provider request logic untouched.
- New owners: `src/shared/errors/*` is the canonical error presentation owner.
- Decision: continue to verification.

## Risk / Unknown

- Full browser visual verification still required for English/Russian dialog rendering.
- Other page-specific error owners remain on the migration backlog.
- Full `npm test` is blocked by an unrelated pre-existing `anchor.closest is not a function`
  failure in `tests/offscreenScraper.test.js`.
