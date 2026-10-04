# Task Intent Draft — ratings integrity recovery

## Requested outcome

Implement the ratings projection recovery and prevention slice from
`docs/aegis/plans/2026-09-07-ratings-integrity-recovery.md`: one canonical aggregate calculator,
a bounded audit/repair path, server ownership, client cutover, protected-field rules, and
verification against the live dataset.

## Scope fence

- In scope now: aggregate calculation, trigger reuse, dry-run and targeted repair tooling, focused
  tests, client writer cutover, protected-field rules, live derived-state repair, and evidence.
- Explicitly out of scope now: deleting ratings or movie documents, and production publication of
  the coordinated client/rules release.
- Preserve all existing dirty worktree changes; only task-owned files may be staged later.

## Baseline usage

- Required refs: `.agents/rules/agent.md`, `docs/aegis/plans/2026-09-07-ratings-integrity-recovery.md`,
  `functions/index.js`, `functions/ratingAggregation.js`, `src/shared/services/RatingService.js`,
  `src/shared/services/MovieCacheService.js`, `rules/firestore.rules`.
- Acknowledged before editing: all listed refs and the current HEAD/worktree snapshot.
- Cited in plan: all listed refs.
- Missing: deployed function/rules revision and Cloud Logging audit for 2026-09-01.
- Decision: continue with bounded implementation; live mutation is limited to derived projection
  merges and has been read back to zero violations.

## Owner and compatibility constraints

`ratings` remains the source of user events. `movies` remains the query projection. The new
calculator is the only aggregate owner for trigger, backfill, and future repair paths. The client
now writes only rating events; metadata caching remains compatible and strips protected aggregate
fields. Existing random-ID legacy ratings remain readable and are deduplicated by the shared
calculator.

## Impact statement

The immediate user symptom is missing rated cards because incomplete movie projection documents
fail the `hasCommunityRating == true` query. The slice makes the repair calculation reusable and
testable. The live incident is repaired by derived-field merges only. The remaining release
boundary is publishing the rebuilt client before enabling the stricter Firestore rule guards for
all users.

## Execution readiness view

- Intent lock: repair projection integrity without modifying rating events.
- Baseline lock: existing deduplication and real-timestamp rules remain authoritative.
- Retirement boundary: client-side aggregate writes were removed from the source; production rules
  must be cut over only after the rebuilt extension is distributed.
- Test obligation: focused pure-function tests plus existing rating regression tests.
- Review gate: inspect diff for pre-existing paths before any live deployment.
- Evidence required: test output, build/lint output, live dry-run with zero violations, and the
  explicit uncovered deployed-state risk.
