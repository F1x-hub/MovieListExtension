# Torrent playback integration

User-authorized implementation following the read-only Lampa/MSX comparison.

## Shared contracts

- Keep the extension's canonical movie/season/episode state and existing progress owner.
- MediaPlayer owns tracker credentials, torrent locators, files, downloads and conversion.
- `POST /api/playback/prepare` resolves a server-issued source to opaque file IDs and a recommended file. TV recommendations require an exact episode match.
- Playback sessions accept optional file/episode selection and an audio stream index. Saved downloads preserve their selected file across restarts.
- Session-bound track discovery exposes audio metadata and supported text subtitles; pending subtitle conversion is explicit.
- Native installation discovery checks only the registered bridge's own Suite. Manual folder selection remains available.
- Older MediaPlayer installations retain the existing movie playback path; new features are capability gated.

## Acceptance

1. Files from a multi-episode torrent remain distinct through playback and durable storage; changing a file must not prune another active episode.
2. Audio changes preserve position and paused state, and incompatible audio does not force compatible video through re-encoding.
3. Subtitle requests validate the session and stream, are bounded, and distinguish unsupported bitmap formats from pending text tracks.
4. Disabling or superseding setup/playback invalidates stale asynchronous results.
5. Run backend tests, lint and build; extension lint, full tests and build; installer provisioning/native checks; rendered dark/light narrow/wide checks.
6. Produce an updated local installer when packaging succeeds. Packaging and fixture playback do not establish clean-machine installation or live tracker reliability.

## Continuity

Extension checkout initially had only pre-existing untracked `.claude/`, `.firebase/`, `.vs/`, `artifacts/`, `audit-output/`, `scratch/`. MediaPlayer is not a Git checkout; touched baseline files are saved under its `.artifacts/*baseline/` directories. Existing ffprobe track metadata preceded this task.

## Verification and limits

- Extension lint, complete `npm test` (including pretest), `test:media-player`, build and `git diff --check` passed. New selection tests cover exact/ambiguous/stale episode selection, warming an audio replacement, paused-state retention and canonical progress using full duration.
- MediaPlayer lint, typecheck, TypeScript build and all 23 test files / 120 tests passed after the security updates. Generated H.264/AAC/AC3/SRT fixtures verify the selected audio frequency, video copy, subtitle conversion, session expiry and unauthorized access. Torrent fixtures cover distinct durable episodes, restart, shared-file pause and deletion preservation.
- Compiled Native Host detection and installer provisioning checks passed. Windows runtime bundle built successfully with pinned asset verification. Inno Setup compiled `.artifacts/installer/MediaPlayerSuiteSetup.exe` successfully; this remains a local installation candidate, not an installed or published release.
- Chromium rendered the production file chooser in both themes at 1366x768, 1920x1080, 390x844 and 910x512. This is fixture QA. The current browser connector cannot claim `chrome://extensions`, so the user's installed extension was not reloaded or tested.
- No live tracker playback or clean-machine Windows install/upgrade was performed. No services, existing downloads, account settings or release versions were changed; nothing was committed or published.
- Full Lampa plugin compatibility and arbitrary seeking beyond prepared HLS are not implemented. An offset-remux experiment failed actual Chromium timeline verification and was removed; late audio switching may require preparation and keeps the previous session after its bounded timeout. Supported text subtitles become available only after file completion; bitmap subtitles are unsupported. Incompatible codecs may require lossy conversion; source dimensions are preserved.
- Follow-up security review updated Fastify, every fast-uri copy, ip-address and affected development tools. Backend lint/typecheck and 23 files / 120 tests passed, including exploit regressions. Production audit now reports four high package warnings for one unchanged `ip.isPublic` advisory; the inspected tracker consumer only uses `ip.toString`, and the client does not run a tracker server. The complete development audit also retains the old esbuild development-server chain under Drizzle; that server is not invoked by project scripts. See the [security and implementation review](../../../../MediaPlayer/docs/security-audit-2026-10-23.md) for applicability, upstream sources and re-review conditions. No incompatible WebTorrent downgrade was applied; this is not a zero-warning security claim.
- Browser review reproduced blocked cross-origin VTT tracks. The client now fetches only the selected, validated session VTT into a bounded local Blob track, aborts and revokes obsolete resources, retains subtitle choice through audio replacement and ignores stale saved-playback errors. Fresh `test:media-player` passed, including real extension Chromium VTT cues, lazy language selection, audio restoration, revoked URLs, invalid MIME/path/content, redirects, oversized fixed/chunked bodies, body deadline and detach cancellation. The browser test uses its own generated media and temporary listener; it needs no sibling MediaPlayer checkout or running service.
- After the follow-up fixes, extension lint, complete `npm test` (including pretest), `test:media-player`, build and tracked `git diff --check` passed again. Logs are in `scratch/torrent-security-*.log`. The rebuilt Windows staging tree was separately audited: Fastify 5.12.7, fast-uri 4.2.3 / 3.1.9 and ip-address 10.7.4 are present, while Vite, Vitest and Drizzle Kit are absent. Production staging audit has the same four inherited `ip` warnings.
- The initial security-only runtime bundle and Inno installer compiled after the dependency fixes: 452,650,210 bytes, SHA-256 `92785f55019526acbe18237ad62af2bcddc45e082830ee4e696d540d2bba0674`. That earlier candidate is superseded by the component/storage installer recorded below. It was not installed or published.

