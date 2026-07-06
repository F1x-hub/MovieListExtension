# AGENT.md — Movie Rating Extension
> Auto-generated. Keep this file accurate and up to date as the project evolves.

## Project
Chrome Extension that helps users rate and discover movies with community ratings, Firebase synchronization, and Kinopoisk integration.

## Stack
| Layer       | Technology                  | Notes                        |
|-------------|-----------------------------|------------------------------|
| Language    | JavaScript (ES6+)           |                              |
| Framework   | Chrome Extension MV3         |                              |
| UI          | HTML / CSS (Vanilla)        |                              |
| Backend     | Firebase Services           |                              |
| DB          | Firestore / Local Storage   |                              |
| Build       | npm scripts + custom minify |                              |
| Test        | N/A                         |                              |

## Structure
src/
├── background/      # Extension service worker
├── content-scripts/ # Content scripts running on movie sites (Kinopoisk, IMDb, etc.)
├── offscreen/       # Offscreen documents
├── pages/           # Pages (ratings, settings, movie-details, random, etc.)
├── popup/           # Extension popup
└── shared/          # Shared components, styles, services, config, utils

## Architecture
- Chrome Extension Manifest V3 architecture with background Service Worker.
- Content scripts inject watchlists and players on targeted movie-streaming sites (ex-fs, hdrezka, imdb, etc.).
- Communication between content scripts, popup/pages, and service worker via chrome.runtime messages.
- Firebase integration for cloud sync and user ratings.

## Key Conventions
- Naming: camelCase for JS files, kebab-case for folders and CSS classes
- Error handling: Wrap async calls in try/catch, log errors appropriately
- CSS: Custom properties for variables, responsive design, scoped to pages

## Entry Points
- `manifest.json` — Chrome Extension configuration
- `src/background/background.js` — Background Service Worker
- `src/popup/popup.html` — Default extension popup

## Environment & Scripts
| Command         | Purpose                        |
|-----------------|--------------------------------|
| npm run dev     | Build and watch files          |
| npm run build   | Build production bundle        |
| npm run lint    | Lint source files              |

## Known Issues / TODOs
- Clean up any unused content-scripts or skills

## Agent Rules
- Always use `cmd /c` for shell execution on Windows.
- Always run `npm run lint` before committing/pushing if changes were made to JS.
