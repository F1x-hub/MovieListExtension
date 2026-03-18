try {
    importScripts('../shared/config/kinopoisk.config.js');
    importScripts('../shared/utils/IconUtils.js');
    importScripts('../shared/config/spotify.config.js');
} catch (e) {
    console.error('Failed to import scripts:', e);
}

chrome.runtime.onInstalled.addListener(() => {
    console.log('Movie Rating Extension installed');
    updateIconFromStorage();
});

chrome.runtime.onStartup.addListener(() => {
    updateIconFromStorage();
    setupAuthCheckAlarm();
});

function setupAuthCheckAlarm() {
    chrome.alarms.create('authCheck', { periodInMinutes: 60 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'authCheck') {
        checkAuthToken();
    } else if (alarm.name === 'checkUpdates') {
        checkForUpdates();
    }
});

// Listen for storage changes from other parts of the extension
chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local') {
        if (changes.theme) {
            if (typeof IconUtils !== 'undefined') {
                IconUtils.updateExtensionIcon(changes.theme.newValue);
            }
        }
        if (changes.animeRadioSource) {
            const newSource = changes.animeRadioSource.newValue;
            const STREAM_URLS = {
                anison: 'https://pool.anison.fm/AniSonFM(320)?nocache=' + Date.now(),
                radionami: 'https://relay.radionami.com/any-anime.ru'
            };
            if (newSource && STREAM_URLS[newSource]) {
                try {
                    const hasDoc = await chrome.offscreen.hasDocument();
                    if (hasDoc) {
                        chrome.runtime.sendMessage({ 
                            type: 'RADIO_SET_SOURCE', 
                            streamUrl: STREAM_URLS[newSource],
                            target: 'offscreen-radio' 
                        });
                    }
                } catch (e) {
                    console.error('[Background] Failed to update radio source:', e);
                }
            }
        }
    }
});

function updateIconFromStorage() {
    chrome.storage.local.get(['theme'], (result) => {
        if (typeof IconUtils !== 'undefined') {
            const theme = result.theme || 'dark';
            IconUtils.updateExtensionIcon(theme);
        }
    });
}

let firebaseManagerInstance = null;

async function getFirebaseManagerInExtension() {
    // Load Firebase in extension context (popup or background)
    // This is a simplified version that assumes Firebase is already loaded
    // In practice, this would need to load Firebase scripts
    return firebaseManagerInstance;
}

async function getIdToken() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['user', 'authToken', 'authTokenExpiry', 'tokenValidationTimestamp'], async (result) => {
            if (!result.user || !result.user.uid) {
                reject(new Error('User not authenticated'));
                return;
            }

            // Check if token validation is still valid (less than 24 hours)
            const TOKEN_VALIDATION_TTL = 24 * 60 * 60 * 1000; // 24 hours
            const validationValid = result.tokenValidationTimestamp && 
                                   (Date.now() - result.tokenValidationTimestamp) < TOKEN_VALIDATION_TTL;

            // Check if we have a valid cached token
            if (result.authToken && result.authTokenExpiry && validationValid) {
                const now = Date.now();
                if (now < result.authTokenExpiry) {
                    // Token is still valid and validation is recent, use it
                    resolve(result.authToken);
                    return;
                }
            }

            // If we have a refresh token, try to refresh it
            if (result.refreshToken) {
                console.log('[Background] Token expired or validation needed, attempting refresh...');
                refreshAuthToken(result.refreshToken)
                    .then(newToken => resolve(newToken))
                    .catch(err => {
                        console.error('[Background] Token refresh failed:', err);
                        reject(new Error('Token expired and refresh failed. Please open the extension popup.'));
                    });
                return;
            }

            // Token expired, validation expired, or doesn't exist - need to get a new one
            // Reject and let the user know they need to open popup to refresh authentication
            reject(new Error('Token expired or validation expired. Please open the extension popup to refresh authentication.'));
        });
    });
}

