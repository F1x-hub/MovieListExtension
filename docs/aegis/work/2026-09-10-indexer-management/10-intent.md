# Indexer management intent

## User-visible goal

Allow the extension Settings page to view configured Jackett indexers, enable or
disable which of them participate in MediaPlayer searches, and run a safe
connectivity check.

## Boundary decision

Jackett administration endpoints require a browser cookie session and cannot be
driven with the API key held by MediaPlayer. The feature therefore manages the
MediaPlayer active selection of already configured Jackett indexers. It does not
copy credentials into the extension, expose locators, or delete Jackett's
configuration files. Adding a new Jackett tracker remains a Jackett UI action;
the new tracker is then discoverable in Settings.

## Scope

- MediaPlayer: catalog configured indexers through the Torznab API, persist the
  active selection, expose authenticated list/update/test routes, and apply the
  selection to source search.
- MovieList extension: add Settings controls and client methods using the
  existing device-token channel.
- Installer: preserve existing Jackett files and user deletions during upgrades;
  do not reintroduce removed defaults.

## Explicit non-goals

- No Jackett API-key or cookie storage in MovieList.
- No automatic deletion or overwriting of user indexer credentials.
- No change to the user's current Anilibria, RuTracker, RuTor, or NoNaMe Club
  configuration.
