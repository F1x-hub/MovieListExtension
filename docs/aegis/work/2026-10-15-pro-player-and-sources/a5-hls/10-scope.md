# A5: controlled HLS increment

Date: 2026-10-16. Authorized by the owner's incremental G-A5 decision in
../a5-0/20-decision.md. Same attached worktree/base as T0; no commit or release.

Implement only extension-owned HLS network policy and its consumer integration.
Keep direct MP4 and provider-owned iframe behavior with explicit limited guarantees.
Do not call this full A5, backend authorization, installed-provider compatibility,
or global DNR isolation. No live provider/backend requests, permission changes,
dependency upgrades or version changes are included.

The pinned hls.js 1.6.15 public Loader interface owns GET/manual redirects,
credentials omission, complete response delivery, ranges, timeouts and cancellation.
Map playlist/init/fragment/key contexts explicitly. Apply protected factory fields
after caller overrides; terminate policy errors once even when fatal is false.
Remote and local profiles are separate from bounded/persistent recovery.

Local profile requires a matching captured active torrent HLS session/request and
captures its manifest directory. No unmanaged/native HLS fallback on extension
pages; parser fallback/error remains available. Ghost inherits the protected
loader's profile/scope and fails closed on an extension page without that loader.

Remote initial manifest hosts are grounded in existing Kodik fixtures and Rutube
CDN declarations, not live host availability. Special literal-address exclusions
were checked against the IANA registries:
- https://www.iana.org/assignments/iana-ipv4-special-registry/
- https://www.iana.org/assignments/iana-ipv6-special-registry/

The policy deliberately excludes special/transition IPv6 ranges conservatively.
DNS resolution/rebinding is outside its guarantee; public HTTPS child CDN hosts
remain allowed. Redirect-dependent, cookie-dependent, DRM/interstitial and
unknown-host streams require a separately verified compatibility path.
