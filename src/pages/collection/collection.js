// A custom collection opens inside Bookmarks. Old collection.html?id= links land
// there; replace() keeps this page out of the history, so Back skips it.
(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    const query = id ? `?filter=collection:${encodeURIComponent(id)}` : '';
    window.location.replace(`../bookmarks/bookmarks.html${query}`);
})();
