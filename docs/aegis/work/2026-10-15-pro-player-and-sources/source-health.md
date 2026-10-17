# Source-health execution boundary

`npm run test:player-health` uses in-memory Kodik routes, the production resolver,
and owned synthetic playlist/media files. The manual-only GitHub workflow runs
that offline command with read-only repository permissions. No schedule is enabled.

The separate `scripts/player-source-health-live.cjs` entry point requires both
`--live` and `--references <private-local-json>`. Without both, it returns
`live-disabled`. The file is an array of at most ten `{id, embedUrl}` references;
IDs are non-sensitive opaque labels. Currently only exact HTTPS kodikplayer.com
embeds and approved HTTPS solodcdn.com media families are supported. It resolves
the first source, checks a media playlist and one init/fragment container. Other
providers, master playlists and containers remain unconfirmed rather than a
fabricated parser failure. It does not cover search, codecs, frames or seeking.

The runner executes serially, omits credentials/referrer, refuses redirects,
limits each reference to 8 seconds (maximum configured 15), twelve requests,
2 MiB per response and 8 MiB total. Report output contains only opaque reference
IDs, fixed scope/provider/mode/status fields; no URL, body or exception. Literal
private URLs and arbitrary child hosts are refused. This is not a DNS pinning or
whole-network isolation guarantee; use a restricted network runner for operational
deployment. A failure is `network_or_access_unconfirmed`, never an inferred regional
block or parser regression. Only controlled fixture failures establish regression.

The live entry point was tested with injected fixture Responses, including access
failure, redirect, over-size and hostile-host cases. No live request was made in
this task. A valid reference corpus is still required; do not invent a current URL
or bypass the separate Seasonvar browser site-safety refusal.

Operational G3 still requires an approved reference list and runner environment,
an authorized live result, schedule/frequency, and issue deduplication policy before
any external reporting. This local implementation neither publishes the workflow
nor creates issues. Store signed/private reference inputs outside the repository.
