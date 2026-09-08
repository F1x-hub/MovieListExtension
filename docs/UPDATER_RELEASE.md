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

The hardened updater requires MovieListSetup.exe version 1.1.0 or newer. A user
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

1. Update `package.json` and `manifest.json` to the same `MAJOR.MINOR.PATCH` value.
2. Commit the change and create a tag such as `v1.3.0`.
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
