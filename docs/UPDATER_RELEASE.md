# Windows updater release

The extension is distributed as an unpacked Chrome installation. Users download only
`MovieListSetup.exe` (MovieList Hub). On first run the hub downloads the latest signed
extension release, validates its signature, size, SHA-256, archive paths and manifest
key, installs it and registers the Native Messaging host; Chrome still needs one manual
**Load unpacked** action because it does not let programs add unpacked extensions.
Later versions are found by the extension and installed by the hub after a safe
playback check. The hub window (`--setup`, Start-menu shortcut) uses WebView2 and the
extension's `src/shared/styles/theme.css` and `tokens.css`, embedded at build time;
without the WebView2 runtime the plain WinForms connection form opens.
Settings also expose a manual action that uses the same signed production path as
automatic updates. It never accepts a path from the UI and never installs a release
that is equal to or older than the installed version.

Setup is persistent per Windows user: it registers the Native Messaging host for
Chrome and Edge and does not need to be run after a reboot or for each release. The
host is started by the browser only when the extension sends a request; no permanent
MovieList updater process or Windows startup entry is required. Only one Setup window
and one file-replacement operation may run at a time. During replacement, one
temporary recovery directory is kept and removed after the new version is confirmed;
it is not a growing backup history.

Before the replacement starts, the host writes a one-time `HKCU\...\RunOnce`
recovery command for the current operation. It is removed after confirmation or
rollback and is not a permanent startup process. If Windows or the browser stops
mid-replacement, the next user logon can restore the previous extension folder;
when restoration is impossible, the updater reports `RECOVERY_REQUIRED` and blocks
another replacement until the journal is repaired.

`native-host/Updater/MovieListUpdater.csproj` `<Version>` is the only updater version
source: the host reads it from its assembly, and `generate-component-metadata.js`
parses it to validate the built probe. Running a newer hub replaces the permanent
`%LOCALAPPDATA%\MovieListExtensionUpdater\MovieListUpdater.exe` once (never a
downgrade). Signed `update.json` and the component catalog carry the protocol floor
`minUpdaterVersion` 1.1.4, not the current updater version; raising it forces every
user through a manual Setup run, so change it only for a real protocol break.

The hardened updater requires MovieListSetup.exe version 1.1.4 or newer. A user
who already connected an older Setup must run the current Setup once, select the same
extension folder, and click **Connect automatic updates**. This is a one-time
migration; future extension releases do not require reinstalling the Setup executable.
Component capability migration also supports legacy 1.1.4 installations: current
Setup repairs an equal-version host only when its component probe is missing.

Before the first signed release, generate a release key pair once:

```text
node scripts/generate-update-signing-key.js
```

The script updates the public verification key embedded in the Native Host and
creates `update-signing-private.pem`. Copy the private key into the GitHub Actions
secret `UPDATE_SIGNING_PRIVATE_KEY`; never commit the private file.

To publish a version:

1. Update the extension `manifest.json` to a three-component Chrome version such as `1.3.3`.
   Finalize `src/shared/config/whatsNew.js` for that exact version: move the approved
   `next` draft to the real version, remove `draft`, and supply 3–6 short highlights
   in Russian and English. For a deliberately quiet patch, add an explicit
   `skipAnnouncement: true` entry instead. Run `node scripts/validate-whats-new.cjs`.
   Drafts remain preview-only and are never treated as published announcements.
   The six bilingual highlights approved by the owner on 2026-10-10 are published
   under `1.3.6`, with their approved text unchanged.
2. Commit the change and create a matching tag such as `v1.3.3`.
3. Push the tag. `.github/workflows/release.yml` builds the extension, removes local
   configuration, publishes the self-contained setup executable, and signs the
   immutable release metadata.
   The workflow installs Chromium before browser regressions and builds the
   GitHub release description from that exact version's README changelog block
   with `scripts/create-release-notes.cjs`; it preserves the project's headings
   and links to the previous version's comparison instead of generating commit noise.
4. Give users `MovieListSetup.exe` for the one-time connection. They select the
   folder containing `manifest.json`, then load that same folder in Chrome.
   If Chrome was already open while setup registered the Native Messaging host,
   fully restart Chrome before testing the extension connection.

