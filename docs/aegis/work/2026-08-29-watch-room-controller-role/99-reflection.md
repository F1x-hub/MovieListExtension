# Reflection

- Keep role normalization in the server service: a client label must never be
  treated as authorization.
- Preserve the existing members listener as the runtime role source; no polling
  or second presence channel is needed.
- Owner and controller share timeline authority: each applies the other's
  published revision while ignoring its own echoed write.
- The owner must apply controller timeline state directly; routing it through
  viewer source synchronization remounts the active provider and destroys playback.
- Preserve controller labels through `emitRoomUpdate`; reducing every
  non-owner role to viewer would silently hide a valid server-side grant.
- No new fallback, compatibility path, database branch, or recurring job was
  introduced. The old owner-only timeline behavior remains the safe default for
  rooms where no role is granted.
