# Reflection: ratings Canvas exploration

## Outcome

Implemented variant A: a Canvas 2D dense grid with stable movie identity,
cursor-local magnification in a rectangular surface, global monotonic radial displacement, hover preview,
click selection, detail-panel integration, keyboard fallback, bounded 24-hour
persistent poster loading, responsive layout, and reduced-motion behavior. The
radial map covers `0…1.25R`, uses a lookup-table inverse with safeguarded Newton
refinement, and applies to all 255 cells; poster loading remains bounded to 32
focus candidates while the local dot field follows the same transform.

## Plan adherence

- Preserved the existing card grid as the default view.
- Kept layout ownership in `ratings-sphere.js` and details/filters ownership in
  `ratings.js`.
- Avoided WebGL, force simulation, DOM-card duplication, and new dependencies.
- Repaired the measured-layout lifecycle so items never animate from an unmeasured
  `1x1` fallback into the real page; this was the cause of the upper-left stack.
- Replaced whole-row/whole-column expansion with global radial displacement and a
  four-image-per-frame focus-priority loading budget.
- Added query-string/dev-panel calibration for `k1`, `k2`, radius scale, and
  strength, with explicit rejection of non-monotonic maps.
- Added identity-safe inverse behavior at the focal point and beyond the table
  boundary, plus sampled derivative and round-trip acceptance tests.
- Bound loading and drawing to the target focus group instead of the eased cursor
  path, preventing a fast pointer sweep from decoding the whole collection.
- Added normalized, versioned extension-origin poster caching with background fetch
  fill, 24-hour expiry, request cancellation, and hidden-document pause handling.
- Kept the visible animation loop alive for subtle collision-safe ambient motion.
- Removed the circular focus clip, lens outline, and CSS circular overlay so the
  focus mode remains a rectangular container.
- Removed the pill-shaped geometry from the `Сетка / Фокус` mode switcher after
  browser inspection showed it was the remaining rounded focus affordance.
- Kept poster bytes out of `chrome.storage.local`; only lightweight cache timestamps
  are stored there, with Cache Storage holding the binary response bodies.

## Verification receipt

- Focused Canvas contract tests: passed.
- JavaScript syntax, lint, visual design, and HTML module contracts: passed.
- Production build: passed.
- Full `npm test`: passed.
- Isolated browser smoke: passed for 255 items, 32 unique focus requests, 89
  moved cells, visible row/column curvature, a rectangular focus surface, zero
  poster overlaps, and correct center/outside-lens hit-testing.

## Residual risk

The authenticated `chrome-extension://` page still benefits from a user-side
reload and Network check with real Firebase-loaded poster data and the actual
poster CDN host. The isolated browser harness cannot provide Chrome APIs, so its
bootstrap storage errors are not product failures.

## Delivery boundary

No commit, reset, cleanup, or unrelated worktree changes were made. Existing dirty
and untracked user paths remain preserved.
