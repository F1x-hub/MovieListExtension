# Remaining authorized player/source work

Date: 2026-10-16. Same attached codex/pro-player worktree/base as CHECKPOINT.md.
Owner explicitly approved chrome.storage.local, the admin-page toggle, and all
remaining listed work without stopping between cards. This is implementation and
verification authorization; external publication/messages/releases remain separate.

Work is split by file ownership: watch controller/page/source policy and runtime
integration; local admin flag; decoder/diagnostic/refresh/health helpers; capability
and metrics services/UI; narrow header-rule audit. Each helper's unit results are
partial until integrated and reviewed. Source tests are preserved; new browser
fixtures use owned offline servers and actual source CSS/logic.

Default feature flag remains off. Preserve source-button identity and delegation,
room > explicit > watchPrefs > lastSource > default priority, canonical S/E,
RELIABLE progress, manual/room/timeout suppression and one finite fallback owner.
Never infer ready playback from discovery. Admin flag is browser-local UX only.

Then verify remaining network boundaries, lifecycle/accessibility/localization,
incremental control extraction and title preferences. Public provider/backend or
installed-device evidence must identify the actual environment and available
access; missing access stays unverified and does not stop independent cards.

Required final checks: lint/build/full test (including pretest), relevant player/
watch-room/security tests, real extension fixture reload with dark/light 1366/400,
keyboard/focus and intermediate visual states, scoped diffs/new files and README
Unreleased. Independent review findings must be fixed or explicitly retained.
