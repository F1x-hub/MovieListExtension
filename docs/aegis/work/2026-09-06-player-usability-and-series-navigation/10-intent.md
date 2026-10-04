# Player usability and series navigation — Intent

## Requested outcome

Implement the three player fixes approved by the user on 2026-09-06: subtitle
placement and configuration, centered play control, and working series
previous/next navigation.

## TaskStartSnapshot

The worktree already contained user-owned modifications in the player, settings,
MovieDetails, tests, Firebase, and unrelated feature areas before this task.
This task owns only deliberate additions to the player usability paths, their
focused tests, the new plan/checkpoint, and the README changelog entry.

## BaselineUsageDraft

- Required refs: `CONTEXT.md`, `.agents/rules/agent.md`, universal-selection
  plan, Phase 7 checkpoint, user screenshots.
- Acknowledged before edits: all required refs.
- Cited in plan: all required refs.
- Missing refs: live authenticated provider iframe behavior.
- Decision: continue with focused source and contract evidence; reserve live
  iframe behavior for manual smoke verification.

## ImpactStatementDraft

The change affects local player presentation and the bridge between embedded
controls and the canonical MovieDetails navigation owner. It does not alter
provider discovery, remote data, watch-room synchronization, or progress schema.

## Execution Readiness View

- Intent lock: fix player usability only.
- Scope fence: no provider parser redesign or player-surface restyle.
- Owner constraint: controller owns episode state; cleaner requests direction.
- Compatibility: existing subtitle track selection and canonical picker remain.
- Verification: focused contracts, lint, build, and manual player smoke test.
