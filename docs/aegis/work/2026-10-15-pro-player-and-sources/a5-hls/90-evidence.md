# A5 controlled HLS: implementation and verification

Date: 2026-10-16. Incremental scope, not completion of all A5 or the roadmap.

## Implemented

`UrlPolicy` normalizes URLs and excludes credentials, unsupported schemes,
nonpublic/special literal addresses and unknown resource contexts. Remote initial
manifests use reviewed Kodik/Rutube host families; children require public HTTPS.
Fragments are removed before network/final-URL comparison. Local origin is exactly
HTTP 127.0.0.1:3000. The loader captures a nonroot manifest directory and rejects
sibling-session/backend paths, including normalized encoded traversal.

`HlsPolicyLoader` implements the installed hls.js 1.6.15 public Loader interface.
It uses GET, credentials omission and manual redirects, checks initial/final URLs,
blocks opaque/HTTP redirects before following, supports exclusive ranges,
first-byte/whole-response deadlines, cancellation, stats and one final progress
delivery. Error text is fixed and does not include arbitrary URLs or exception text.
Signed query strings remain intact. It has no internal retry loop.

Factory protective fields override caller loaders/hooks and disable alternate
CMCD/DRM/content-steering/interstitial channels. Recovery policy grants no local
access. Policy failure destroys once and cancels retries before bounded/persistent
or fatal/nonfatal branches. Startup cannot attach a destroyed instance.

BaseParser and AnimeGo have no unmanaged/native HLS escape. Their existing parser
fallback/error path remains. MovieDetails captures session ID, exact HLS URL,
session object and source/torrent request generations before awaiting the library.
Only the matching HLS session selects local and supplies its manifest scope.
Search no longer inserts an eager HLS source while awaiting the library. MP4 stays
direct. Ghost inherits protected profile/scope and destroys on policy failure;
extension-page missing policy fails closed, while provider-frame behavior remains
explicitly separate. AnimeGo cancels superseded metadata restore callbacks so an
older swap cannot resume the newer paused stream.

## Evidence

- URL matrix covers normalized IPv4, IPv6/mapped/transition/documentation forms,
  hostname suffix boundaries, local origin, blob rejection, hashes and HLS kinds.
- Loader: 17 unit cases for transport, redirect/final URL, cancellation/deadlines,
  ranges, callbacks, errors, constructor overrides and captured local directory.
- Factory: 7 unit cases for protected config, missing dependencies, separate
  profile/recovery, nonfatal policy termination and synchronous startup teardown.
  Existing bounded/persistent/media recovery assertions are preserved.
- Consumer regression covers unsupported HLS, parser fallback ownership, stale
  lazy mounts, matching/mismatching/replaced/in-place-mutated torrent sessions,
  request generations, no eager Search source, MP4 retention, protected/provider
  preview distinction, synchronous preview teardown and AnimeGo restore ordering.
- Actual Chromium extension smoke positively contacts both owned origins before
  asserting zero forbidden endpoint hits. A legitimate local session decodes
  frames concurrently with rejected remote-private initial URL, redirect,
  cross-origin init/key and same-origin out-of-directory init. Each allowed
  initial manifest receives one server hit; each rejected playback reports one
  policy fatal/destroy and no retry beyond the first recovery interval.
- Existing T0 extension smoke and A5-0 browser-model experiment still pass. A5-0
  deliberately constructs raw hls.js only in its isolated test to preserve the
  uncontrolled baseline; production source does not gain that bypass.
- Fresh cleaner fixtures pass both themes at 1366/400px after extension reload.

Observed red before fixes: missing UrlPolicy implementation; missing-policy Ghost
extension preview tried native src (`true !== false`). Review also reproduced
the stale AnimeGo play-state callback and fixed URL-hash comparison, local session
selection/scope and synchronous ownership/teardown. Tests now cover those findings.

## Limits

No live provider, actual MediaPlayer backend, authenticated session, installed
daily extension, Node22 CI parity, native HLS decoding, H264/AAC/TS/device codec,
or deployment validation. Browser media is synthetic VP9/Opus fMP4 on owned
loopback servers. Random test ports and policy instances stay in tests.

String-based policy cannot prevent DNS rebinding/private DNS resolution. Direct
MP4, external track/media URLs and provider/nested iframe requests have limited
guarantees; no global DNR or backend authorization guarantee is claimed. Native
HLS fallback on extension pages is unsupported. Redirect/cookie/DRM/interstitial
or unknown-host compatibility requires separate investigation. The provider
sandbox list is still empty. No live provider is declared compatible by this work.

README Unreleased and affected architecture guidance describe this implemented
scope; no version/manifest/lockfile/CI changes, commits or external publication.

## Final checks and review

Final npm test, lint, build and media-player checks passed after all runtime
changes. Watch-room, HTML order, release-notes and fresh source-extension policy,
T0 and menu/browser-model smokes passed. CHECKPOINT.md records local log names,
offline-runner limits and the exact remaining review status.

Two final independent read-only directions reported clean after reproducing the
relevant unit/browser checks. A third fresh final reviewer failed to start due
account usage limit; it is not counted as a clean review. All concrete findings
received in the completed reviews were fixed and covered by regression tests.