## Approved scope — component updates and download folder

Status: implementation authorized on 2026-10-23. Requirements below remain acceptance targets; see implementation tracking for current verification.

### Component updates

- Use a signed release catalog with independent versions and compatibility requirements for the updater, extension and MediaPlayer Suite. Check each component even when the extension is already current; retain the existing release feed for older clients during migration.
- Add updater self-update through a separate helper that survives the old process, verifies the replacement, and preserves a working version until activation is confirmed. Existing users need a one-time Setup migration to acquire this capability.
- Update MediaPlayer only after confirming an existing Suite installation. Distinguish installed, running, ready and version; an unavailable service is not an absent installation. Recheck before activation so an uninstalled Suite is not reinstalled automatically.
- Before enabling automatic Suite updates, add reliable version/build identity, configuration migration, config/SQLite backup, candidate activation and readiness/version-gated rollback. Preserve downloads, their recorded paths and the user's chosen download folder.
- Defer activation during playback; preserve download states and resume only downloads that were active before maintenance. Keep deliberately paused downloads paused.
- Fully unattended administrative updates require a one-time installation of a narrowly scoped update service/helper. Preserve per-user Native Messaging registration and DPAPI pairing; machine-level upgrade must not rerun first-user setup as SYSTEM. Otherwise use explicit Windows elevation for each Suite upgrade.

### Download folder in MediaPlayer settings

Current baseline: MediaPlayer reads `TORRENT_DOWNLOADS_PATH` from server configuration. The settings API and UI expose retention, but do not provide a download-folder setting or picker. The existing Suite installation-folder picker selects the application, not the location of films.

- Add **Settings → MediaPlayer → Папка для фильмов и сериалов** with the current path, a native **Выбрать папку** action, and explicit save/cancel feedback. This folder stores downloaded movies, episodes and their partial torrent files; it does not relocate the Suite, configuration, SQLite or HLS cache.
- Persist the effective download root in MediaPlayer-owned settings through an authorized local/native flow, rather than as a browser-only preference. Do not synchronize local filesystem paths to the cloud. Coordinate precedence with `TORRENT_DOWNLOADS_PATH` so the displayed and actual destinations agree.
- Validate the absolute destination, disk availability, free space and actual write access for the MediaPlayer service account before applying it. Use a dedicated media directory; provision only the necessary permissions through the authorized Windows helper, without widening access to drive roots, system folders or unrelated parent directories. Cancellation, validation failure or an unavailable disk must preserve the previous setting and produce a clear message.
- Apply the new root to newly created torrent stores. Existing active/shared stores retain their original paths so playback, downloading and episode selection are not interrupted. Reopening, resuming and deleting older downloads must continue to use their recorded locations.
- Changing the setting does not move or delete existing files. Migration of completed or partial downloads is a separate future action requiring an explicit user choice; it is not part of the initial folder setting.
- Preserve the chosen folder across application restarts, updater self-updates, MediaPlayer upgrades and recovery. Installer defaults must not overwrite a saved custom path. If the selected disk becomes unavailable, report it without silently downloading to another drive.

Acceptance criteria for the future implementation:

1. Select and save a folder containing spaces and non-Latin characters; new torrent stores appear there and the setting survives restart and Suite upgrade.
2. Cancel selection, choose a read-only folder, disconnect the target disk or encounter insufficient space; show an actionable error without losing the previous setting or silently using a different path.
3. Change the folder with active, paused and completed downloads present; existing files remain playable/resumable/deletable in their original locations and manually paused items stay paused.
4. Verify the settings flow in dark/light themes and narrow/wide layouts, plus service-account permissions and upgrade preservation on Windows. Keep fixture and installed-system evidence separate.

## Implementation tracking — 2026-10-23