The Native Messaging manifest uses the exact extension origin with a trailing `/`;
wildcards are not valid in `allowed_origins`. The release workflow also runs the
regression and updater contract tests, verifies that the signing secret matches the
public key embedded in the Native Host, and publishes assets through a draft release
before making the release visible. The ZIP is validated to contain a root-level
`manifest.json` and no `./`-prefixed paths so Windows Explorer can display it.

The signed metadata keeps the GitHub release URL for compatibility and adds the
Firebase Hosting mirror at
`https://movielistdb-13208-updates.web.app/updates/latest/MovieList-extension-latest.zip`.
The Native Host tries the mirror and then GitHub with bounded retries, while
checking the signed size and SHA-256 before extraction. The release workflow
copies only the newest extension ZIP, metadata and signature to a dedicated
Hosting site using `firebase.updates.json`. `MovieListSetup.exe` remains in the
GitHub release because Spark blocks Windows executable files. Ordinary player deployments do not
touch this site. Configure `FIREBASE_SERVICE_ACCOUNT` (service account JSON with
Hosting deployment and version deletion permissions) in GitHub Actions. Create
the site `movielistdb-13208-updates` in project `movielistdb-13208` once before the
first release. Hosting must permit EXE distribution (Spark restricts executable
files). No credentials are stored in this repository.

The service account used by GitHub Actions must have the project roles
`roles/firebasehosting.admin` and `roles/serviceusage.apiKeysViewer`. The first
role permits Hosting deployment and version cleanup; the second is required by
the Firebase CLI when it reads project configuration.

The repository secret must contain the complete JSON object, including
`project_id`, `client_email`, and `private_key`. Add it in GitHub under
**Settings → Secrets and variables → Actions → New repository secret** with the
exact name `FIREBASE_SERVICE_ACCOUNT`; do not paste the JSON into the workflow.
The release job validates this secret before creating a draft release, and a
rerun resumes a draft left by an interrupted job. If the selected tag already
has a published non-prerelease, the job replaces only that release's generated
generated assets with the files built from the current tag; this supports
recovering an interrupted or stale release without creating a second version.
Prereleases are rejected. The error
`The GitHub Action workflow must specify exactly one of "workload_identity_provider" or "credentials_json"`
means that `FIREBASE_SERVICE_ACCOUNT` was empty or unavailable to the workflow.
The workflow uses the service-account key file for Firebase CLI authentication
and exchanges a short-lived JWT directly with Google's OAuth endpoint for the
Hosting cleanup API. It therefore does not require granting the service account
the `roles/iam.serviceAccountTokenCreator` role on itself.
Firebase authentication and the short-lived token exchange run before a GitHub
draft is created; transient OAuth failures receive three total attempts.

The extension retries each metadata file up to three total attempts, then fetches
both metadata and signature from the mirror. The Native Host verifies the signature
before trusting any download. Existing installations must run the 1.1.4 Setup once;
old extensions without metadata fallback need the mirror ZIP installed manually
if GitHub is entirely unreachable during migration.

Release jobs are serialized. Mirror preparation rejects older versions and different
ZIP content for the same version, and fails closed when the deployed version cannot
be read. After deployment, public files are downloaded and compared with local
release artifacts. Cleanup deletes only finalized historical versions on the dedicated
site, excluding the active version and rechecking its identity before each deletion.
The retention setting is also bounded to one previous release (the API minimum);
explicit deletion removes older archive content. Storage reclamation may be asynchronous.
Do not publish manually to this site concurrently with a release job.

HTTP 404 and integrity failures switch sources immediately. Transient network and
408/429/5xx failures retry up to three attempts per source; disk write failures stop
the operation. Header waits are bounded to 15 seconds, idle reads to 30 seconds,
each transfer to two minutes and the download operation to ten minutes.

## Component updates

`components.json` and `components.json.sig` are a separate RSA-PSS/SHA-256 signed
stable catalog. Each component has its own version, exact immutable GitHub asset
URL, SHA-256, size and compatibility requirement. The old `update.json` feed is
still published for older extension clients. A missing component catalog does not
disable that feed. Component checks run even when the extension is current.
The API-v1 compatibility floor remains 1.1.4 independently of newer updater
patch versions; change that floor only for a real protocol compatibility change.

