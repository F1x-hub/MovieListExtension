# Windows updater release

The extension is distributed as an unpacked Chrome installation. The first setup
requires `MovieListSetup.exe` and one manual Chrome **Load unpacked** action. Later
versions are downloaded and installed by the updater after a safe playback check.
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

The hardened updater requires MovieListSetup.exe version 1.1.4 or newer. A user
who already connected an older Setup must run the current Setup once, select the same
extension folder, and click **Connect automatic updates**. This is a one-time
migration; future extension releases do not require reinstalling the Setup executable.

Before the first signed release, generate a release key pair once:

```text
node scripts/generate-update-signing-key.js
```

The script updates the public verification key embedded in the Native Host and
creates `update-signing-private.pem`. Copy the private key into the GitHub Actions
secret `UPDATE_SIGNING_PRIVATE_KEY`; never commit the private file.

To publish a version:

1. Update the extension `manifest.json` to a three-component Chrome version such as `1.3.3`.
2. Commit the change and create a matching tag such as `v1.3.3`.
3. Push the tag. `.github/workflows/release.yml` builds the extension, removes local
   configuration, publishes the self-contained setup executable, and signs the
   immutable release metadata.
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

The repository secret must contain the complete JSON object, including
`project_id`, `client_email`, and `private_key`. Add it in GitHub under
**Settings → Secrets and variables → Actions → New repository secret** with the
exact name `FIREBASE_SERVICE_ACCOUNT`; do not paste the JSON into the workflow.
The release job validates this secret before creating a draft release, and a
rerun resumes a draft left by an interrupted job. The error
`The GitHub Action workflow must specify exactly one of "workload_identity_provider" or "credentials_json"`
means that `FIREBASE_SERVICE_ACCOUNT` was empty or unavailable to the workflow.
The workflow uses the service-account key file for Firebase CLI authentication
and exchanges a short-lived JWT directly with Google's OAuth endpoint for the
Hosting cleanup API. It therefore does not require granting the service account
the `roles/iam.serviceAccountTokenCreator` role on itself.

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
