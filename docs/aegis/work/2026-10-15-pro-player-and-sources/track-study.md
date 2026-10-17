# E1.5 / T-G offline study protocol

Status: analyzer implemented; real sample not collected. G4 remains open.

Predeclare a pilot of 30 distinct titles: 15 anime and 15 other films/series,
distributed across the currently supported providers. This is a convenience pilot,
not a representative estimate of the entire catalogue. Freeze the reference list
and desired voiceover/quality pair before testing. An inaccessible title remains
unknown in the denominator; do not replace it with a working example.

For each reference privately record canonical title/S/E, exact release/edit,
desired stable voiceover ID and quality height. Mark `missingPair` true only after
checking the declared pair for that exact release, false when found, otherwise null.
Set `exactIdentity` only after checking canonical identity. Do not infer it from
similar titles, runtime, dub index or a nonempty source list.

For synchronization candidates verify the same edit and manual visual/audio anchors
near the start, middle and end. The analyzer's conservative pilot limits are 0.5 s
duration difference, at most 100 ms absolute anchor offset, and at most 100 ms
start-to-end offset spread. These are study filters, not a proof of synchronization
or a production specification. Different dubbing needs validated manual anchors;
audio fingerprints alone are insufficient. Record inserted scenes/ads as edit
mismatches. Revalidate after seeking and buffering before any separate E2 prototype.

Run `node scripts/player-track-study.cjs <private-local-sample.json>` with an array
of `{exactIdentity, missingPair, sameEdit, durationDeltaSeconds, anchorOffsetsMs}`.
The script performs no network or writes and exports only aggregates. It reports
known-only prevalence and total-sample bounds with all unknowns absent/present.
An empty sample gives null prevalence, never zero demand. Do not commit private
sample URLs, signatures or account data.

The 15% threshold is a product heuristic. G4 requires the actual denominator,
unknown fraction, limitations, synchronization evidence and an owner decision;
the analyzer never enables E2/E1c. The current empty real sample cannot justify
dual-player or a unified cross-provider track catalogue.
