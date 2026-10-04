# Random marathon hardening checkpoint

## TodoCheckpointDraft

- Current todo: hand off the built extension for manual authenticated browser smoke.
- Completed: audit and written implementation plan; TaskStartSnapshot captured; server mutation endpoint, client wiring, UI hardening, rules, and focused tests implemented.
- Active slice: manual authenticated browser smoke remains outside this environment.
- Next: reload the unpacked extension and exercise admin/user add, start, roll, resolve, remove, and username display flows.

## BaselineUsageDraft

- Required refs: `CONTEXT.md`, `.agents/rules/agent.md`, existing Random Marathon service/page/rules/tests, package scripts.
- Acknowledged refs: all read before editing.
- Missing refs: no existing random-marathon plan file; no Firebase Emulator configuration found.
- Decision: source checks, build, Firebase rules compilation/release, function deployment, and unauthenticated endpoint smoke are complete; live authenticated extension browser checks remain an explicit gap.

## Execution Readiness View

- Intent lock: reliable shared marathon with three-item participant cap, admin exemption, closed collection, random queue, and author display.
- Scope fence: random marathon source/rules/tests only; preserve `randomPool` storage and unrelated dirty files.
- Compatibility boundary: current Firestore collection/document names and existing item fields remain readable.
- Retirement boundary: no old fields or data are removed in this slice.
- Test obligations: focused marathon contract, page hardening, lint, build, and rules/emulator coverage if available.
- Review gate: re-read final diff and separate static evidence from live acceptance.

## DriftCheckDraft

- Decision: continue.
- Current work remains inside the approved feature scope.
- No new runtime owner has been added yet.
- Risk: authenticated end-to-end browser behavior and live multi-user contention remain unverified in this environment; no data migration was run.