async function checkAuthToken() {
    console.log('[Background] Checking auth token status...');
    chrome.storage.local.get(['user', 'authToken', 'authTokenExpiry', 'tokenValidationTimestamp', 'refreshToken'], async (result) => {
        if (!result.user || !result.refreshToken) {
            console.log('[Background] No user or refresh token found, skipping check');
            return;
        }

        const now = Date.now();
        const TOKEN_REFRESH_THRESHOLD = 55 * 60 * 1000; // Refresh if expires in less than 5 minutes (assuming 1h token)
        
        // Check if token is expired or about to expire
        const isExpired = !result.authTokenExpiry || now >= result.authTokenExpiry;
        const isAboutToExpire = result.authTokenExpiry && (result.authTokenExpiry - now < 5 * 60 * 1000);
        
        // Also check validation timestamp (24h)
        const TOKEN_VALIDATION_TTL = 24 * 60 * 60 * 1000;
        const isValidationOld = !result.tokenValidationTimestamp || (now - result.tokenValidationTimestamp > TOKEN_VALIDATION_TTL - 60 * 60 * 1000); // Refresh 1h before validation expiry

        if (isExpired || isAboutToExpire || isValidationOld) {
            console.log('[Background] Token needs refresh. Expired:', isExpired, 'About to expire:', isAboutToExpire, 'Validation old:', isValidationOld);
            try {
                await refreshAuthToken(result.refreshToken);
            } catch (error) {
                console.error('[Background] Scheduled token refresh failed:', error);
            }
        } else {
            console.log('[Background] Token is valid and fresh');
        }
    });
}

async function refreshAuthToken(refreshToken) {
    const API_KEY = 'AIzaSyC6PI4cBRzn6KLVJ6ikensKus6LaulabO4'; // From firestore.js
    const url = `https://securetoken.googleapis.com/v1/token?key=${API_KEY}`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `grant_type=refresh_token&refresh_token=${refreshToken}`
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error ? error.error.message : 'Token refresh failed');
    }

    const data = await response.json();
    const now = Date.now();
    
    // Update storage
    const updates = {
        authToken: data.id_token,
        authTokenExpiry: now + (parseInt(data.expires_in) * 1000),
        tokenValidationTimestamp: now, // We just validated it with server
        refreshToken: data.refresh_token // Update refresh token if it changed
    };

    await new Promise(resolve => chrome.storage.local.set(updates, resolve));
    console.log('[Background] Token successfully refreshed via REST API');
    
    return data.id_token;
}

async function addToWatchlistViaAPI(userId, movieData) {
    try {
        const token = await getIdToken();
        const projectId = 'movielistdb-13208';
        const docId = `${userId}_${movieData.movieId}`;
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/watchlist/${docId}`;
        
        const watchlistData = {
            fields: {
                userId: { stringValue: userId },
                movieId: { integerValue: movieData.movieId.toString() },
                movieTitle: { stringValue: movieData.movieTitle || '' },
                movieTitleRu: { stringValue: movieData.movieTitleRu || '' },
                posterPath: { stringValue: movieData.posterPath || '' },
                releaseYear: movieData.releaseYear ? { integerValue: movieData.releaseYear.toString() } : { nullValue: null },
                genres: { arrayValue: { values: (movieData.genres || []).map(g => ({ stringValue: g.name || g })) } },
                description: { stringValue: movieData.description || '' },
                kpRating: { doubleValue: movieData.kpRating || 0 },
                imdbRating: { doubleValue: movieData.imdbRating || 0 },
                avgRating: { doubleValue: movieData.avgRating || 0 },
                notes: { stringValue: movieData.notes || '' },
                addedAt: { timestampValue: new Date().toISOString() }
            }
        };

        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(watchlistData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Firestore error: ${response.status} ${errorText}`);
        }

        return true;
    } catch (error) {
        console.error('[Background] Error adding to watchlist via API:', error);
        throw error;
    }
}