- User authorized both the download-folder setting and component update plan. Preserve earlier torrent/security changes; no commit, publication, release version bump or replacement of installed services is authorized by this implementation step.
- Download-folder backend/UI/native picker and explicit original-user ACL grant are implemented. Validation checks actual service write access and free space, rejects unsafe/alias/system paths, preserves retained/shared torrent locations and reports offline custom storage. Review corrected the Windows Program Files default-path regression. The helper grants access only to a safe folder owned by the current user, preserves parent ACLs and never elevates.
- Root implemented a protected file maintenance handshake: request.json is written by the update broker, LocalService only updates pre-created readiness.json, playback creation and download resume are gated before a safe acknowledgement, and original active downloads recover after the request is cleared. Backend /ready now reports version/build identity.
- Native updater/catalog/broker and component Settings controls are implemented. Atomic executable replacement, locked/running-image retries, protected owner/parent ACL validation and independent Suite version/build verification passed targeted checks. Signed catalogs retain the legacy extension feed; component auto-update settings are separate opt-ins, initially off. API-v1 compatibility remains independent of future updater patch versions.
- Transactional installer/provisioning and runtime marker generation are implemented. The protected broker accepts only signed fixed-component descriptors and survives its service's replacement through a detached worker. Both broker and elevated UPGRADEONLY installer enforce backend maintenance before stopping services. Failure while waiting does not stop playback during rollback. Activation confirms the actual registered service's process ancestry before committing; closed config/SQLite/WAL snapshots restore failed candidates. Known stopped services return to stopped. Missing/legacy Suites never become automatic fresh installs.
- Working backups: extension `scratch/component-update-baseline/`, MediaPlayer `.artifacts/component-update-baseline/`. Work remains in the existing shared checkouts; unrelated concurrent profile/achievement changes were preserved. No commit, release version change, publication or live service installation was performed.

## Component/storage verification — 2026-10-23

- Extension lint, complete `npm test` including pretest, `test:media-player`, `test:update-service`, `test:component-updates`, release/setup contracts and production build passed. A stale stylesheet classification for the concurrently added achievements stylesheet was corrected without changing that feature. Component regressions include old terminal extension journals not cancelling component polling and deferred maintenance retries. Logs: `scratch/component-*.log`.
- Backend lint/typecheck and all 25 files / 134 tests passed. Migration fixtures preserve legacy retention/indexer settings and download-folder overrides. A pre-existing asynchronous transcode-test cleanup race was fixed by waiting for HLS completion before deleting its fixture.
- Compiled native detection, folder selection/cancellation and original-user permission fixtures passed. Native updater tests verify catalog signature/key/origin/identity/size/version/duplicate-property rejection, atomic replacement/rollback, real locked files and a running Windows executable, and same-version capability migration. Broker tests verify maintenance leases, pipe ACLs, protected ancestors and an actual kill-on-close Windows job: the detached worker survives; denied breakaway fails closed.
- Installer provisioning checks and Windows PowerShell 5.1 transaction fixtures passed for absent/root/external-database rejection, busy-playback no-mutation, closed snapshots, successful commit, failed-health rollback, interrupted extraction, preserved downloads/config/database/broker and process-ancestry checks. These are fixtures, not installed service proof.
- A read-only check against this Windows installation's actual Program Files/drive ACLs caught an inherit-only ACE false positive in installer ancestor validation. The check now evaluates effective ancestor rights, ignores inherit-only entries and rejects generic write/full-control where applicable; the real default parent check and transaction fixtures pass. No system ACLs were changed.
- The fresh Windows staging bundle built with pinned assets and production-only dependencies. `verify-staged-suite` started its bundled Node/backend on a fixture-owned port and database, verified build `81cdf2395d9f42ede2a79fed6cff5ae42c06c47fd2daa8d4c7101dc58fc37909` in headers/body, saved a Cyrillic/spaced folder through authenticated HTTP, restarted with a changed default and retained that folder, and verified maintenance startup blocking and release. It used no live settings, services, trackers or credentials.
- Settings Chromium fixtures passed in dark/light themes at 1280/375 widths, including preview/save/cancel, stale responses, access-denial retry, old service/host, missing Suite, migration/UAC hints and independent opt-ins. Screenshots: `artifacts/mediaplayer-download-folder/` and `artifacts/component-updates-settings/`. This does not establish a reload of the user's installed extension.
- The local updater candidate is `artifacts/component-updates/MovieListSetup.exe`, compiled native version 1.1.4 with component protocol 1. A legacy 1.1.4 host can receive the one-time capability repair; future published updater changes need a greater release version. Production signed catalogs and installer assets have not been published. Clean Windows install/upgrade/rollback, cross-account UAC behavior and a real signed-release round trip remain unverified.
- Earlier local artifacts, superseded by the audit-fix candidates below: `artifacts/component-updates/MovieListSetup.exe`, 116,160,696 bytes, SHA-256 `735ed7f7ba1683e67469355a714cd3be298d4f4ba121bb4304484efe79657eff`; `MediaPlayer/.artifacts/installer/MediaPlayerSuiteSetup.exe`, 641,876,839 bytes, SHA-256 `7a7b73d95249c958b5d3771eab0015019661002e4341f476a11a5a9d1bd3fc29`. Inno compilation completed successfully after the default-parent ACL correction. This local candidate used `/DSuiteCompression=lzma2/fast`; normal release packaging still defaults to `lzma2/ultra64`. Compression changes packaging size, not playback behavior. Earlier build log: `MediaPlayer/.artifacts/component-installer-final-build.log`.

