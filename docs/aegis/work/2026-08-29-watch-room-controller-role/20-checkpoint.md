# Checkpoint

- Current todo: optional two-browser smoke test.
- Completed: server role mutation, RTDB role mirror, timeline rules, runtime authority,
  owner-only popover toggle, bidirectional owner/controller timeline regression without owner source remount,
  focused contracts,
  lint and extension build.
- Evidence: five focused Node contracts pass; `npm run lint` and `npm run build` pass;
  staging rules are released and `watchRoomsStaging` is `ACTIVE` after deployment.
- Blockers: none.
- Next: reload the unpacked extension and test promote → control → demote across two browsers.

## DriftCheckDraft

- Scope: aligned with delegated timeline control only; controller labels are preserved end-to-end.
- Compatibility: owner-only provider control and two-user capacity retained.
- New owner/fallback: none; current owners are reused.
- Decision: continue.
