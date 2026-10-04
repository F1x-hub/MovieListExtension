# Closeout review

- Preserved the original selection-only boundary and all installed Jackett configuration.
- Recovered the interrupted packaging work from source and staged hashes, not an EXE timestamp.
- A real PowerShell regression caught zero/single-file behavior that source-pattern checks missed.
- Kept the repair at the provisioning owner; no API or UI redesign was needed.
- Documented configuration-check semantics instead of implying remote tracker availability.
- Remaining acceptance is an installed Suite upgrade followed by real extension interaction.
- The user-visible cause was old Jackett state surviving an upgrade, not a current default-profile regression.