## Audit fixes — 2026-10-24

The user authorized all ten confirmed findings. Existing unrelated achievements/profile work was preserved. No release versions, installed services, live database, credentials or published assets were changed.

| Finding | Result and regression evidence |
| --- | --- |
| LocalService cannot write clean-install logs | Grant Modify to the configured log directory before the configuration-only return; real inherited ACL checks cover existing and new log files. |
| Expected broker restart falsely fails an update | Retry pipe connect/disconnect/read timeout and cancellation until the deadline; explicit rejection and local journal errors remain failures. Real short pipe timeout and deterministic deadline tests cover both outcomes. |
| Manual repair leaves recovery permanently blocked | A healthy full manual transaction records a fresh receipt. Broker reconciliation requires the installer mutex, matching committed identity and real service state; the native journal follows its terminal result. Preserve the original failure diagnostic. |
| Credential elevation reads another user's LocalAppData | A successful original-user helper creates one fresh, token-user-owned non-secret handoff; elevated provisioning seals only validated identity/digest into the protected transaction. Test stale collisions, elevated default ownership, hostile ACLs, aliases and sharing locks. |
| Failed first install leaves new SCM registrations | Snapshot absence, stop/remove only newly created Suite-owned services before discarding runtime, and reject foreign same-name services. SCM lifecycle is simulated in an isolated fixture. |
| Readiness uses a different port from the installed configuration | Installer, broker and updater validate the preserved local `PORT`; reject duplicates, malformed values and remote URLs. Test a real custom-port listener and protected effective ACLs. No alternate-port fallback was added. |
| Old episode continues after session revocation | Pause and dispose only the old video's owned HLS/media, detach progress/subtitles, invalidate stale work and revoke on provider changes. Tests retain a newer player's HLS. |
| Overlapping audio changes lose playback intent | Keep the old stream while warming; only the latest request can swap, using current user pause/play/seek/volume state. Test reversed replies, stale progress and preparation failure. |
| Settings windows overwrite independent update choices | Re-read/merge/write under an origin-wide Web Lock. Real Chromium extension pages and a service worker concurrently persist all three choices; a rejected write releases the lock. |
| Component work files grow without cleanup | Prune obsolete direct GUID terminal work while retaining active/recovery journals, current workers and bounded latest rollback/diagnostic data. Real fixtures cover 530 directories, malformed journals, junctions, locked files and a running mapped EXE. |

Fresh extension lint, full `npm test` including pretest, `test:media-player`, `test:update-service`, `test:component-updates` and production build passed. Final backend lint/typecheck and all 25 files / 135 tests passed with one worker after the Zod patch. An earlier two-worker run had two initial test/hook timeouts (132 tests passed); it is retained in `.artifacts/audit-fixes-backend-test.log`, and the complete final run is `.artifacts/audit-fixes-backend-test-final.log`.

Fresh native updater and broker regression suites, Windows PowerShell 5.1 installer/provisioning fixtures passed. These use real local files, ACLs, locks, pipes, mutexes and mapped executables, with simulated SCM; they do not establish a real WinSW/LocalService start, cross-account UAC, clean Windows install/rollback or a published signed-release round trip. Live tracker playback and a reload of the user's installed extension remain unverified.

The packaging audit also surfaced [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), updated upstream on October 23. Zod was the only package changed, from 4.5.4 to 4.6.7. Indexer request schemas use constrained arrays, so the follow-up regression verifies early rejection of 10,000-item input without element traversal or unbounded issue accumulation, while valid input still receives normal validation. The production warning count returns to the four inherited `ip` chain entries documented in the security review; this is not a zero-warning claim. The installer bundle was rebuilt after this dependency change.

