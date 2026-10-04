# Checkpoint: ratings Canvas exploration

## Current todo

- [completed] Audit the existing renderer against the approved plan.
- [completed] Implement global radial geometry, dev tuning, hybrid background,
  and LUT-backed inverse hit-test.
- [completed] Add monotonicity, derivative, round-trip, and boundary tests.
- [completed] Verify 255-element geometry, 32-poster loading, hit-test, and build.

## Active slice

Implemented variant A inside the existing renderer owner without introducing a
second state owner or changing the public page-level selection contract.

## Completed work

- Read the parent plan and project rules.
- Captured the task-start Git snapshot.
- Confirmed the current implementation is partially present but needs geometry and
  lifecycle hardening before it can satisfy the plan.
- Added deterministic grid/layout/coordinate helpers and a stable pointer lens.
- Added focused renderer contract coverage in `tests/ratingsSphere.test.js`.
- Repaired the Canvas background so the CSS dot field remains visible.
- Added preview/selected detail labeling and a build-safe poster fallback.
- Added a bounded persistent poster cache: Cache Storage bytes with 24-hour
  timestamps, normalized keys, versioned metadata, and a background fetch path
  that fills the same cache before the direct-image fallback.
- Added cancellation for poster loads that leave the target focus group and paused
  the renderer while the document is hidden.
- Replaced the stretched weighted grid with a compact radial lens that keeps the
  base grid dense, follows the exact `4x/3.3x/2.3x/1.1x/1x` radial checkpoints,
  and preserves poster gutters.
- Added focus-priority poster loading with a four-image-per-frame budget and
  neutral silhouette placeholders before image data arrives.
- Restricted poster decoding and drawing to a maximum 32-item target focus group,
  so fast pointer sweeps do not preload intermediate groups across the field.
- Added low-amplitude deterministic ambient drift and kept the visible RAF loop
  alive after pointer easing settles; reduced-motion mode remains static.
- Updated the mode copy from "Сфера" to "Фокус" so the UI describes the actual
  grid-plus-lens behavior.
- Focused tests, visual contract, HTML module contract, lint, build, and full
  regression suite pass after the cache/lens refinement.
- Browser smoke harness confirms 255 items use real grid cells, compact cursor-local
  focus in a rectangular surface, 32 focus-group requests, continuous motion, zero
  poster overlaps, and click selection of the intended item.
- Added monotonic radial-map sampling and derivative checks, LUT binary-search
  inversion with one safeguarded Newton refinement, and explicit center/overflow
  identity tests.
- Added live development controls behind `?lensDev=1` for `k1`, `k2`, radius scale,
  and distortion strength; invalid maps stay rejected and show an error state.
- Applied the same forward transform to all 255 cell positions and to a local dot
  Canvas layer while retaining the static CSS dot field outside the active region.
- Removed the circular Canvas clip, lens outline, and CSS circular overlay; the focus
  mode is now an explicitly rectangular container.
- Removed pill-shaped corners from the `Сетка / Фокус` mode switcher so the complete
  focus entry path remains rectangular.

## Slice card: Variant A geometry

- Goal: make the whole field read as a cursor-centered radial/fisheye surface.
- Parent plan: `docs/aegis/plans/2026-09-01-ratings-canvas-exploration.md` §14.
- Files: `ratings-sphere.js`, `tests/ratingsSphere.test.js`, minimal ratings CSS if
  the hybrid background needs a scoped layer, plus work records/changelog.
- Boundary: no WebGL, no poster mesh warp, no changes to page selection/detail
  ownership, poster cache, or 32-item loading limit.
- Verification: monotonic sample + derivative, LUT round-trip/boundary tests,
  lint/build/full suite, and browser smoke at 255 items.
- Stop: stop on non-monotonic dev parameters or ambiguous inverse mapping; do not
  silently fall back to a different geometry owner.

## Evidence refs

- Parent plan: `docs/aegis/plans/2026-09-01-ratings-canvas-exploration.md`
- Current renderer inspection: `src/pages/ratings/ratings-sphere.js`
- Current manager integration: `src/pages/ratings/ratings.js`

## Drift check

The slice remains aligned with the intent lock (stable poster-to-movie identity),
scope fence (Canvas 2D for current hundreds), and owner boundary (renderer owns
geometry; manager owns details). No new dependency, endpoint, fallback owner, or
retirement boundary has appeared. The existing CSS dot field remains the outer
background; the active lens adds a scoped transformed dot layer without becoming
a second poster/layout owner.

## Blockers

No implementation blocker. The isolated browser smoke is complete; a user-side
reload is still useful for checking the authenticated extension page because the
harness cannot provide `chrome.*` runtime APIs.

## Next step

Preserve the user-owned dirty worktree and perform one real
`chrome-extension://` reload/network comparison with the active poster CDN.
