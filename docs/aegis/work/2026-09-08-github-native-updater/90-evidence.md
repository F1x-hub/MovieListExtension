# Evidence — GitHub Native updater hardening

## Verified

- The extension and Native Host coordinate one replacement operation through named
  Windows mutexes.
- Setup refuses to replace a newer installed updater executable.
- Interrupted queued, downloading, or replacing operations carry a journal and can
  recover after the executor disappears.
- Replacement uses one operation-scoped recovery directory and removes temporary
  input, staging, and recovery artifacts after confirmation.
- Native Host status reports both extension and updater versions.
- The extension blocks updates until Native Host 1.1.4+ is installed.
- Release metadata derives minUpdaterVersion from Program.cs, preventing drift.
- Chrome and Edge user-level Native Messaging registration is written by Setup.
- No Windows startup entry or permanent updater process is created.
- A temporary HKCU RunOnce recovery command is registered before replacement and
  removed after confirmation, rollback, or terminal recovery.
- Cleanup failures remain journaled as cleanup_pending and are retried before a new
  update can overwrite the previous operation record.
- Service-worker startup reconciles confirmation and native operation state before it
  starts a new release check; long operations remain observable through an alarm.
- Manual forced checks do not inherit a throttled background result; the race is
  covered by `tests/updateService.test.js`.
- Firebase auth and token exchange complete before GitHub draft creation, and
  transient OAuth failures receive three total attempts.

## Command receipt

- npm run test:update-service — passed.
- npm run test:updater-setup — passed.
- npm run lint — passed.
- npm test — passed.
- dotnet Release build — passed, 0 warnings, 0 errors.
- npm run package-release — passed.
- npm run test:package-release — passed, including OAuth retry and workflow ordering.
- Release ZIP contains root manifest.json and no ./-prefixed entries.
- MovieListSetup.exe ProductVersion is 1.1.4.0.
- UpdateService routes the operation alarm through background.js.

## Residual risk

Native Host self-update remains outside this slice. When a future release requires a
newer Native Host than 1.1.0, users must run the current Setup executable once.
Browser runtime smoke testing with Chrome and Edge, including crash interruption and
second-machine migration, RunOnce behavior after forced termination, and a locked-file
cleanup retry remain deployment acceptance steps.
