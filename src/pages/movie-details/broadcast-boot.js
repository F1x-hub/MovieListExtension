/**
 * «Эфир» embeds this page as a player-only broadcast. Switch to that layout
 * before the first paint, so the movie page never shows behind the loading
 * player. movie-details.js starts the broadcast itself with the same check.
 */
(() => {
    const params = new URLSearchParams(window.location.search);
    const start = Number.parseInt(params.get('broadcastStart') || '', 10);
    if (params.get('embedded') === 'true' && Number.isSafeInteger(start) && start > 0) {
        document.documentElement.classList.add('broadcast-mode');
    }
})();
