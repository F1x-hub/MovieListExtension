console.log('[MovieList Extension] Content script loaded for imdb.com');

(function() {
    const scriptUrls = [
        chrome.runtime.getURL('libs/firebase-app-compat.js'),
        chrome.runtime.getURL('libs/firebase-auth-compat.js'),
        chrome.runtime.getURL('libs/firebase-firestore-compat.js'),
        chrome.runtime.getURL('src/shared/config/kinopoisk.config.js'),
        chrome.runtime.getURL('src/shared/services/KinopoiskService.js'),
        chrome.runtime.getURL('src/shared/firestore.js'),
        chrome.runtime.getURL('src/shared/services/WatchlistService.js')
    ];
    const injectedScriptUrl = chrome.runtime.getURL('content-scripts/imdb-watchlist-injected.js');

    async function getUserFromStorage() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['user', 'isAuthenticated'], (result) => {
                console.log('[MovieList Extension] User from storage:', result);
                resolve(result.user || null);
            });
        });
    }

    async function createConfigElement() {
        const user = await getUserFromStorage();
        const config = document.createElement('div');
        config.id = 'movieListExtensionConfig';
        config.style.display = 'none';
        config.setAttribute('data-script-urls', JSON.stringify(scriptUrls));
        if (user) {
            config.setAttribute('data-user', JSON.stringify(user));
            console.log('[MovieList Extension] User data added to config:', user.uid);
        } else {
            console.log('[MovieList Extension] No user found in storage');
        }
        (document.head || document.documentElement).appendChild(config);
        console.log('[MovieList Extension] Config element created with script URLs');
    }

    function loadInjectedScript() {
        const iconsScript = document.createElement('script');
        iconsScript.src = chrome.runtime.getURL('src/shared/utils/Icons.js');
        iconsScript.onload = function() {
            const script = document.createElement('script');
            script.src = injectedScriptUrl;
            script.onload = function() {
                console.log('[MovieList Extension] Injected script loaded successfully');
            };
            script.onerror = function() {
                console.error('[MovieList Extension] Failed to load injected script');
            };
            (document.head || document.documentElement).appendChild(script);
        };
        (document.head || document.documentElement).appendChild(iconsScript);
    }

    window.addEventListener('message', async function(event) {
        if (event.data && event.data.type === 'MOVIELIST_GET_USER') {
            console.log('[MovieList Extension] Received getUser request from injected script');
            const user = await getUserFromStorage();
            window.postMessage({
                type: 'MOVIELIST_USER_RESPONSE',
                user: user
            }, '*');
        } else if (event.data && event.data.type === 'MOVIELIST_SEARCH_MOVIE') {
            console.log('[MovieList Extension] Received search movie request:', event.data);
            chrome.runtime.sendMessage({
                type: 'SEARCH_MOVIE',
                kpId: event.data.kpId,
                title: event.data.title,
                year: event.data.year
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[MovieList Extension] Error:', chrome.runtime.lastError);
                    window.postMessage({
                        type: 'MOVIELIST_SEARCH_RESPONSE',
                        success: false,
                        error: chrome.runtime.lastError.message,
                        movie: null
                    }, '*');
                    return;
                }

                if (response && response.success) {
                    console.log('[MovieList Extension] Movie found:', response.movie);
                    window.postMessage({
                        type: 'MOVIELIST_SEARCH_RESPONSE',
                        success: true,
                        movie: response.movie
                    }, '*');
                } else {
                    console.error('[MovieList Extension] Failed to search movie:', response.error);
                    window.postMessage({
                        type: 'MOVIELIST_SEARCH_RESPONSE',
                        success: false,
                        error: response.error || 'Unknown error',
                        movie: null
                    }, '*');
                }
            });
        } else if (event.data && event.data.type === 'MOVIELIST_CHECK_WATCHLIST') {
            console.log('[MovieList Extension] Received check watchlist request:', event.data);
            const user = await getUserFromStorage();
            if (!user || !user.uid) {
                window.postMessage({
                    type: 'MOVIELIST_CHECK_RESPONSE',
                    success: false,
                    isInWatchlist: false
                }, '*');
                return;
            }

            chrome.runtime.sendMessage({
                type: 'CHECK_WATCHLIST',
                userId: user.uid,
                movieId: event.data.movieId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[MovieList Extension] Error:', chrome.runtime.lastError);
                    window.postMessage({
                        type: 'MOVIELIST_CHECK_RESPONSE',
                        success: false,
                        isInWatchlist: false
                    }, '*');
                    return;
                }

                if (response && response.success) {
                    console.log('[MovieList Extension] Watchlist status:', response.isInWatchlist);
                    window.postMessage({
                        type: 'MOVIELIST_CHECK_RESPONSE',
                        success: true,
                        isInWatchlist: response.isInWatchlist
                    }, '*');
                } else {
                    console.error('[MovieList Extension] Failed to check watchlist:', response.error);
                    window.postMessage({
                        type: 'MOVIELIST_CHECK_RESPONSE',
                        success: false,
                        isInWatchlist: false
                    }, '*');
                }
            });
        } else if (event.data && event.data.type === 'MOVIELIST_REMOVE_FROM_WATCHLIST') {
            console.log('[MovieList Extension] Received remove from watchlist request:', event.data);
            const user = await getUserFromStorage();
            if (!user || !user.uid) {
                window.postMessage({
                    type: 'MOVIELIST_REMOVE_RESPONSE',
                    success: false,
                    error: 'User not authenticated'
                }, '*');
                return;
            }

            chrome.runtime.sendMessage({
                type: 'REMOVE_FROM_WATCHLIST',
                userId: user.uid,
                movieId: event.data.movieId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[MovieList Extension] Error:', chrome.runtime.lastError);
                    window.postMessage({
                        type: 'MOVIELIST_REMOVE_RESPONSE',
                        success: false,
                        error: chrome.runtime.lastError.message
                    }, '*');
                    return;
                }

                if (response && response.success) {
                    console.log('[MovieList Extension] Successfully removed from watchlist');
                    window.postMessage({
                        type: 'MOVIELIST_REMOVE_RESPONSE',
                        success: true
                    }, '*');
                } else {
                    console.error('[MovieList Extension] Failed to remove from watchlist:', response.error);
                    window.postMessage({
                        type: 'MOVIELIST_REMOVE_RESPONSE',
                        success: false,
                        error: response.error || 'Unknown error'
                    }, '*');
                }
            });
        } else if (event.data && event.data.type === 'MOVIELIST_ADD_TO_WATCHLIST') {
            console.log('[MovieList Extension] Received addToWatchlist request:', event.data.movieData);
            const user = await getUserFromStorage();
            if (!user || !user.uid) {
                window.postMessage({
                    type: 'MOVIELIST_WATCHLIST_RESPONSE',
                    success: false,
                    error: 'User not authenticated'
                }, '*');
                return;
            }

            chrome.runtime.sendMessage({
                type: 'ADD_TO_WATCHLIST',
                userId: user.uid,
                movieData: event.data.movieData
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[MovieList Extension] Error:', chrome.runtime.lastError);
                    window.postMessage({
                        type: 'MOVIELIST_WATCHLIST_RESPONSE',
                        success: false,
                        error: chrome.runtime.lastError.message
                    }, '*');
                    return;
                }

                if (response && response.success) {
                    console.log('[MovieList Extension] Successfully added to watchlist');
                    window.postMessage({
                        type: 'MOVIELIST_WATCHLIST_RESPONSE',
                        success: true
                    }, '*');
                } else {
                    console.error('[MovieList Extension] Failed to add to watchlist:', response.error);
                    window.postMessage({
                        type: 'MOVIELIST_WATCHLIST_RESPONSE',
                        success: false,
                        error: response.error || 'Unknown error'
                    }, '*');
                }
            });
        }
    });

    async function init() {
        await createConfigElement();
        setTimeout(() => {
            loadInjectedScript();
        }, 50);
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.user) {
            console.log('[MovieList Extension] User auth state changed');
            const config = document.getElementById('movieListExtensionConfig');
            if (config) {
                if (changes.user.newValue) {
                    config.setAttribute('data-user', JSON.stringify(changes.user.newValue));
                } else {
                    config.removeAttribute('data-user');
                }
            }
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

