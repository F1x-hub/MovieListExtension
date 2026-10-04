# Task intent: player pipeline and canonical episode picker

## Requested outcome

Execute the approved player audit plan by hardening canonical episode selection,
removing the obsolete embedded episode-list UI after its responsibilities are
covered, and verifying parser/player regressions before touching performance tuning.

## Scope

- `src/pages/movie-details/movie-details.js`
- `src/shared/services/player/adapters/BasePlaybackAdapter.js`
- `content-scripts/player-cleaner.js`
- focused player navigation tests and documentation records

Performance discovery, HLS tuning, provider parser changes, and live browser timing
remain subsequent slices after this contract is verified.

## Non-goals

- Do not alter authentication, watch-room persistence, torrent/MediaPlayer behavior,
  provider credentials, or live data.
- Do not edit `dist/` directly.
- Do not reset, stash, clean, or commit pre-existing working-tree changes.

## Baseline usage

- Required: parent audit plan, `.agents/rules/agent.md`, `CONTEXT.md`, current
  navigation/adapter/cleaner sources, focused tests.
- Acknowledged: all listed refs were read before this slice.
- Missing: live browser provider/fullscreen evidence; addressed later.
- Decision: continue with bounded contract repair.

## Compatibility and retirement

`PlaybackController` remains the canonical owner of `PlaybackSelection`. Provider
bridges may remain as external compatibility carriers while they are needed to
select a page's native controls. The obsolete `.episode-list-btn` is internal code
and is eligible for delete-first retirement only after its live responsibilities are
proven covered by the host picker and arrow bridge.

## Acceptance evidence

- A provider bridge result is accepted only for the active request, provider/frame,
  and matching season/episode; dispatched is not the same as applied.
- Stale responses cannot overwrite a newer selection.
- The legacy button is absent from the embedded player when canonical mode is active,
  and the canonical picker remains reachable from the host controls.
- Focused navigation, provider-switch, lifecycle, source, lint, and build checks pass.
