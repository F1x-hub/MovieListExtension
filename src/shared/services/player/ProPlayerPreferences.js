(function (global) {
    'use strict';
    // The «Смотреть» interface is the default for every user; the former admin opt-in is gone.
    async function isEnabled() { return true; }
    function subscribe() { return () => {}; }
    global.ProPlayerPreferences = Object.freeze({ isEnabled, subscribe });
})(typeof window === 'undefined' ? globalThis : window);
