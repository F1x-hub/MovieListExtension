# API key management and quota dashboard

Date: `2026-08-26`
Status: `proposed design — awaiting user review`

## 1. Outcome

Add an admin-only API-key management surface that lets an administrator:

- see which provider credentials exist;
- see a human-readable label and purpose for each credential;
- add a new credential without exposing stored values;
- enable, disable, test, and eventually revoke a credential;
- see provider-reported quota where it exists and a truthful status where it
  does not.

The first enabled provider is Kinopoisk. The contract remains extensible for
TMDB and Spotify, but they are not enabled until their credential boundaries
are migrated safely.

## 2. Current baseline

- `functions/kinopoiskProxy.js` reads the aggregate `KINOPOISK_API_KEYS`
  Secret Manager value and rotates through an array on upstream rejection.
- `functions/index.js` owns `kinopoiskProxy`, `tmdbProxy`, and the admin-only
  `firestoreUsage` function.
- `src/shared/config/kinopoisk.config.js` intentionally exposes no client key.
- `src/pages/admin/admin.html` already owns the Firestore usage pane.
- `src/shared/services/AdminService.js` is the client owner for admin requests.
- The completed plan `docs/aegis/plans/2026-08-25-kinopoisk-secret-proxy.md`
  establishes Secret Manager and `kinopoiskProxy` as the credential boundary.

The current Kinopoisk array loses key identity, purpose, individual status, and
per-key quota. The existing Firestore dashboard is project-level usage and is
not a provider-key quota view.

## 3. Non-negotiable boundaries

1. Raw provider credentials never enter Firestore, the extension bundle,
   `chrome.storage`, browser DOM after submit, or logs.
2. The browser may submit a new credential once over the authenticated HTTPS
   admin endpoint, but the response never returns the raw value.
3. All provider API traffic remains behind the existing server-side proxy
   owner. No direct client fallback is added.
4. Admin authorization is checked on the server using the Firebase ID token
   and the admin profile, not only by hiding the admin UI.
5. A quota value is shown only with its source and measurement time. When a
   provider does not expose a remaining quota, the UI says so instead of
   inventing a number.
6. Disable is reversible. Destructive secret deletion requires an explicit
   confirmation and is not the default action.

## 4. Canonical data ownership

### Secret Manager — credential values

Store one Secret Manager secret per managed credential. The generated secret
name is referenced by an opaque `keyId`; it is never derived from the raw key.
The runtime service account needs only the minimum Secret Manager permissions
needed to create versions, access active versions, and revoke versions.

### Firestore — registry metadata and audit

Use `systemApiKeys/{keyId}` for non-secret control metadata:

```js
{
  provider: "kinopoisk",
  label: "Основной Kinopoisk",
  purpose: "Поиск и загрузка карточек фильмов",
  status: "active", // active | disabled | invalid | quota_exhausted
  fingerprint: "sha256:…",
  maskedValue: "••••A91F",
  secretName: "provider-key-kinopoisk-<opaque-id>",
  createdAt,
  createdBy,
  updatedAt,
  lastCheckedAt,
  lastSuccessAt,
  lastFailureAt,
  lastErrorCode
}
```

The fingerprint is used for duplicate detection and never permits recovery of
the credential. A separate `systemApiKeyAuditLogs/{eventId}` collection stores
actor, action, key ID, provider, result, and timestamp; it never stores a key
value or authorization header.

Firestore rules allow this registry only to admins. The extension still uses
the management Cloud Function as the write path so Secret Manager and registry
updates are coordinated in one server-side owner.

## 5. Server contract

Add an admin-only HTTPS function in the existing Functions owner, for example
`providerKeysAdmin`. It uses the same CORS and `verifyAdminRequest` pattern as
`firestoreUsage`.

Supported operations:

- `GET ?action=list` — safe metadata, masked values, current status, and quota
  summaries;
- `POST { action: "add", provider, label, purpose, secret }` — validate,
  health-check, create Secret Manager version, then write the metadata record;
- `POST { action: "test", keyId }` — test server-side and update status;
- `POST { action: "disable", keyId }` — remove the key from the runtime pool;
- `POST { action: "enable", keyId }` — re-enable only after a successful
  health check;
- `POST { action: "revoke", keyId }` — disable first and revoke the active
  secret version after confirmation;
- `GET ?action=quota&keyId=...` — call the provider adapter server-side and
  return only a normalized quota DTO.

The function response must be schema-checked so no accidental `secret`,
`Authorization`, or upstream credential field can cross the boundary.

## 6. Runtime key pool

Extract the key-selection responsibility from the current inline array loop
into a small server-side provider-key pool used by `kinopoiskProxy`.

The pool will:

- load active registry entries and Secret Manager values with a short in-memory
  TTL and in-flight request deduplication;
- select only `active` keys;
- return an internal `{ keyId, value }` pair to the proxy transport;
- record sanitized success, rejection, rate-limit, and network outcomes;
- skip disabled or quota-exhausted keys;
- invalidate its local cache after a management mutation when possible;
- never persist one Firestore write per provider request.

The existing public Kinopoisk client contract and bounded retry behavior stay
unchanged. Runtime telemetry is aggregated through server logs/metrics or
explicit quota checks rather than creating a Firestore write for every request.

## 7. Quota semantics

The normalized response is:

```js
{
  mode: "provider_exact" | "local_estimate" | "unavailable",
  unit: "requests" | "pages" | "requests_per_second" | null,
  used: number | null,
  limit: number | null,
  remaining: number | null,
  status: "normal" | "warning" | "critical" | "unavailable",
  measuredAt: string | null,
  stale: boolean
}
```

