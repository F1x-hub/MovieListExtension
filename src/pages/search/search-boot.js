/**
 * A link that already names what to find (?q=, ?query=) or leads elsewhere must not
 * flash the «Enter a movie title» invitation before search.js takes over.
 */
(() => {
    const params = new URLSearchParams(window.location.search);
    if (['q', 'query', 'movieId', 'type'].some(name => params.get(name))) {
        document.documentElement.classList.add('search-route-opening');
    }
})();
