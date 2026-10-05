/**
 * Non-render-blocking stylesheets. A <link rel="stylesheet" media="print" data-async-style>
 * downloads without blocking the first paint; this switches it to all media once loaded.
 * (The usual inline onload="this.media='all'" is blocked by the extension CSP.)
 * Load synchronously right after the links it handles.
 */
(function applyAsyncStyles() {
    const apply = link => {
        link.media = link.dataset.asyncMedia || 'all';
    };
    document.querySelectorAll('link[data-async-style]').forEach(link => {
        if (link.sheet) {
            apply(link);
        } else {
            link.addEventListener('load', () => apply(link), { once: true });
        }
    });
})();