async function checkWatchlistStatusViaAPI(userId, movieId) {
    try {
        const token = await getIdToken();
        const projectId = 'movielistdb-13208';
        const docId = `${userId}_${movieId}`;
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/watchlist/${docId}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.status === 404) {
            return false; // Not in watchlist
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Firestore error: ${response.status} ${errorText}`);
        }

        return true; // In watchlist
    } catch (error) {
        console.error('[Background] Error checking watchlist status via API:', error);
        // If error is 404, return false
        if (error.message.includes('404')) {
            return false;
        }
        throw error;
    }
}

async function addRatingViaAPI(userId, userName, userPhoto, movieId, movieTitle, posterPath, rating, comment) {
    try {
        const token = await getIdToken();
        const projectId = 'movielistdb-13208';
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/ratings`;
        
        const ratingData = {
            fields: {
                userId: { stringValue: userId },
                userName: { stringValue: userName || '' },
                userPhoto: { stringValue: userPhoto || '' },
                movieId: { integerValue: movieId.toString() },
                movieTitle: { stringValue: movieTitle || '' },
                posterPath: { stringValue: posterPath || '' },
                rating: { integerValue: rating.toString() },
                comment: { stringValue: comment || '' },
                isFavorite: { booleanValue: false },
                createdAt: { timestampValue: new Date().toISOString() },
                updatedAt: { timestampValue: new Date().toISOString() }
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(ratingData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Firestore error: ${response.status} ${errorText}`);
        }

        return true;
    } catch (error) {
        console.error('[Background] Error adding rating via API:', error);
        throw error;
    }
}

async function checkFavoriteStatusViaAPI(userId, movieId) {
    try {
        const token = await getIdToken();
        const projectId = 'movielistdb-13208';
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
        
        const query = {
            structuredQuery: {
                from: [{ collectionId: 'ratings' }],
                where: {
                    compositeFilter: {
                        op: 'AND',
                        filters: [
                            {
                                fieldFilter: {
                                    field: { fieldPath: 'userId' },
                                    op: 'EQUAL',
                                    value: { stringValue: userId }
                                }
                            },
                            {
                                fieldFilter: {
                                    field: { fieldPath: 'movieId' },
                                    op: 'EQUAL',
                                    value: { integerValue: movieId.toString() }
                                }
                            },
                            {
                                fieldFilter: {
                                    field: { fieldPath: 'isFavorite' },
                                    op: 'EQUAL',
                                    value: { booleanValue: true }
                                }
                            }
                        ]
                    }
                },
                limit: 1
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(query)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Firestore error: ${response.status} ${errorText}`);
        }

        const results = await response.json();
        return results.length > 0 && results[0].document;
    } catch (error) {
        console.error('[Background] Error checking favorite status via API:', error);
        return false;
    }
}

async function addFavoriteViaAPI(userId, movieId, movieTitle, posterPath, rating) {
    try {
        const token = await getIdToken();
        const projectId = 'movielistdb-13208';
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
        
        // First, find the rating document
        const query = {
            structuredQuery: {
                from: [{ collectionId: 'ratings' }],
                where: {
                    compositeFilter: {
                        op: 'AND',
                        filters: [
                            {
                                fieldFilter: {
                                    field: { fieldPath: 'userId' },
                                    op: 'EQUAL',
                                    value: { stringValue: userId }
                                }
                            },
                            {
                                fieldFilter: {
                                    field: { fieldPath: 'movieId' },
                                    op: 'EQUAL',
                                    value: { integerValue: movieId.toString() }
                                }
                            }
                        ]
                    }
                },
                limit: 1
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(query)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Firestore error: ${response.status} ${errorText}`);
        }

        const results = await response.json();
        if (results.length > 0 && results[0].document) {
            // Update existing rating to favorite
            const docName = results[0].document.name;
            const updateUrl = `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=isFavorite&updateMask.fieldPaths=favoritedAt`;
            
            const updateData = {
                fields: {
                    isFavorite: { booleanValue: true },
                    favoritedAt: { timestampValue: new Date().toISOString() }
                }
            };

            const updateResponse = await fetch(updateUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });

            if (!updateResponse.ok) {
                const errorText = await updateResponse.text();
                throw new Error(`Firestore error: ${updateResponse.status} ${errorText}`);
            }
        }

        return true;
    } catch (error) {
        console.error('[Background] Error adding favorite via API:', error);
        throw error;
    }
}

async function removeFavoriteViaAPI(userId, movieId) {
    try {
        const token = await getIdToken();
        const projectId = 'movielistdb-13208';
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
        
        // First, find the rating document
        const query = {
            structuredQuery: {
                from: [{ collectionId: 'ratings' }],
                where: {
                    compositeFilter: {
                        op: 'AND',
                        filters: [
                            {
                                fieldFilter: {
                                    field: { fieldPath: 'userId' },
                                    op: 'EQUAL',
                                    value: { stringValue: userId }
                                }
                            },
                            {
                                fieldFilter: {
                                    field: { fieldPath: 'movieId' },
                                    op: 'EQUAL',
                                    value: { integerValue: movieId.toString() }
                                }
                            }
                        ]
                    }
                },
                limit: 1
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(query)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Firestore error: ${response.status} ${errorText}`);
        }

        const results = await response.json();
        if (results.length > 0 && results[0].document) {
            // Update existing rating to remove favorite
            const docName = results[0].document.name;
            const updateUrl = `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=isFavorite`;
            
            const updateData = {
                fields: {
                    isFavorite: { booleanValue: false }
                }
            };

            const updateResponse = await fetch(updateUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updateData)
            });

            if (!updateResponse.ok) {
                const errorText = await updateResponse.text();
                throw new Error(`Firestore error: ${updateResponse.status} ${errorText}`);
            }
        }

        return true;
    } catch (error) {
        console.error('[Background] Error removing favorite via API:', error);
        throw error;
    }
}

