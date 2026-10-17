# T0 evidence

Date: 2026-10-16. T0 accepted after two review rounds (six reviewer runs).

## Executed checks

| Check | Result |
| --- | --- |
| Before: playerExtensionBrowserSmoke.cjs | AssertionError: missing reusable extension helper |
| Default fixture port 3000 | Refused: an existing loopback listener owns the port; owner preserved |
| playerFixtureServer.test.cjs | Passed: key-derived ID, ranges/HEAD, traversal/method rejection, port collision and cleanup |
| PLAYER_FIXTURE_PORT=0 npm run test:player-smoke | Passed in full bundled Chromium: stable ID, worker, HLS time and presented frames, local fetch and external DNS/IP failures |
| npm run lint | Passed |
| node --check, four new CJS files | Passed |
| npm test | Passed, exit 0; all pretest/test chains completed under the scoped offline preload |

The pretest/test graph has 150 leaf invocations (148 unique) after adding the
fixture-server unit test. The full npm test log is retained outside the repository
in generated local scratch. It uses a reviewed temporary preload: loopback guards
for Node socket/fetch and proxy/resolver arguments for existing Chromium page tests.
This is scoped transport control, not an OS-wide egress guarantee. It does not
replace or alter the browser executable selected by existing tests.

## Limits

- :3000 was not used by the smoke; the product DNR exception is not verified.
- Synthetic VP9/Opus verifies local HLS/MSE and presented frames, not correctness
  of any provider's film/episode, H.264/AAC/TS, seeking or installed daily profile.
- No Firebase credentials, provider streams, package install, CI modification,
  release/version change, commit or push.
- Browser response observation starts after launch; the deny proxy/resolver is
  configured at launch, but Playwright observation alone is not total isolation.
- Node 22 CI runtime has not been exercised locally.

## Independent review

Round 1: correctness found that aggregate proxy hits could come from startup and
requested a separate hit for each synthetic page/SW probe; security found Chromium's
implicit link-local/loopback bypass. Both were fixed: subtract implicit bypass and
allow only the exact fixture port, count each fixed probe host separately, and
exercise page plus worker. A second test-owned reachable local server is denied to
the browser, with its inbound hit count unchanged; no real local backend is probed.
The fixture manifest now records and verifies SHA-256 and sizes. Unit and smoke
passed again after the corrections. Final correctness and security re-review
confirmed both findings closed; the test reviewer independently reran unit and
smoke and found no material issues. No unresolved BLOCKER/MAJOR findings.
