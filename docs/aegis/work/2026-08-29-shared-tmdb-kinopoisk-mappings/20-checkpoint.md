# Checkpoint

Current todo: completion verification; production Firestore deployment remains external.

Completed: baseline review and plan audit; validated Firestore rules; shared forward and reverse
lookups; cloud-first manual writes; conflict-safe legacy publication; focused regression tests.

Evidence: `npm run test:shared-mappings`, `npm run test:admin`,
`node tests/idMappingService.test.js`, and `npm run lint` pass.

Drift check: within scope. No live data deletion, provider behavior change, or guest-access
expansion was introduced. The old local cache remains a bounded compatibility cache.

Next: deploy Firestore rules through the approved Firebase release process, then verify the
two-account acceptance scenario in the target Firebase project.
