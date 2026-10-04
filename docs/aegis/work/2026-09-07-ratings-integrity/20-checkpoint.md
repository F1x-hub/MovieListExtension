# Checkpoint — ratings integrity recovery

## TodoCheckpointDraft

- Completed: extracted the shared projection calculator, integrity scanner, admin audit endpoint,
  daily dry-run/optional repair job, client writer cutover, metadata-only rule guards, tests, and
  the live derived-state repair.
- Completed live actions: repaired the eight missing projections from the incident and the separate
  duplicate-user projection for `movies/298`; a full read-only audit now reports zero violations.
- Completed server release: the aggregate trigger, admin audit, daily audit/repair job, backfill,
  and cleanup functions are deployed to `movielistdb-13208`; daily auto-repair is enabled.
- Completed release action: the rebuilt extension source is ready, and stricter Firestore
  aggregate-field guards are deployed after the server trigger and auto-repair rollout.
- Completed post-cutover verification: the live audit reports zero projection violations.
- Next step: monitor the daily audit job and keep the extension build available for client reloads.

## Evidence refs

- Plan: `docs/aegis/plans/2026-09-07-ratings-integrity-recovery.md`
- Existing dedupe logic: `functions/ratingAggregation.js`
- Trigger and audit endpoints: `functions/index.js`
- Integrity scanner: `functions/ratingIntegrityService.js`
- Operator command: `scripts/audit-rating-integrity.cjs`
- Query owner: `src/shared/services/MovieCacheService.js`
- Incident evidence: eight live movie documents were previously observed without aggregate fields;
  one additional duplicate-user projection was corrected after the first repair.

## DriftCheckDraft

- Scope: derived projection ownership, recovery, and prevention are implemented; publication remains.
- Compatibility: preserve numeric/string IDs, canonical rating dedupe, and real timestamps.
- New owner: `buildMovieRatingProjection` is the only aggregate calculator; the scanner consumes it.
- Retirement: client-side movie aggregate writes were removed; Firestore rules reject protected-field
  writes from approved clients once the coordinated release is deployed.
- Decision: implementation verified locally and against the live Firestore dataset.

## Risk / unknown

The exact historical writer remains unknown, but the deployed trigger, daily auto-repair, client
cutover, and protected-field rules now cover the known failure modes. The live repair itself was
derived-only: no rating or review content was deleted or edited.
