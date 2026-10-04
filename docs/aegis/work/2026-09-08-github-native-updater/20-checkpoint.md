# Checkpoint — GitHub Native updater hardening

## TodoCheckpointDraft

- Completed: added Setup and apply mutexes.
- Completed: rejected stale Setup downgrades using the embedded updater version.
- Completed: added journal progress, executor PID/start-time tracking, stale recovery,
  and one temporary recovery directory.
- Completed: verified the activated manifest version before confirmation and cleaned
  operation artifacts after success.
- Completed: registered Chrome and Edge user-level Native Messaging hosts.
- Completed: fixed the UpdateService throttled-check promise lifecycle and duplicate
  apply handling.
- Completed: manual forced checks re-run after joining a throttled background check,
  with a VM regression test for the race.
- Completed: require Native Host 1.1.4+ before update execution and derive
  minUpdaterVersion from the compiled host source during release metadata generation.
- Completed: register a one-shot per-user RunOnce recovery command before replacement,
  with explicit recovery_required state when the old folder cannot be restored.
- Completed: persist cleanup_pending and retry locked staging, recovery, and input files
  on the next Native Host status or confirmation request.
- Completed: serialize startup reconciliation before release checks and monitor long
  native operations through a dedicated background alarm.
- Completed: moved Firebase auth and token preflight before GitHub draft creation and
  added three-attempt transient OAuth retry coverage.
- Completed: reran focused updater tests, full npm test, lint, Release .NET build,
  package-release, archive inspection, and Setup file-version inspection.
- Next: perform browser smoke testing on Chrome and Edge and validate the published
  release from a second Windows profile.

## Evidence refs

- Parent plan: `docs/aegis/plans/2026-09-08-github-native-updater.md`
- Native Host: `native-host/Updater/Program.cs`
- Coordinator: `src/shared/services/UpdateService.js`
- Contracts: `tests/updaterSetupContract.test.js`, `tests/updateService.test.js`

## DriftCheckDraft

- Scope remains inside the parent plan's updater boundary.
- No Windows startup process was added; browser-launched Native Messaging remains
  the lifecycle owner. RunOnce is temporary and exists only while one operation can
  require crash recovery.
- No persistent user-visible backup history was added; recovery is operation-scoped.
- Native Host self-update is explicitly outside this slice and remains residual risk;
  the new extension requires one manual migration to the current Setup executable.

## Status

`verified-for-handoff`

## Verification receipt

- npm run test:update-service: passed.
- npm run test:updater-setup: passed.
- npm run lint: passed.
- npm test: passed.
- dotnet Release build: passed with 0 warnings and 0 errors.
- npm run package-release: passed and produced a non-empty ZIP plus Setup executable.
- ZIP listing contains a root manifest.json and no ./-prefixed entries.
- MovieListSetup.exe ProductVersion: 1.1.4.0.
- One-shot recovery and cleanup-pending contracts are covered by updater static tests.
- Background operation alarm is routed through `src/background/background.js`.
