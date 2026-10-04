# Random marathon hardening evidence

## Initial evidence

- `git rev-parse --show-toplevel` confirmed the MovieListExstension root.
- `git rev-parse HEAD` returned `d7bc50b3216eaabfacdd0e5a21d22db37b3861f9`.
- `git branch --show-current` returned `master`.
- `git status --short --untracked-files=all` confirmed a pre-existing dirty worktree with unrelated changes and marathon files.
- `git worktree list --porcelain` showed the current workspace only.
- Existing focused checks from the preceding audit: `randomMarathonContract.test.js`, `randomPageHardening.test.js`, `npm run lint`, and `git diff --check` passed.

## Fresh verification

- `node tests/randomMarathonFunction.test.cjs` passed, including the in-memory transaction test for three-item quota, admin exemption, removal, and slot reuse.
- `node tests/randomMarathonContract.test.js` passed.
- `node tests/randomPageHardening.test.js` passed.
- `npm run test:random-marathon` passed.
- `npm run lint` passed; `npx eslint functions/randomMarathon.js` passed.
- `npm run build` passed; generated `dist` copies parsed with `node --check`.
- `node --check` passed for `functions/randomMarathon.js`, `functions/index.js`, `src/shared/services/RandomMarathonService.js`, and `src/pages/random/random.js`.
- `firebase deploy --only functions:randomMarathon` completed successfully; live function is `https://us-central1-movielistdb-13208.cloudfunctions.net/randomMarathon` and reports ACTIVE in `functions:list`.
- `firebase deploy --only firestore:rules` compiled and released `rules/firestore.rules` successfully.
- Live endpoint smoke: approved extension origin OPTIONS returned `204` with the expected CORS headers; unauthenticated POST returned `401 AUTH_REQUIRED`; disallowed origin returned `403 ORIGIN_NOT_ALLOWED`.
- After the final input-validation/auth patch, `firebase deploy --only functions:randomMarathon` completed a successful update and the same live smoke returned `204`, `401 AUTH_REQUIRED`, and `403 ORIGIN_NOT_ALLOWED`.
- Live invalid-token smoke returned `401 AUTH_REQUIRED`.
- Final post-auth-refresh source/test/build pass repeated after the last client patch; tracked `git diff --check` returned clean.
- `firebase functions:list --json` reports `randomMarathon` `ACTIVE`, `us-central1`, Node.js 22, hash `cb46708f68e02d0719844e1377d12d2c0f915287`.

## Uncovered scope

- The `chrome-extension://` tab could not be inspected by the computer-use surface because Chrome rejected extension-tab automation by policy.
- No authenticated production add/start/roll/resolve smoke was run because no user token was supplied; no Firebase Emulator configuration was found.
- No migration or cleanup of legacy item documents was performed.
