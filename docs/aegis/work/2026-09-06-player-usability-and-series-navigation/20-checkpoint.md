# Checkpoint

## Current todo

- [x] Read baseline and isolate the reported behaviors.
- [x] Implement canonical previous/next routing.
- [x] Implement settings UI and player subtitle formatting.
- [x] Correct the central action geometry.
- [x] Run focused and broader verification.
- [x] Update changelog and final work evidence.

## Active slice

Implement the existing-owner repairs without changing provider parser behavior.

## DriftCheckDraft

The current scope remains inside the approved player usability request. The
legacy local episode navigation route is a retirement target; no new canonical
selection owner will be added.

## Evidence

- `node tests\\subtitleAppearanceSettings.test.js` passed.
- `node tests\\playerEpisodeNavigationBridge.test.js` passed.
- `node tests\\playerVisualContract.test.js` passed.
- `node tests\\movieDetailsPhase3D.test.js` passed.
- `node tests\\movieDetailsPhase6A.test.js` passed.
- `node tests\\playerEpisodeProviderRuntimeAcceptanceAudit.test.js` passed.
- Player `Субтитры` submenu now contains the appearance editor with live preview,
  normalized controls, and reset behavior.
- `npm run test:media-player` passed.
- `npm run lint` and `npm run build` passed.
- Full `npm test` reached the pre-existing `movieDetailsCreditsUI.test.js` failure at
  the hidden-actors layout assertion; no task-owned player test failed before that gate.
- The unpacked-extension browser smoke test remains pending for provider-specific
  native captions and iframe navigation.
