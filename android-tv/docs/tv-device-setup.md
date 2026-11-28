# The owner's TV: changes made for speed

Measured and changed over adb on 2026-11-28 (TCL G13, Android 14, about 954 MB RAM).
Everything here is reversible; nothing was uninstalled except the mockup viewer.

## Before and after

| | Before | After |
| --- | --- | --- |
| `MemAvailable` | 198 MB | 324 MB |
| Swap in use | 344 MB | 226 MB |
| «Сеанс» build on the TV | debug (100% janky frames on Home) | release |

## Disabled for user 0 (`pm disable-user --user 0`)

| Package | What it was |
| --- | --- |
| `com.tcl.ttvs` | TCL telemetry, BI, update checks (6 background services) |
| `com.tcl.waterfall.overseas` | TCL content and ads feed |
| `com.tcl.suspension` | TCL floating overlay |
| `com.tcl.messagebox` | TCL message and ads box |
| `com.tcl.useragreement` | TCL agreement screens (first setup only) |
| `com.tcl.guard` | TCL app manager, USB pop-ups |
| `com.google.android.apps.tv.dreamx` | Ambient screensaver (keeps photos in memory while idle) |
| `com.google.android.syncadapters.calendar` | Calendar sync |
| `com.netflix.tokenmanager` | Netflix helper (Netflix itself was already disabled) |
| `com.android.printspooler` | Printing |
| `android.autoinstalls.config.google.gtvpai` | Silent installs of promoted apps |
| `com.google.android.apps.mediashell` | Chromecast built-in: casting to this TV stops working |

Restore one: `adb -s 192.168.1.9:5555 shell pm enable <package>`.

## Other settings

- Window, transition and animator animation scales: 0.5 (`settings put global ... 0.5`; restore
  with `1`).
- Home role: `local.tclhome` (it already held it). That launcher has a fixed list of apps
  (SmartTube, Lampa, YouTube, Play, Media Player, TV, HDMI 1/2) and no «Сеанс» tile, so the Google
  TV launcher (`com.google.android.apps.tv.launcherx`) stays enabled: it is the only app list
  that can open «Сеанс». It still takes about 70 MB.
- Removed: `app.seans.tvmockup` (the mockup viewer installed on 2026-11-27).

## Kept on purpose

Google Play services and Play Store, the voice assistant (`com.google.android.katniss`, used by
the remote's mic and «Голосовой поиск»), YouTube, the remote service, HDMI and tuner services,
the factory menus, `local.tclhome`.
