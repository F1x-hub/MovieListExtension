# Modular Error System — Task Intent

## Requested outcome

Replace raw page-level error strings with a modular, localized error pipeline.
The first runtime slice covers Home, person-details, and movie-details.

## Scope fence

- Add stable error codes, registry modules, normalization, presentation, and dialog UI.
- Localize title, message, actions, and quota timing through the selected language.
- Preserve existing Kinopoisk fetching, caching, key rotation, and player suppression behavior.
- Keep technical causes available only under an explicit details disclosure.

## Non-goals

- Do not change provider request strategy or quota consumption.
- Do not convert every console warning or external player error into a blocking dialog.
- Do not remove legacy page error markup until the new component is proven on all owners.

## Baseline refs

- `src/shared/utils/Utils.js`
- `src/shared/i18n/I18n.js`
- `src/shared/i18n/locales.js`
- `src/shared/config/kinopoisk.config.js`
- `src/pages/movie-details/movie-details.js`
- `src/pages/home/home.js`
- `src/pages/person-details/person-details.js`
- `src/shared/components/GamesModal.js`

## Acceptance evidence

- A quota error renders localized user text without raw English provider messages.
- The active locale changes error title, body, and action labels.
- Adding a registry module does not require page-specific error rendering code.
- Classic script dependency contract and lint remain green.
