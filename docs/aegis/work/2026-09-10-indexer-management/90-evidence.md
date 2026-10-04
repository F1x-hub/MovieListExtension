# Indexer management verification — 2026-09-10

## Fresh checks

| Check | Result | Boundary |
| --- | --- | --- |
| MediaPlayer `npm test -- --maxWorkers=1` | 101/101, 20 files, exit 0 | Backend and related regressions |
| MediaPlayer `npm run typecheck` | Exit 0 | TypeScript |
| MediaPlayer `npm run lint` | Exit 0 | Backend/workspace lint |
| MediaPlayer `npm run verify-installer-provisioning` | Exit 0 | Installer source contracts |
| `scripts/verify-jackett-preservation.ps1` | 4/4, exit 0 | Actual Windows PowerShell CheckOnly execution |
| Extension `npm run test:media-player` | Exit 0 | Client API, torrent library, shared player |
| Extension `npm run lint` | Exit 0 | Extension JavaScript |
| Extension `npm run build` | Exit 0 | Fresh production extension distribution |
| Extension `git diff --check` | Exit 0 | Working-tree whitespace |

The initial fully parallel Vitest run produced four 5-second timeouts in unrelated
route suites. The same 101 tests passed with one worker and unchanged test timeouts.
This is bounded sequential verification, not proof that the default parallel run is stable.

## Installer repair

PowerShell 5.1 enumerated the output of a conditional assignment, making the
existing-file collection null or scalar for zero/one item. `.Count` failed under
StrictMode. The owner is `installer/service/configure-jackett.ps1`; an outer
`@(...)` now preserves an array without adding a fallback or new responsibility.

The regression script invokes the real provisioning script in CheckOnly mode on
isolated fixtures. Empty first install offers the two defaults; one/multiple
existing configs and an empty directory with a provisioning marker skip defaults.
Every case verifies that filenames and contents remain unchanged. The real local
Jackett directory also passed CheckOnly with defaults skipped.

## Bundle and live Jackett readback

- A fresh TypeScript compile into `.artifacts/indexer-verification-dist` matched
  all 41 staged JavaScript modules byte-for-byte; all 6 migration files matched.
- The staged service applied the staged migrations to in-memory SQLite and read
  8 configured indexers from the existing loopback Jackett instance.
- Selection persistence and configuration check passed against that catalog.
  Writes were confined to in-memory SQLite; installed Jackett/MediaPlayer data was untouched.
- The first live request failed to connect; a bounded retry succeeded after an
  independent loopback HTTP check confirmed Jackett was responding.

## Artifact

Final ISCC packaging exited 0: `Successful compile (739.015 sec)`.
The log is `MediaPlayer/.artifacts/indexer-setup-retired-defaults.log` and explicitly includes
the fixed `installer/service/configure-jackett.ps1`.

- EXE: `MediaPlayer/.artifacts/installer/MediaPlayerSuiteSetup.exe`
- Size: 452643091 bytes.
- Last write: 2026-09-10T15:32:01.782Z (19:32:01 Asia/Tbilisi).
- SHA-256: `bffe530979608d1000033757567d029be8355efb387fec4be23a0e6c7724fea3`.
- PE header verification: passed.
- Adjacent `.sha256` and `.verification.json` files record the artifact and relevant input hashes.
- Finalizer `.artifacts/finalize-indexer-setup.mjs`: exit 0.

The earlier partial EXE was replaced by this completed build. Installer execution
was deliberately outside this artifact-delivery verification; source/hash proof is
not clean-VM or installed-upgrade acceptance.

## Scope and acceptance limits

- Indexer selection controls MediaPlayer searches only; add/remove configuration
  remains in Jackett. The test endpoint confirms catalog presence, not tracker health.
- Stale selection is reconciled when the indexer list is refreshed.
- No installed Suite upgrade, clean-VM install/uninstall, or authenticated browser
  UI acceptance was performed in this resumed task.
- Existing user changes remain uncommitted. No versions were bumped.
- The resume repair adds one small fixture-based regression script and corrects one
  provisioning expression. No new runtime dependency, API owner, or credential surface.
- Confidence: B for implementation/bundle verification; installed acceptance remains open.

## User clarification

The current profile already contains only `rutor` and `noname-club`. The live
machine still has four retired files from an older profile; `1337x` and `yts`
contain cookies. The installer therefore keeps those files intact and the user
can remove them explicitly in Jackett. The profile guard and source verifier now
fail if any of the four retired IDs are bundled again.

The profile guard is in `installer/service/configure-jackett.ps1`; the source
contract also checks the JSON profile. The replacement EXE was rebuilt so the
guard is included in the delivered setup binary; its final hash and PE readback
are recorded above.
