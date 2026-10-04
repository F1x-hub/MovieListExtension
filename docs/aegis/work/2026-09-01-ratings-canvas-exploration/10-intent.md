# Task intent: ratings Canvas exploration

## Requested outcome

Implement the approved Canvas 2D exploration mode for rated movies: a dense,
stable poster grid with a smooth local magnifier under the pointer, hover preview,
click selection, and movie details without breaking the existing grid view.

## Scope fence

- In scope: existing ratings page Canvas renderer, ratings manager wiring,
  accessibility fallback, responsive/reduced-motion behavior, focused tests.
- Out of scope: true WebGL sphere, Voronoi/force simulation, texture atlases,
  new network endpoints, provider/API changes, and manual `dist` edits.

## Baseline refs

- Parent plan: `docs/aegis/plans/2026-09-01-ratings-canvas-exploration.md`
- Project rules: `.agents/rules/agent.md`
- Renderer: `src/pages/ratings/ratings-sphere.js`
- Manager: `src/pages/ratings/ratings.js`
- Existing visual contract: `tests/visualDesignContract.test.js`

## Task-start snapshot

- Root: `D:\Programing\JS\Projects\MovieListExstension`
- HEAD: `a5a01492e997ee94a0e93a94b0baa90b6183f8ec`
- Branch: `master`
- Upstream divergence: not inspected as a remote sync operation is out of scope
- Pre-existing modified paths: `.agents/rules/agent.md`, `README.md`, multiple
  Firebase/functions/rules/watch-room files, ratings HTML/JS/CSS, and related tests
- Pre-existing untracked paths: `({i`, `({id`, `.firebase/`, `.vs/`, `artifacts/`,
  `scratch/`, `src/pages/ratings/ratings-sphere.js`, and runtime config
- Active Git operation: none observed
- Worktrees: only the primary project worktree was listed

## Owner and compatibility constraints

`ratings-sphere.js` remains the sole owner of Canvas geometry, frame state, pointer
focus, and picking. `ratings.js` remains the owner of filters, selection state, and
the HTML details panel. Grid view remains the default and unchanged.

## Verification obligations

Run focused syntax/contract tests, lint, visual contract tests, HTML module
contract, and production build. Manual verification must include center/edge/corner
pointer positions, delayed image loading, click details, filtering, resize, and
reduced motion.

## TDD route

Mode: off. Decision: skipped. Test posture: contract and post-change regression
checks; strict test-first authority was not requested.

