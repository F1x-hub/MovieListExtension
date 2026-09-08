# Windows updater release

The extension is distributed as an unpacked Chrome installation. The first setup
requires `MovieListSetup.exe` and one manual Chrome **Load unpacked** action. Later
versions are downloaded and installed by the updater after a safe playback check.
Settings also expose a test-only action that downloads and installs the latest signed
release through the configured Native Host path, even when the installed version is
equal to or newer than that release. It never accepts a path from the UI.

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

The Native Messaging manifest uses the exact extension origin with a trailing `/`;
wildcards are not valid in `allowed_origins`. The release workflow also runs the
regression and updater contract tests, verifies that the signing secret matches the
public key embedded in the Native Host, and publishes assets through a draft release
before making the release visible.
