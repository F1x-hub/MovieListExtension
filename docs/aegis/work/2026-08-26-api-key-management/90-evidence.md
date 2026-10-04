# Evidence Bundle Draft

## Evidence action / result / scope

- Design spec self-review — no TBD/TODO placeholders or vague task phrases.
- Implementation plan self-review — exact file map, task boundaries,
  verification commands, compatibility, rollback, and retirement are present.
- TaskStartSnapshot — captured branch, HEAD, worktree, and pre-existing dirty
  state before implementation writes.
- Backend contracts — admin auth, vault/registry lifecycle, handler safe DTOs,
  provider quota normalization, runtime pool caching, migration dry-run, and
  Kinopoisk proxy rotation tests pass.
- Admin contracts — AdminService transport rejects unsafe responses; the admin
  page exposes add/test/quota/status/revoke controls and clears the secret input.
- Verification — `npm run test:provider-keys`, `npm run lint`, and `npm run build`
  all exit 0.
- Full regression — `npm test` exits 0; existing pretest and test suites pass.
- Browser smoke — `node tests/adminBrowserSmoke.cjs` exits 0 with the admin
  provider-key pane rendered at a 390px viewport; screenshot captured locally.
- Live deployment smoke — `providerKeysAdmin` deploy/update completed; GET
  without credentials returns `401 AUTH_REQUIRED`, preflight returns `204`, and
  `firebase functions:list` reports the deployed endpoint.
- IAM preflight/apply — confirmed no prior Secret Manager roles, added the
  approved lifecycle role for the migration and Functions service accounts.
- Migration — dry-run found 3 unique inputs; apply imported 3 records with no
  existing duplicates and no raw values in output.
- Runtime verification — all 3 registry-linked Secret Manager versions were
  readable; all 3 server-side KP health-checks succeeded.
- Registry-backed proxy — `kinopoiskProxy` update completed after migration.
- Root-cause verification — Secret Manager returned numeric project-number
  resource names; strict project-ID validation rejected all migrated refs.
- Remediation verification — vault normalization was deployed; all 3 live admin
  `test`/`quota` actions returned 200 and authenticated KP proxy returned 200.
- Client recovery guard — quota-breaker persistence moved to a versioned key so
  stale pre-fix cooldown state is ignored after the proxy recovery.

## Uncovered scope

- No TMDB registry migration or aggregate-secret retirement was run.

## Residual risk

The current worktree contains unrelated dirty paths. All execution slices must
limit edits and verification claims to plan-owned files. The aggregate KP
secret remains intentionally active as a rollback bridge until cutover.
