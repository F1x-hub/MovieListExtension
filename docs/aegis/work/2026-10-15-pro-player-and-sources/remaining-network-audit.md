# Remaining network boundaries and deferred security work

Date: 2026-10-16. Scope: A5d/A5g/A5h and T-S, source inspection only. No provider requests, credential checks, backend changes, permission removal, or URL rewrites were performed. References identify the working-tree source at audit time; subsequent edits may move lines.

## Accepted boundary

The owner accepted controlled HLS first, while retaining direct MP4 and provider-owned frames with explicitly limited guarantees (G-A5). This is not a claim that all media traffic is now controlled.

`UrlPolicy.js:54` checks normalized URL schemes, literal private/special addresses, obvious local hostnames, approved initial remote manifest hosts, and local origin. `HlsPolicyLoader.js:14` additionally binds local HLS requests to the directory of the validated session manifest. Its fetch transport uses `credentials: 'omit'` and manual redirects (`:139`), rejecting redirects and unexpected final URLs before another request is issued. The factory makes its protected transport configuration authoritative.

These are string/transport checks. DNS resolution and rebinding remain outside the URL policy guarantee (`UrlPolicy.js:36`). A public-looking hostname can resolve to a private address. CORS failure, `requestfailed`, or a blocked response does not prove that a server was never contacted; owned server hit counters are needed for no-contact assertions. The offline deny proxy establishes the scope of the local browser fixtures, not an installed-system firewall.

## Media URL assignment inventory

| Consumer | Assignment or mount | Current boundary |
| --- | --- | --- |
| BaseParserService | `:115-117` video/source markup; `:132-135` HLS factory | HLS uses controlled remote transport. Non-HLS uses native media loading. `toPlayerMediaSrcAttribute` at `:763` accepts HTTP, HTTPS, and blob and escapes markup; this is not a private-network, redirect, or credential boundary. |
| AnimeGoParser | `swapNativeStream` at `:747`, factory at `:778` | Controlled remote HLS; failed/unsupported HLS does not silently become uncontrolled native HLS. Exact selection and request guards remain separate from URL policy. |
| SeasonvarParser | `:525-526` initial `<source>`; `:583` subtitle track; `:676` and `:850` episode video URL changes | Native MP4 and native subtitle loading. Subtitle parsing accepts HTTP/HTTPS. No controlled HLS-loader guarantee applies to these native requests or redirects. |
| SeasonvarAdapter | `:109` same-season episode `video.src` | Native media assignment; accepted compatibility exception, including update of the episode subtitle tracks through the parser. |
| Search | `:4244` non-HLS `videoElement.src`; nearby remote HLS factory | Direct non-HLS remains native. HLS uses the controlled factory. Provider frames remain a separate origin and policy boundary. |
| MovieDetails | `renderCustomPlayer`, non-HLS `video.src` at `:10759`; controlled factory nearby | Direct MP4 remains native. HLS remote/local profiles are explicit; local profile selection is tied to the captured torrent session and request. A default backend origin alone does not authorize every endpoint on that backend. |
| GhostPlayer | `player/PlayerGhostPreview.js:151` `_initSource`; HLS `loadSource` at `:202`; native `src` at `:209/:213` | Extension HLS previews require the active protected loader and inherit its session scope. Policy failure destroys the preview transport. Direct MP4 previews and native/provider-frame previews retain the limited native/provider guarantee. |
| Provider frames and trailers | `PlayerSurface.js:43-59`, MovieDetails frame assignments including `:3436` | URL normalization/escaping and opt-in sandbox infrastructure exist. The production sandbox provider list is empty. Child-frame requests use the child initiator; extension-initiator DNR conditions do not cover the entire descendant frame tree. |

No separate audio URL assignment was found in the bounded parser/player consumers above. HLS audio playlists/segments go through their loader contexts. This is not a whole-repository audio audit; offscreen radio was deliberately excluded.

## Seasonvar HTTPS and seek gate

