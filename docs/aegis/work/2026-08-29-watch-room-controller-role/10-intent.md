# Intent — delegated watch-room timeline control

## TaskIntentDraft

- Outcome: owner can grant or revoke one guest's shared play/pause/seek rights.
- Success evidence: server authorization, RTDB rules, controller and owner UI
  agree on `owner` / `controller` / `viewer`; focused tests and two-browser
  smoke cover grant and revoke.
- Stop condition: no source/room-management delegation, no new listener or
  storage contract, and all plan verification is complete.
- Non-goals: public rooms, third participant, ownership transfer, chat, source
  control by a guest, session restore and cleanup changes.

## BaselineUsageDraft

- Required refs: approved role spec, executable plan, current service/handler,
  RTDB rules, controller and MovieDetails popover owners.
- Acknowledged before implementation: all required refs.
- Missing refs: none.
- Decision: continue.

## ImpactStatementDraft

- Affected boundaries: server member mutation, staging HTTP action, RTDB
  timeline ACL, shared playback controller and participant UI.
- Canonical owners: service → handler mirror → RTDB rules/controller → UI.
- Compatibility: owner/viewer remains valid; controller never controls provider.