Settings expose independent updater and Suite automatic-update switches, on by default.
The extension decides when to update; the hub applies the signed component. An absent,
damaged or unversioned Suite is installed or repaired only on an explicit user action
(hub **Установить медиаплеер** / **Восстановить установку**, or Settings
**Установить**): the hub downloads the signed Setup and starts its interactive wizard,
which elevates itself and keeps the original user. A component journal in
`recovery_required` never blocks extension updates; a new explicit attempt or
**Сбросить ошибку** (`dismiss_component`) replaces it. An extension swap that Chrome
does not activate is closed by the extension (`abandon`) or expires after 24 hours.
The native updater inventories the exact HKLM-registered Suite and committed
`current/suite-version.json`; missing Suites are skipped and unknown legacy
versions require a one-time full manual Setup. Current MovieListSetup upgrades a
legacy equal-version 1.1.4 host only when it lacks the component capability probe.
Future updater releases need a strictly greater native project/CLI version.

A full Suite Setup installs `MediaPlayerSuiteUpdateService` as SYSTEM, preserving
the original user's SID and per-user DPAPI/Native Messaging registration. Its
protected named pipe accepts only status and signed Suite descriptors from that
owner; the broker downloads and verifies the fixed installer itself. No caller
command or executable/destination path is accepted. Background updates never ask
for UAC. A missing broker requires manual setup/elevation; its version must not be
guessed from an HTTP failure. A known stopped service is updated only when there
is no listener or orphan server, probed temporarily and returned to stopped.

Suite upgrades gate new playback and download resumes before draining viewers,
snapshot the closed database/WAL and configuration, rename the old runtime on the
same volume and commit only after the registered service's process ancestry and
version/build readiness match. Failed activation restores the old runtime, broker,
configuration and database. Downloads and the saved download folder are preserved.
The detached protected worker survives the broker service's stop/replacement.
Temporary pipe connection/read timeouts during that replacement remain retryable
until the operation deadline. Activation and stopped-service checks read the
validated port from the protected installed environment configuration.

A healthy full manual Setup can reconcile a previous `recovery_required` journal
after the installer exits. Reconciliation requires a fresh committed manual
transaction, matching runtime identity and the actual service state; it preserves
the failed-operation diagnostic instead of replaying its installer. Work caches
retain active/recovery operations and bounded terminal rollback/diagnostic files;
safe later operations prune obsolete GUID work directories without following
reparse points. Independent preference writes use an origin-wide Web Lock shared
by Settings pages and the service worker.

`npm run package-release` builds MovieListSetup. With the production signing
secret configured, `npm run generate-component-metadata` signs the catalog and
validates the updater's compiled probe. An extension-only release preserves the
previous verified Suite descriptor and its original immutable URL. To include a
Suite, explicitly provide these release-environment values before packaging and
signing:

```text
MEDIAPLAYER_SUITE_ASSET=<fresh MediaPlayerSuiteSetup.exe absolute path>
MEDIAPLAYER_SUITE_VERSION=<actual Suite package.json and Inno AppVersion>
MEDIAPLAYER_SUITE_API_MAJOR=1
MEDIAPLAYER_SUITE_BUILD_ID=<buildId from that bundle-version.json>
```

The release workflow uploads both catalog files and an explicitly supplied Suite
asset. It does not build the sibling MediaPlayer repository automatically; make
that artifact available to the release job before using these variables. Never
reuse a published Suite version for different installer bytes. Verify both native
public keys (`ReleasePublicKey` and MediaPlayer update-host `ReleaseKeys.PublicKey`)
match before a Suite release. Key rotation requires an explicit migration of both
trust roots; do not regenerate a key as ordinary release housekeeping.

Run `npm run test:component-updates`, native Updater.Tests and the MediaPlayer
upgrade/broker fixtures before release. Local build and fixture success do not
establish clean-machine installation, cross-account UAC behavior or a published
signed update round trip.
