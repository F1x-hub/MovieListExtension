# Task intent — GitHub Native updater hardening

## Requested outcome

Make the Windows Native Messaging updater persistent after the first setup,
prevent concurrent Setup/replacement instances, and recover safely from an
interrupted extension replacement without accumulating versioned backup folders.

## Scope fence

- `native-host/Updater/Program.cs` and project version metadata.
- `src/shared/services/UpdateService.js` coordination.
- updater contract tests and release documentation.

## Non-goals for this slice

- Chrome Web Store publication.
- Windows startup/task-scheduler registration.
- Automatic replacement of the Native Host executable itself.
- Changes to the MediaPlayer Native Host.

## Verification

Run the updater contract tests, updater-focused JS tests, JavaScript lint,
the full JavaScript suite, and the .NET build.

