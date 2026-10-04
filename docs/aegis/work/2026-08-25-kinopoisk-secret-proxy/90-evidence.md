# Evidence Bundle Draft

## Evidence action / result / scope

- `npm run lint` — exit 0; all source and content-script JavaScript.
- `node tests/kinopoiskProxy.test.cjs` — exit 0; auth, allowlist, 401/403
  rotation, bounded 5xx/429 retry, success relay, and error contracts.
- `node tests/kinopoiskQuotaCircuitBreaker.test.cjs` — exit 0; client proxy
  response mapping, auth/quota/rate/server/network failures, local breaker.
- `npm test` — exit 0; full existing regression suite plus new pretest contracts.
- `npm run build` — exit 0; clean copy and minification completed.
- Secret/permission scans — no old exposed keys; no direct Kinopoisk API hosts in
  manifest/DNR; no client-side `X-API-KEY`.
- `node -e ... require('./functions/index.js')` — exit 0; proxy export verified.
- `git diff --check` — exit 0.
- `firebase functions:secrets:set KINOPOISK_API_KEYS --format json` — created
  Secret Manager version 1; secret contents were not printed.
- `firebase functions:secrets:describe KINOPOISK_API_KEYS` — version 1 is
  `ENABLED`.

## Uncovered scope

- No live Firebase deployment was performed.
- No live authenticated browser request against the deployed proxy was performed.

## Residual risk

The operator must deploy the proxy before extension installation. Previously
exposed keys remain operational until manually revoked.

## Confidence grade

`B` — direct implementation and Secret Manager evidence are fresh; live cloud
deployment and credential rotation remain intentionally external.