The final staging bundle contains Zod 4.6.7 and build `a5fe5166fdfb69387636c72bafd1c4c72532cfea64c0caf9366c8999dade61d5`. Its bundled Node/backend passed `verify-staged-suite`: matching build readiness, authenticated Unicode/spaced folder save, persistence after restart/default change, and maintenance startup gate/release. Logs: `MediaPlayer/.artifacts/audit-fixes-windows-bundle-final.log` and `audit-fixes-staged-suite.log`.

Final local candidates (2026-10-24):

- `artifacts/component-updates/MovieListSetup.exe`: 116,172,984 bytes; SHA-256 `fe11d75e7acc6e8d00bc5556591c838b85dfedd7abd08af00849157df5a71e2b`. Its compiled probe reports native version 1.1.4 and component protocol 1. Publish log: `scratch/audit-fixes-updater-publish.log`.
- `MediaPlayer/.artifacts/installer/MediaPlayerSuiteSetup.exe`: 641,971,344 bytes; SHA-256 `511b8ecf0b0e4043a578e75b503000fb62724873888ed7800d18d23cfe770148`. Inno Setup 7 completed successfully with local `/DSuiteCompression=lzma2/fast`; the release default remains `lzma2/ultra64`. Compile log: `MediaPlayer/.artifacts/audit-fixes-inno.log`.

These are rebuilt local candidates, not published releases or proof of installed Windows behavior. Versions were not bumped. A future published updater change still requires a greater native release version, and immutable published Suite versions must never be reused for different bytes.

## Legacy installation relocation — 2026-10-24

The reported Recover failure was reproduced through read-only path validation:
the registered Suite is under `D:\programs\MediaPlayer Suite`, while its parent
is owned by the ordinary user. There was no upgrade journal. Validation rejected
that unsafe parent before checking for a journal, and Setup replaced the actual
error with a misleading interrupted-transaction message. No installed services,
registry values, databases or system ACLs were changed during diagnosis.

The user selected migration into Program Files with settings and films retained.
Full Setup now proposes the protected location and requires migration consent;
silent migration and playback interruption have separate explicit flags.
No-journal recovery is a read-only no-op, while actual journals still require
protected ancestors and ownership. A bounded, create-new diagnostic gives the
wizard the underlying failure instead of the generic Recover error.

Relocation copies configuration and the closed database/WAL into the protected
target, installs fresh pinned executables and rebinds only verified Suite services.
Film paths stay unchanged. Its separate protected journal restores old service
and uninstall registrations after failure, leaving the old services stopped with
manual startup and retaining data for retry. The old uninstaller is retained;
after success use Windows Apps or the new installation's uninstaller.

Migration handoff checks the current profile's pairing digest against the copied
configuration and preserves the previous maintenance owner SID when present.
Legacy runtime/loader environment hooks are rejected before service mutation;
the migrated service uses the fresh pinned runtime with production/loopback
settings. A partial original-user registration failure also triggers metadata
restoration. Declined consent returns a nonempty installer failure before
extraction can start.

Fresh backend lint, Windows PowerShell 5.1 parsing, upgrade/migration fixtures,
installer provisioning and cold location-diagnostic checks passed. Fixtures
cover no-consent/no-mutation, identity mismatch, runtime hooks, foreign services,
occupied targets, reparse paths, database/WAL byte and film-path preservation,
custom-port health and failed activation. Recovery also covers Inno having
already changed InstallLocation to the target and a service removed during a
failed reinstall. The real LocalService log ACL check runs only on fixture files;
SCM/HKLM actions are mocked. Inno Setup 7 accepted the final script.

This work changes installer sources in the sibling MediaPlayer project and these
integration notes. It does not publish a release, bump versions, perform the
live migration, or establish UAC/SCM/WinSW installation behavior.

The replacement local Suite candidate compiled successfully with Inno Setup 7
and `lzma2/fast`: `MediaPlayer/.artifacts/installer/MediaPlayerSuiteSetup.exe`,
641,979,354 bytes, SHA-256
`644055a84f07c9dad041564a179d802f548e5942e21a825e44e273bf1c5cc7f3`.
The output copy has the same hash as the freshly compiled candidate. This
supersedes the earlier Suite candidate above; the updater candidate is unchanged.
The runtime build remains
`a5fe5166fdfb69387636c72bafd1c4c72532cfea64c0caf9366c8999dade61d5`:
this follow-up changes Setup scripts, not application runtime dependencies.
Compile log: `MediaPlayer/.artifacts/legacy-migration-inno.log`.