async function removeFromWatchlistViaAPI(userId, movieId) {
    try {
        const token = await getIdToken();
        const projectId = 'movielistdb-13208';
        const docId = `${userId}_${movieId}`;
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/watchlist/${docId}`;

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.status === 404) {
            return false; // Already not in watchlist
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Firestore error: ${response.status} ${errorText}`);
        }

        return true;
    } catch (error) {
        console.error('[Background] Error removing from watchlist via API:', error);
        throw error;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ADD_TO_WATCHLIST') {
        console.log('[Background] Received ADD_TO_WATCHLIST request for user:', message.userId);
        addToWatchlistViaAPI(message.userId, message.movieData)
            .then(() => {
                console.log('[Background] Successfully added to watchlist via API');
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('[Background] Error adding to watchlist:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === 'SEARCH_MOVIE') {
        console.log('[Background] Received SEARCH_MOVIE request - KP ID:', message.kpId, 'Title:', message.title, 'Year:', message.year);
        // For search, we can use Kinopoisk API directly without Firebase
        searchKinopoiskMovie(message.kpId, message.title, message.year)
            .then(movie => {
                console.log('[Background] Movie search completed, movie:', movie ? movie.name : 'not found');
                sendResponse({ success: true, movie: movie });
            })
            .catch(error => {
                console.error('[Background] Error searching movie:', error);
                sendResponse({ success: false, error: error.message, movie: null });
            });
        return true;
    } else if (message.type === 'CHECK_WATCHLIST') {
        console.log('[Background] Received CHECK_WATCHLIST request for user:', message.userId, 'movie:', message.movieId);
        checkWatchlistStatusViaAPI(message.userId, message.movieId)
            .then(isInWatchlist => {
                console.log('[Background] Watchlist status:', isInWatchlist);
                sendResponse({ success: true, isInWatchlist: isInWatchlist });
            })
            .catch(error => {
                console.error('[Background] Error checking watchlist:', error);
                sendResponse({ success: false, error: error.message, isInWatchlist: false });
            });
        return true;
    } else if (message.type === 'REMOVE_FROM_WATCHLIST') {
        console.log('[Background] Received REMOVE_FROM_WATCHLIST request for user:', message.userId, 'movie:', message.movieId);
        removeFromWatchlistViaAPI(message.userId, message.movieId)
            .then(() => {
                console.log('[Background] Successfully removed from watchlist via API');
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('[Background] Error removing from watchlist:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === 'ADD_RATING') {
        console.log('[Background] Received ADD_RATING request for user:', message.userId, 'movie:', message.movieId, 'rating:', message.rating);
        addRatingViaAPI(message.userId, message.userName, message.userPhoto, message.movieId, message.movieTitle, message.posterPath, message.rating, message.comment)
            .then(() => {
                console.log('[Background] Successfully added rating via API');
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('[Background] Error adding rating:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === 'CHECK_FAVORITE') {
        console.log('[Background] Received CHECK_FAVORITE request for user:', message.userId, 'movie:', message.movieId);
        checkFavoriteStatusViaAPI(message.userId, message.movieId)
            .then(isFavorite => {
                console.log('[Background] Favorite status:', isFavorite);
                sendResponse({ success: true, isFavorite: isFavorite });
            })
            .catch(error => {
                console.error('[Background] Error checking favorite:', error);
                sendResponse({ success: false, error: error.message, isFavorite: false });
            });
        return true;
    } else if (message.type === 'ADD_FAVORITE') {
        console.log('[Background] Received ADD_FAVORITE request for user:', message.userId, 'movie:', message.movieId);
        addFavoriteViaAPI(message.userId, message.movieId, message.movieTitle, message.posterPath, message.rating)
            .then(() => {
                console.log('[Background] Successfully added favorite via API');
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('[Background] Error adding favorite:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === 'REMOVE_FAVORITE') {
        console.log('[Background] Received REMOVE_FAVORITE request for user:', message.userId, 'movie:', message.movieId);
        removeFavoriteViaAPI(message.userId, message.movieId)
            .then(() => {
                console.log('[Background] Successfully removed favorite via API');
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('[Background] Error removing favorite:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === 'GET_ID_TOKEN') {
        // This will be handled by popup or content script that has access to Firebase
        sendResponse({ error: 'Not implemented in service worker' });
        return true;
    } else if (message.type === 'DOWNLOAD_UPDATE') {
        console.log('[Background] Received DOWNLOAD_UPDATE request');
        if (message.url) {
            downloadUpdate(message.url)
                .then((downloadId) => {
                    sendResponse({ success: true, downloadId: downloadId });
                })
                .catch((error) => {
                    sendResponse({ success: false, error: error.message || 'Download failed' });
                });
        } else {
            sendResponse({ success: false, error: 'No URL provided' });
        }
        return true; // Keep channel open for async response
    } else if (message.type === 'CHECK_FOR_UPDATES') {
        console.log('[Background] Received CHECK_FOR_UPDATES request');
        checkForUpdates()
            .then(() => {
                sendResponse({ success: true });
            })
            .catch(error => {
                console.error('[Background] Error checking for updates:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    } else if (message.type === 'FETCH_HTML') {
        fetch(message.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.text();
        })
        .then(html => sendResponse({ success: true, data: html }))
        .catch(error => sendResponse({ success: false, error: error.message }));
        
        return true; // Keep channel open for async response
    } else if (message.type === 'GET_SPOTIFY_TOKEN') {
        getSpotifyToken()
            .then(token => sendResponse({ success: true, token: token }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    } else if (message.type === 'RADIO_GET_METADATA') {
        // Handle metadata fetch in background (not relay to offscreen)
        fetchAnisonMetadata()
            .then(meta => sendResponse(meta))
            .catch(err => {
                console.warn('[Background] Metadata fetch error:', err);
                sendResponse({ error: err.message });
            });
        return true;
    } else if (message.type && message.type.startsWith('RADIO_')) {
        // Relay radio messages to the offscreen document
        ensureOffscreen()
            .then(() => chrome.runtime.sendMessage({ ...message, target: 'offscreen-radio' }))
            .then(response => sendResponse(response))
            .catch(err => {
                console.warn('[Background] Radio relay error:', err);
                sendResponse({ error: err.message });
            });
        return true;
    }
});

// --- Offscreen Document for Radio ---
let _offscreenPromise = null;
async function ensureOffscreen() {
    if (_offscreenPromise) return _offscreenPromise;
    _offscreenPromise = (async () => {
        try {
            const existing = await chrome.offscreen.hasDocument();
            if (!existing) {
                await chrome.offscreen.createDocument({
                    url: 'src/offscreen/offscreen.html',
                    reasons: ['AUDIO_PLAYBACK'],
                    justification: 'Persistent anime radio playback across extension pages'
                });
            }
        } finally {
            _offscreenPromise = null;
        }
    })();
    return _offscreenPromise;
}

// --- Auto-stop radio when all extension pages are closed ---
async function checkExtensionPagesOpen() {
    const extUrl = chrome.runtime.getURL('');
    const views = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const extPages = views.filter(v => v.documentUrl && v.documentUrl.startsWith(extUrl));
    if (extPages.length === 0) {
        // No extension pages open — stop radio and close offscreen
        try {
            const hasDoc = await chrome.offscreen.hasDocument();
            if (hasDoc) {
                await chrome.runtime.sendMessage({ type: 'RADIO_STOP', target: 'offscreen-radio' });
                await chrome.offscreen.closeDocument();
            }
        } catch (e) {
            // Offscreen already closed or error, ignore
        }
    }
}

chrome.tabs.onRemoved.addListener(() => {
    // Small delay to let Chrome finish cleanup
    setTimeout(checkExtensionPagesOpen, 500);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
        setTimeout(checkExtensionPagesOpen, 500);
    }
});

// --- Anison.FM Metadata Parser (regex, no DOMParser in service workers) ---
async function fetchAnisonMetadata() {
    const res = await fetch('https://anison.fm/', { cache: 'no-store' });
    if (!res.ok) throw new Error(`anison.fm returned ${res.status}`);
    const html = await res.text();

    const extract = (regex) => {
        const m = html.match(regex);
        return m ? m[1].trim() : '';
    };

    // #on_air .anime a  →  <div id="on_air">...<span class="anime"><a ...>NAME</a></span>
    const animeName = extract(/<span[^>]*class="anime"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i);
    // #on_air .title  →  <span class="title">TRACK</span>
    const trackTitle = extract(/<span[^>]*class="title"[^>]*>([^<]+)<\/span>/i);
    // #current_poster_img  →  <img id="current_poster_img" src="URL"
    const posterUrl = extract(/<img[^>]*id="current_poster_img"[^>]*src="([^"]+)"/i);
    // #curent_poster  →  <a id="curent_poster" href="URL"
    const animeLink = extract(/<a[^>]*id="curent_poster"[^>]*href="([^"]+)"/i);
    // #duration  →  <span id="duration">2:40</span>
    const duration = extract(/<span[^>]*id="duration"[^>]*>([^<]*)<\/span>/i);

    return { animeName, trackTitle, posterUrl, animeLink, duration };
}

async function fetchKinopoiskWithRotation(url, options = {}) {
    const maxAttempts = typeof KINOPOISK_CONFIG !== 'undefined' && KINOPOISK_CONFIG.API_KEYS 
        ? KINOPOISK_CONFIG.API_KEYS.length 
        : 1;
        
    let lastResponse = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const currentKey = typeof KINOPOISK_CONFIG !== 'undefined' 
            ? KINOPOISK_CONFIG.API_KEY 
            : 'Q6Q938P-CG3M56S-GKJRF4P-J3TSZ6S';
            
        const fetchOptions = { ...options };
        fetchOptions.headers = {
            ...options.headers,
            'X-API-KEY': currentKey
        };
        
        const response = await fetch(url, fetchOptions);
        lastResponse = response;

        if (response.status === 403 || response.status === 402) {
            console.warn(`[Background] ${response.status} Error. Rotating key...`);
            if (typeof KINOPOISK_CONFIG !== 'undefined' && typeof KINOPOISK_CONFIG.rotateKey === 'function') {
                KINOPOISK_CONFIG.rotateKey();
            }
            if (attempt < maxAttempts - 1) continue;
        }
        
        return response;
    }
    return lastResponse;
}

async function searchKinopoiskMovie(kpId, title, year) {
    if (kpId) {
        const response = await fetchKinopoiskWithRotation(`https://api.kinopoisk.dev/v1.4/movie/${kpId}`);
        if (!response.ok) {
            throw new Error(`Kinopoisk API error: ${response.status}`);
        }
        return await response.json();
    } else if (title) {
        // Search with more results to find the best match
        const response = await fetchKinopoiskWithRotation(`https://api.kinopoisk.dev/v1.4/movie/search?page=1&limit=10&query=${encodeURIComponent(title)}`);
        if (!response.ok) {
            throw new Error(`Kinopoisk API error: ${response.status}`);
        }
        const data = await response.json();
        
        if (!data.docs || data.docs.length === 0) {
            return null;
        }
        
        // If year is provided, try to find exact match by year
        if (year) {
            console.log(`[Background] Filtering results by year: ${year}`);
            // First, try exact year match
            const exactYearMatch = data.docs.find(movie => movie.year === year);
            if (exactYearMatch) {
                console.log(`[Background] Found exact year match: ${exactYearMatch.name} (${exactYearMatch.year})`);
                return exactYearMatch;
            }
            
            // If no exact match, try year ± 1 (in case of different release dates)
            const yearRangeMatch = data.docs.find(movie => 
                movie.year && Math.abs(movie.year - year) <= 1
            );
            if (yearRangeMatch) {
                console.log(`[Background] Found year range match: ${yearRangeMatch.name} (${yearRangeMatch.year})`);
                return yearRangeMatch;
            }
            
            console.log(`[Background] No year match found, using first result: ${data.docs[0].name} (${data.docs[0].year})`);
        }
        
        // If no year provided or no year match, return first result
        return data.docs[0];
    }
    return null;
}

// --- Automatic Update System ---

const UPDATE_CONFIG = {
    githubOwner: 'F1x-hub',
    githubRepo: 'MovieListExtension',
    checkInterval: 60, // Check every 60 minutes
    extensionPath: 'd:\\Programing\\JS\\Projects\\MovieListExstension' // Should match user's path
};

// Check for updates on startup and periodically
chrome.runtime.onStartup.addListener(() => {
    checkForUpdates();
});

chrome.alarms.create('checkUpdates', { periodInMinutes: UPDATE_CONFIG.checkInterval });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkUpdates') {
        checkForUpdates();
    }
});

async function checkForUpdates() {
    try {
        const manifest = chrome.runtime.getManifest();
        const currentVersion = manifest.version;

        const response = await fetch(`https://api.github.com/repos/${UPDATE_CONFIG.githubOwner}/${UPDATE_CONFIG.githubRepo}/releases/latest`);
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const data = await response.json();
        const latestVersion = data.tag_name.replace('v', ''); // Remove 'v' prefix if present

        if (compareVersions(latestVersion, currentVersion) > 0) {
            console.log(`[Update] Update available: ${currentVersion} -> ${latestVersion}`);
            
            // Find zip asset
            const zipAsset = data.assets.find(asset => asset.name.endsWith('.zip')) || 
                             data.assets[0]; // Fallback to first asset
            
            const downloadUrl = zipAsset ? zipAsset.browser_download_url : data.zipball_url;

            if (downloadUrl) {
                showUpdateNotification(latestVersion, downloadUrl);
            } else {
                console.error('[Update] No download URL found');
            }
        } else {
            // Clear any pending update info if version matches or is older
            chrome.storage.local.remove(['pendingUpdateUrl', 'pendingUpdateVersion', 'updateAvailable']);
        }
    } catch (error) {
        console.error('[Update] Error checking for updates:', error);
    }
}

// Expose for debugging
self.checkForUpdates = checkForUpdates;


function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

function showUpdateNotification(version, downloadUrl) {
    // Store update info for popup to display
    chrome.storage.local.set({ 
        pendingUpdateUrl: downloadUrl, 
        pendingUpdateVersion: version,
        updateAvailable: true 
    }, () => {
        console.log(`[Update] Update info stored for popup: v${version}`);
        // Optionally send a message to popup if it's open to update UI immediately
        chrome.runtime.sendMessage({ 
            type: 'UPDATE_AVAILABLE', 
            version: version, 
            url: downloadUrl 
        }).catch(() => {
            // Popup might be closed, which is fine
        });
    });
}

// Removed chrome.notifications.onButtonClicked listener as we moved to popup UI

function downloadUpdate(url) {
    console.log('[Update] Downloading repository from:', url);
    return new Promise((resolve, reject) => {
        chrome.downloads.download({
            url: url,
            filename: 'MovieListExtension-update.zip',
            conflictAction: 'overwrite',
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('[Update] Download failed:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                console.log('[Update] Download started, ID:', downloadId);
                resolve(downloadId);
            }
        });
    });
}

// --- Display Mode Logic ---

// Initialize display mode on startup
chrome.runtime.onStartup.addListener(() => {
    initializeDisplayMode();
});

chrome.runtime.onInstalled.addListener(() => {
    initializeDisplayMode();
});

function initializeDisplayMode() {
    chrome.storage.local.get(['displayMode'], (result) => {
        const mode = result.displayMode || 'popup';
        updateExtensionAction(mode);
    });
}

function updateExtensionAction(mode) {
    console.log('[Background] Updating extension action for mode:', mode);
    if (mode === 'popup') {
        // Enable popup mode
        chrome.action.setPopup({ popup: 'src/popup/popup.html' });
        // Disable side panel opening on click
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
            .catch(error => console.error('[Background] Error disabling side panel:', error));
    } else if (mode === 'sidepanel') {
        // Disable popup so side panel can open
        chrome.action.setPopup({ popup: '' });
        // Enable side panel opening on click
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
            .catch(error => console.error('[Background] Error enabling side panel:', error));
    }
}

// Listen for settings updates from settings page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SETTINGS_UPDATED' && message.settings.displayMode) {
        updateExtensionAction(message.settings.displayMode);
    }
});

// --- Spotify Integration ---
let spotifyAccessToken = null;
let spotifyTokenExpiration = 0;

async function getSpotifyToken() {
    // Return valid cached token
    if (spotifyAccessToken && Date.now() < spotifyTokenExpiration) {
        return spotifyAccessToken;
    }

    if (typeof SPOTIFY_CONFIG === 'undefined') {
        throw new Error('Spotify config not loaded');
    }

    try {
        const response = await fetch(SPOTIFY_CONFIG.ENDPOINTS.TOKEN, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + btoa(SPOTIFY_CONFIG.CLIENT_ID + ':' + SPOTIFY_CONFIG.CLIENT_SECRET)
            },
            body: 'grant_type=client_credentials'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error_description || 'Failed to get token');
        }

        const data = await response.json();
        spotifyAccessToken = data.access_token;
        // Set expiration slightly before actual expiry (usually 3600s)
        spotifyTokenExpiration = Date.now() + (data.expires_in * 1000) - 60000;
        
        return spotifyAccessToken;
    } catch (error) {
        console.error('[Background] Spotify token error:', error);
        throw error;
    }
}