For Kinopoisk, the adapter should use the provider token-information endpoint
where the response contains quota fields. The official documentation exposes
`/v1.5/token`; the current proxy allowlist is `/v1.4/`, so this check must stay
server-side and use an explicit provider adapter.

For TMDB, the first implementation should show request-rate status and recent
429 information, not a daily remaining counter. TMDB documents that its old
40 requests per 10 seconds limit was disabled and that an approximate
40 requests per second ceiling may change.

For Spotify, show authentication/health status only until the client secret is
moved out of the extension. No numeric remaining quota should be presented
without a provider source.

The existing Firestore usage cards remain separate and continue to represent
project-level storage, reads, and writes.

## 8. Admin workflow

### List

The new `API-ключи` pane shows provider, label, purpose, masked fingerprint,
status, last check, quota mode, and actions. The raw value is never rendered
after the add request completes.

### Add

1. Admin chooses provider, label, purpose, and enters the credential.
2. The form explains that the value will be shown only during entry.
3. The server validates the provider format and performs a bounded health check.
4. On success, the server stores the value and returns only safe metadata.
5. The new row shows `Активен` or a precise failure state.

### Disable/revoke

Disable is the normal incident response and is reversible. Revoke is a
destructive, two-step action with the provider, label, and masked fingerprint
shown in the confirmation. Failed revocation leaves the key disabled and
reports that the secret still needs operator cleanup.

### Loading and failure states

The pane needs explicit loading, empty, partial-quota, permission-denied,
validation-error, duplicate-key, provider-unavailable, and retry states.
Errors shown to the admin are localized and never include provider responses
that might contain sensitive material.

## 9. Migration

1. Rotate/revoke the currently exposed Spotify client secret before enabling
   Spotify management.
2. Read the existing aggregate `KINOPOISK_API_KEYS` only on the server and
   import each value into an individual Secret Manager secret. Generate opaque
   IDs, fingerprints, and temporary labels such as `Импортированный ключ 1`.
3. Verify every imported key through the provider adapter.
4. Switch `kinopoiskProxy` to the new pool in one deployment.
5. Confirm authenticated requests and key rotation in production.
6. Disable the old aggregate secret. Destroy it only after the rollback window
   and operator confirmation.

No client-side migration or fallback to the old aggregate secret is allowed.

## 10. Testing and acceptance

### Security contracts

- non-admin receives 401/403 for every management operation;
- raw secrets never appear in function responses, Firestore documents, logs,
  DOM after submit, `dist`, or test snapshots;
- duplicate fingerprints are rejected;
- disabled keys are not selected by the runtime pool;
- a failed revoke cannot silently report success.

### Provider contracts

- Kinopoisk key add/test/disable/rotation works with mocked Secret Manager and
  provider responses;
- quota adapter distinguishes exact, stale, estimated, and unavailable data;
- provider errors are normalized without leaking upstream bodies;
- existing proxy auth, allowlist, retry, and circuit-breaker tests remain green.

### UI contracts

- keyboard-accessible add form and confirmation dialog;
- associated labels, field errors, `aria-invalid`, and live status updates;
- responsive table/card layout without horizontal overflow;
- no secret value remains in inputs or state after a successful save.

Required checks: targeted key-management tests, `npm run test:admin`,
`npm run lint`, `npm test`, `npm run build`, and an authenticated browser smoke
test against a test/staging function. No production deploy or secret rotation
belongs in the implementation task without separate confirmation.

## 11. Alternatives considered

### Raw Firestore credentials — rejected

It would be simple to implement but would make the extension, Firestore reads,
backups, and admin tooling part of the secret boundary.

### One aggregate Secret Manager JSON — compatibility-only

It preserves the current `KINOPOISK_API_KEYS` shape but makes individual
revocation, concurrent admin updates, key identity, and per-key audit harder.
It may be used only as the migration source, not as the final owner.

### One Secret Manager secret per key — selected

It gives each key an independent lifecycle, maps cleanly to a stable `keyId`,
and supports individual disable/revoke and quota checks. It requires a narrow
Secret Manager IAM grant for the management function, which is an explicit
deployment prerequisite.

## 12. Review notes

### TaskIntentDraft

- Outcome: safe admin management of provider credentials and truthful quota
  visibility.
- Scope: existing Firebase Functions, Secret Manager, Firestore admin rules,
  `AdminService`, and admin UI; Kinopoisk first.
- Non-goals: production deployment, automatic provider billing changes,
  exposing secrets, or rewriting Firestore usage metrics.
- Stop condition: design is ready when ownership, secret lifecycle, quota
  semantics, migration, and acceptance tests are explicit.

### BaselineUsageDraft

- Required refs: `.agents/rules/agent.md`, the completed Kinopoisk Secret Proxy
  plan, `functions/index.js`, `functions/kinopoiskProxy.js`,
  `src/shared/services/AdminService.js`, admin HTML/CSS, and Firestore rules.
- Missing authority: provider-specific numeric quota contracts for TMDB and
  Spotify; these remain `unavailable` until verified by adapters.
- Decision: continue to user review; do not implement before approval.

### ImpactStatementDraft

- Owners: `functions/index.js` / new server key-management module for the
  server contract; Secret Manager for values; Firestore for metadata/audit;
  `AdminService` and `src/pages/admin` for the UI.
- Preserved invariants: no client credentials, existing proxy API, bounded
  retries, admin-only access, and project-level Firestore usage semantics.
- Architecture signal: this is a durable owner/contract/security change and
  must be reviewed before implementation.

### Architecture integrity verdict

Aligned with the existing Secret Manager proxy plan. The selected design adds
one management path and one runtime pool under the existing server owner; it
does not add a client credential store or a second provider transport.