`SeasonvarParser.js:13-15` still declares an HTTP site/search origin. Playlist parsing accepts explicit HTTP and HTTPS media URLs (`:201`, `:511`); native subtitle parsing likewise accepts both. The protocol-relative decoded-URL normalization at `:1160` does not establish that existing explicit HTTP resources support HTTPS.

The existing tests use synthetic examples: `seasonvarTranslations.test.js:30/:51/:59` provides an HTTP site/playlist context and `:73` supplies `http://cdn.example.com/s06e01.mp4`. `seasonvarPhase5B.test.js` also uses synthetic HTTP `data.seasonvar.ru` MP4 paths. These are parser fixtures, not verified live CDN objects. Their HTTPS equivalents must not be fabricated or requested as compatibility evidence.

No verified public provider media fixture URL is available in this bounded source evidence. Therefore HTTPS availability, redirect behavior, byte-range support, and actual seek on Seasonvar's current CDN remain **unverified**. The local VP9/HLS fixture proves its own playback/seek behavior only; it cannot close this provider gate. Before a live gate, obtain one concrete currently valid, authorized provider media URL and record only a redacted origin/path classification; then test HTTPS status, redirects, Range/206 behavior, and actual playback/seek without exposing signatures. No automatic HTTP-to-HTTPS rewrite was made.

## Port 3579

`manifest.json:94-95` retains localhost and 127.0.0.1 permissions for port 3579. A literal search of source/content scripts, project scripts, native host, and Functions found no direct port-3579 consumer. However, `MediaPlayerService.js:48` supports `options.baseUrl`, and `:825-827` resolves and restricts session URLs against that configured origin. The default remains `http://127.0.0.1:3000` (`:9`, manifest `:96`).

Absence of a literal is insufficient evidence that user configurations or an external/native integration cannot use port 3579. Proposed follow-up: enumerate constructor/configuration entry points and supported external clients, then make a narrowly reviewed permission-removal decision if the endpoint is confirmed obsolete. Permissions and configurable endpoint behavior were preserved.

## T-S: deferred security findings (no values reproduced)

1. **Client-shipped credentials:** schedule credential configuration is at `src/background/background.js:216`, with schedule-related consumers at `:889/:893/:894/:902`. Spotify client-secret configuration is at `src/shared/config/spotify.config.js:5`, imported by the background at `:5` and used in token authorization at `:1594`. Values were not printed, copied, transmitted, or tested. Client-shipped confidential credentials cannot be treated as confidential, regardless of web-accessible-resource configuration. Remediation needs a separately scoped migration/rotation and operational verification; deleting a local constant alone does not revoke a credential or establish service continuity.
2. **Firestore approval bypass in repository rules:** `rules/firestore.rules:51-58` treats a profile lacking `approvalStatus` as approved. Owner profile creation at `:582-585` permits omitting that field. Together these rules allow an authenticated owner to create a profile without approvalStatus and satisfy `isApprovedUser()`. This is a concrete source-level authorization gap; the comments claiming a completed production migration are not deployment evidence. Follow-up requires emulator regression coverage, migration/backward-compatibility decisions, and separately authorized deployment. No rules or deployed state were changed.
3. **Broad web-accessible resources:** `manifest.json:131-166` exposes broad service/config/component globs and other assets to `<all_urls>`, including the config glob at `:155`. This enlarges the external read surface; it does not prove an arbitrary executable exploit by itself. Inventory actual injected/page consumers before narrowing the list, and keep the credential migration separate from the assumption that hiding a bundled file makes it secret. No WAR policy change was made in this audit.

## Evidence and completion limits

On 2026-10-16 the browser tool explicitly refused access to the existing Seasonvar tab under its site-safety policy. No permission prompt was offered. This live gate is blocked; alternate browser surfaces, shell requests and hostname workarounds must not be used to obtain the refused outcome. Offline provider fixtures remain separate evidence.

Evidence consists of bounded source searches, parser fixture inspection, and credential-pattern matches returning file/line numbers only. No live-provider, HTTPS, seek, deployment, credential-validity, or installed-extension result is asserted by this document. A5d/A5g retain the explicitly accepted native/provider exceptions; A5h has a retained-permission finding; T-S has a separate actionable security inventory rather than a completed remediation claim.
