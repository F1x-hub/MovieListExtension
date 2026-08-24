try {
    importScripts('../shared/config/kinopoisk.config.js');
    importScripts('../shared/utils/IconUtils.js');
    importScripts('../shared/config/spotify.config.js');
    importScripts('../shared/config/theNumbersMappings.js');
    importScripts('../shared/services/TheNumbersService.js');
} catch (e) {
    console.error('Failed to import scripts:', e);
}

chrome.runtime.onInstalled.addListener(() => {
    console.log('Movie Rating Extension installed');
    updateIconFromStorage();
    setupTheNumbersRefreshAlarm();
});

chrome.runtime.onStartup.addListener(() => {
    updateIconFromStorage();
    setupAuthCheckAlarm();
    setupTheNumbersRefreshAlarm();
});

function setupAuthCheckAlarm() {
    chrome.alarms.create('authCheck', { periodInMinutes: 60 });
}

function setupTheNumbersRefreshAlarm() {
    chrome.alarms.create('theNumbersRefresh', { periodInMinutes: 24 * 60 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'authCheck') {
        checkAuthToken();
    } else if (alarm.name === 'theNumbersRefresh') {
        refreshTrackedTheNumbersMovies();
    } else if (alarm.name === 'checkUpdates') {
        checkForUpdates();
    }
});

async function refreshTrackedTheNumbersMovies() {
    if (typeof TheNumbersService !== 'function') return;
    try {
        const service = new TheNumbersService();
        const results = await service.refreshTrackedMovies();
        console.info('[TheNumbers] Daily refresh completed', results);
    } catch (error) {
        console.warn('[TheNumbers] Daily refresh failed:', error);
    }
}

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



async function getIdToken() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['user', 'authToken', 'authTokenExpiry', 'tokenValidationTimestamp', 'refreshToken'], async (result) => {
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

async function getStoredUser() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['user', 'isAuthenticated'], (result) => {
            if (result.user?.uid) {
                resolve(result.user);
                return;
            }

            resolve(null);
        });
    });
}

function toFirestoreValue(value) {
    if (value === null || typeof value === 'undefined') {
        return { nullValue: null };
    }

    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return { integerValue: value.toString() };
        }

        return { doubleValue: value };
    }

    if (typeof value === 'boolean') {
        return { booleanValue: value };
    }

    return { stringValue: String(value) };
}

function fromFirestoreValue(field) {
    if (!field || typeof field !== 'object') {
        return null;
    }

    if ('stringValue' in field) return field.stringValue;
    if ('integerValue' in field) return Number(field.integerValue);
    if ('doubleValue' in field) return Number(field.doubleValue);
    if ('booleanValue' in field) return Boolean(field.booleanValue);
    if ('timestampValue' in field) return field.timestampValue;
    if ('nullValue' in field) return null;

    if ('arrayValue' in field) {
        return (field.arrayValue.values || []).map(fromFirestoreValue);
    }

    if ('mapValue' in field) {
        const mapped = {};
        Object.entries(field.mapValue.fields || {}).forEach(([key, value]) => {
            mapped[key] = fromFirestoreValue(value);
        });
        return mapped;
    }

    return null;
}

function fromFirestoreDocument(document) {
    const parsed = {
        id: document.name ? document.name.split('/').pop() : null
    };

    Object.entries(document.fields || {}).forEach(([key, value]) => {
        parsed[key] = fromFirestoreValue(value);
    });

    return parsed;
}

function buildEqualityFilter(fieldPath, value) {
    return {
        fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: toFirestoreValue(value)
        }
    };
}

async function runStructuredQuery(token, structuredQuery) {
    const projectId = 'movielistdb-13208';
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ structuredQuery })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Firestore error: ${response.status} ${errorText}`);
    }

    const results = await response.json();
    return results
        .filter((item) => item.document)
        .map((item) => fromFirestoreDocument(item.document));
}

async function getItemsByStatusViaAPI(status) {
    const user = await getStoredUser();
    if (!user?.uid) {
        throw new Error('User not authenticated');
    }

    const token = await getIdToken();
    const mergedItems = new Map();

    const favoritesQuery = {
        from: [{ collectionId: 'favorites' }],
        where: {
            compositeFilter: {
                op: 'AND',
                filters: [
                    buildEqualityFilter('userId', user.uid),
                    buildEqualityFilter('status', status)
                ]
            }
        }
    };

    try {
        const favoritesItems = await runStructuredQuery(token, favoritesQuery);
        favoritesItems.forEach((item) => {
            const key = String(item.movieId || item.id);
            mergedItems.set(key, item);
        });
    } catch (error) {
        console.warn('[Background] Favorites status query failed:', error);
    }

    if (status === 'watching') {
        const watchingQuery = {
            from: [{ collectionId: 'watching' }],
            where: buildEqualityFilter('userId', user.uid)
        };

        try {
            const watchingItems = await runStructuredQuery(token, watchingQuery);
            watchingItems.forEach((item) => {
                const key = String(item.movieId || item.id);
                if (!mergedItems.has(key)) {
                    mergedItems.set(key, {
                        ...item,
                        status: 'watching'
                    });
                }
            });
        } catch (error) {
            console.warn('[Background] Legacy watching query failed:', error);
        }
    } else if (status === 'plan_to_watch') {
        const watchlistQuery = {
            from: [{ collectionId: 'watchlist' }],
            where: buildEqualityFilter('userId', user.uid)
        };

        try {
            const watchlistItems = await runStructuredQuery(token, watchlistQuery);
            watchlistItems.forEach((item) => {
                const key = String(item.movieId || item.id);
                if (!mergedItems.has(key)) {
                    mergedItems.set(key, {
                        ...item,
                        status: 'plan_to_watch'
                    });
                }
            });
        } catch (error) {
            console.warn('[Background] Legacy watchlist query failed:', error);
        }
    }

    return Array.from(mergedItems.values());
}

async function checkAuthToken() {
    console.log('[Background] Checking auth token status...');
    chrome.storage.local.get(['user', 'authToken', 'authTokenExpiry', 'tokenValidationTimestamp', 'refreshToken'], async (result) => {
        if (!result.user || !result.refreshToken) {
            console.log('[Background] No user or refresh token found, skipping check');
            return;
        }

        const now = Date.now();
        
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
    if (message.action === 'getWatchlistByStatus') {
        getItemsByStatusViaAPI(message.status || 'watching')
            .then((items) => {
                sendResponse({ success: true, items });
            })
            .catch((error) => {
                console.error('[Background] Error loading items by status:', error);
                sendResponse({ success: false, error: error.message, items: [] });
            });
        return true;
    } else if (message.type === 'ADD_TO_WATCHLIST') {
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
        getIdToken()
            .then(token => sendResponse({ success: true, token }))
            .catch(() => sendResponse({ success: false, error: 'AUTH_REQUIRED' }));
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
    } else if (message.type === 'GET_SPOTIFY_TOKEN') {
        getSpotifyToken()
            .then(token => sendResponse({ success: true, token: token }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    } else if (message.type === 'CHECK_BOT_STATUS') {
        fetch('https://movie-preview-bot.vercel.app/api/schedule')
            .then(res => sendResponse({ ok: res.ok }))
            .catch(() => sendResponse({ ok: false }));
        return true;
    } else if (message.type === 'SCHEDULE_ANNOUNCE') {
        fetch('https://movie-preview-bot.vercel.app/api/schedule', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer KJjiiuj132ag'
            },
            body: JSON.stringify({
                movie: message.movie,
                scheduledAt: message.scheduledAt,
                rawDateStr: message.rawDateStr
            })
        })
        .then(async (res) => {
            const data = await res.json();
            sendResponse({ success: res.ok, error: data.error });
        })
        .catch(err => {
            sendResponse({ success: false, error: err.message });
        });
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
    } else if (message.type === 'KINOPOISK_OFFSCREEN_SCRAPE') {
        // Coordinate browser-based search scraping via hidden offscreen iframe
        handleKinopoiskOffscreenScrape(message.query, message.timeoutMs || 8000, {
            requireRating: message.requireRating === true,
            requestKey: message.requestKey,
            priority: message.priority,
            sessionId: message.sessionId
        })
            .then(result => sendResponse(result))
            .catch(err => {
                console.warn('[Background] Offscreen scrape error:', err);
                sendResponse({ success: false, reason: err.message, items: [] });
            });
        return true;
    } else if (message.type === 'KINOPOISK_MOVIE_RATINGS_OFFSCREEN') {
        handleKinopoiskMoviePageRatingsOffscreen(message.kinopoiskId, message.timeoutMs || 8000, {
            mediaType: message.mediaType,
            requestKey: message.requestKey,
            priority: message.priority,
            sessionId: message.sessionId
        })
            .then(result => sendResponse(result))
            .catch(err => {
                console.warn('[Background] KP movie-page rating scrape error:', err);
                sendResponse({ success: false, reason: err.message, ratings: null });
            });
        return true;
    } else if (message.type === 'KINOPOISK_OFFSCREEN_CANCEL') {
        const cancelled = cancelSearchRequest({
            requestKey: message.requestKey || null,
            requestId: message.requestId || null
        });
        sendResponse({ success: cancelled });
        return false;
    } else if (message.target === 'kinopoisk-search-coordinator') {
        // Message from content script running inside the scraper iframe
        if (_currentSearchRequest?.provider === 'kinopoisk'
            || _currentSearchRequest?.provider === 'kinopoisk-detail') {
            if (!message.requestId || !_currentSearchRequest.requestId || message.requestId === _currentSearchRequest.requestId) {
                if (message.type === 'SCRAPE_RESULT_SUCCESS') {
                    _currentSearchRequest.finish({ success: true, items: message.items || [] });
                } else if (message.type === 'SCRAPE_MOVIE_RATINGS_SUCCESS') {
                    _currentSearchRequest.finish({ success: true, ratings: message.ratings || null });
                } else if (message.type === 'SCRAPE_RESULT_BLOCKED') {
                    _currentSearchRequest.finish({ success: false, reason: message.reason || 'SCRAPE_BLOCKED_EVEN_WITH_SESSION', items: [] });
                } else {
                    _currentSearchRequest.finish({ success: false, reason: message.reason || 'SCRAPE_TIMEOUT', items: [] });
                }
            }
        }
        return false;
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

// --- Offscreen Document Coordinator (Radio & Search Scraper) ---
let _offscreenPromise = null;
let _currentSearchRequest = null;
const _searchQueue = [];
const _searchInFlight = new Map();
const _recentSearchResults = new Map();
let _searchSequence = 0;
const SEARCH_RESULT_CACHE_TTL_MS = 30_000;

const SEARCH_PRIORITY_WEIGHT = {
    'visible-identity': 100,
    'visible-ratings': 90,
    'below-viewport': 40,
    retry: 10
};

async function ensureOffscreen() {
    if (_offscreenPromise) return _offscreenPromise;
    _offscreenPromise = (async () => {
        try {
            const existing = await chrome.offscreen.hasDocument();
            if (!existing) {
                await chrome.offscreen.createDocument({
                    url: 'src/offscreen/offscreen.html',
                    reasons: ['AUDIO_PLAYBACK', 'DOM_SCRAPING', 'IFRAME_SCRIPTING'],
                    justification: 'Background audio playback and browser-context search scraping'
                });
            }
        } finally {
            _offscreenPromise = null;
        }
    })();
    return _offscreenPromise;
}

async function handleKinopoiskOffscreenScrape(query, timeoutMs = 8000, options = {}) {
    if (!query) return { success: false, reason: 'EMPTY_QUERY', items: [] };
    return enqueueSearchRequest({
        provider: 'kinopoisk',
        query,
        timeoutMs,
        requireRating: options.requireRating === true,
        requestKey: options.requestKey,
        priority: options.priority || 'visible-identity',
        sessionId: options.sessionId || null
    });
}

async function handleKinopoiskMoviePageRatingsOffscreen(kinopoiskId, timeoutMs = 8000, options = {}) {
    const numericId = Number(kinopoiskId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
        return { success: false, reason: 'INVALID_KINOPOISK_ID', ratings: null };
    }

    return enqueueSearchRequest({
        provider: 'kinopoisk-detail',
        query: String(numericId),
        mediaType: options.mediaType || null,
        timeoutMs,
        requestKey: options.requestKey || `kp-detail:${numericId}:${options.mediaType || 'movie'}`,
        priority: options.priority || 'visible-ratings',
        sessionId: options.sessionId || null
    });
}

function getSearchRequestKey(item) {
    if (item.requestKey) return String(item.requestKey);
    return `${item.provider}:${String(item.query || '').trim().toLowerCase()}:${item.requireRating ? 'rating' : 'identity'}:${item.mediaType || ''}`;
}

function getSearchPriorityWeight(priority) {
    return SEARCH_PRIORITY_WEIGHT[priority] || SEARCH_PRIORITY_WEIGHT['below-viewport'];
}

function enqueueSearchRequest(item) {
    const requestKey = getSearchRequestKey(item);
    const recent = _recentSearchResults.get(requestKey);
    if (recent && recent.expiresAt > Date.now()) {
        return Promise.resolve({
            ...recent.result,
            metrics: {
                ...recent.result.metrics,
                cacheHit: true,
                inFlightHit: false,
                queueWaitMs: 0,
                serviceMs: 0
            }
        });
    }
    if (recent) _recentSearchResults.delete(requestKey);

    const existing = _searchInFlight.get(requestKey);
    if (existing) {
        existing.inFlightHits += 1;
        existing.consumerCount += 1;
        return existing.promise;
    }

    const entry = {
        ...item,
        requestKey,
        sequence: ++_searchSequence,
        enqueuedAt: Date.now(),
        inFlightHits: 0,
        consumerCount: 1,
        resolve: null,
        promise: null,
        finish: null,
        requestId: null
    };
    entry.promise = new Promise(resolve => { entry.resolve = resolve; });
    _searchInFlight.set(requestKey, entry);
    _searchQueue.push(entry);
    processSearchQueue();
    return entry.promise;
}

function pickNextSearchIndex() {
    let bestIndex = 0;
    let bestScore = -Infinity;
    const now = Date.now();
    _searchQueue.forEach((item, index) => {
        const ageBoost = Math.min(30, Math.max(0, now - item.enqueuedAt) / 1000);
        const score = getSearchPriorityWeight(item.priority) + ageBoost;
        if (score > bestScore || (score === bestScore && item.sequence < _searchQueue[bestIndex].sequence)) {
            bestScore = score;
            bestIndex = index;
        }
    });
    return bestIndex;
}

function cancelSearchRequest({ requestKey = null, requestId = null } = {}) {
    const entry = requestKey ? _searchInFlight.get(requestKey) : _currentSearchRequest;
    if (!entry || (requestId && entry.requestId && requestId !== entry.requestId)) return false;

    if (entry.consumerCount > 1) {
        entry.consumerCount -= 1;
        return true;
    }

    if (entry === _currentSearchRequest && typeof entry.finish === 'function') {
        entry.finish({ success: false, reason: 'REQUEST_CANCELLED', items: [] });
        return true;
    }

    const index = _searchQueue.indexOf(entry);
    if (index >= 0) _searchQueue.splice(index, 1);
    _searchInFlight.delete(entry.requestKey);
    entry.resolve({
        success: false,
        reason: 'REQUEST_CANCELLED',
        items: [],
        requestId: entry.requestId,
        metrics: {
            requestId: entry.requestId,
            requestKey: entry.requestKey,
            provider: entry.provider,
            queueWaitMs: Date.now() - entry.enqueuedAt,
            serviceMs: 0,
            totalMs: Date.now() - entry.enqueuedAt,
            cacheHit: false,
            inFlightHit: entry.inFlightHits > 0,
            timeoutReason: 'REQUEST_CANCELLED'
        }
    });
    return true;
}

async function processSearchQueue() {
    if (_currentSearchRequest || _searchQueue.length === 0) {
        return;
    }

    const item = _searchQueue.splice(pickNextSearchIndex(), 1)[0];
    _currentSearchRequest = item;
    const { provider, query, timeoutMs, resolve, requireRating, mediaType } = item;
    const requestId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const queueWaitMs = Date.now() - item.enqueuedAt;
    const serviceStartedAt = Date.now();
    let timeoutId = null;
    let isDone = false;

    const ratingFlag = requireRating ? '&agy_rating_1' : '';
    const searchUrl = provider === 'kinopoisk-detail'
            ? `https://www.kinopoisk.ru/${mediaType === 'tv-series' || mediaType === 'series' ? 'series' : 'film'}/${encodeURIComponent(query)}/#agy_req_${requestId}`
        : `https://www.kinopoisk.ru/new-search/?text=${encodeURIComponent(query)}#agy_req_${requestId}${ratingFlag}`;

    const finish = (result) => {
        if (isDone) return;
        isDone = true;
        if (timeoutId) clearTimeout(timeoutId);
        const metrics = {
            requestId,
            requestKey: item.requestKey,
            provider,
            queueWaitMs,
            serviceMs: Date.now() - serviceStartedAt,
            totalMs: Date.now() - item.enqueuedAt,
            cacheHit: false,
            inFlightHit: item.inFlightHits > 0,
            timeoutReason: result?.reason && /TIMEOUT|CANCELLED/i.test(result.reason)
                ? result.reason
                : null
        };
        const finalResult = { ...result, requestId, metrics };
        _currentSearchRequest = null;
        _searchInFlight.delete(item.requestKey);
        if (finalResult.success || finalResult.reason === 'SCRAPE_RESULT_SUCCESS') {
            _recentSearchResults.set(item.requestKey, {
                expiresAt: Date.now() + SEARCH_RESULT_CACHE_TTL_MS,
                result: finalResult
            });
        }

        // The iframe is the single physical resource. Wait for cleanup to be
        // acknowledged before allowing the next request to load a URL.
        Promise.resolve(chrome.runtime.sendMessage({
            target: 'offscreen-scraper',
            type: 'CLEANUP_SEARCH_FRAME'
        })).catch(() => {}).finally(() => {
            resolve(finalResult);
            setTimeout(processSearchQueue, 50);
        });
    };

    item.requestId = requestId;
    item.finish = finish;
    _currentSearchRequest = item;

    try {
        await ensureOffscreen();
    } catch (err) {
        console.warn('[Background] Offscreen creation error:', err);
        finish({ success: false, reason: 'OFFSCREEN_INIT_FAILED', items: [] });
        return;
    }

    if (isDone || _currentSearchRequest !== item) return;

    timeoutId = setTimeout(() => {
        finish({ success: false, reason: 'BACKGROUND_TIMEOUT', items: [] });
    }, timeoutMs);

    chrome.runtime.sendMessage({
        target: 'offscreen-scraper',
        type: 'LOAD_SEARCH_FRAME',
        searchUrl,
        requestId
    }).catch(err => {
        finish({ success: false, reason: 'OFFSCREEN_MESSAGE_FAILED', error: err.message, items: [] });
    });
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
        } catch {
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

async function fetchKinopoiskViaProxy(url, options = {}) {
    if (typeof KINOPOISK_CONFIG === 'undefined' || !KINOPOISK_CONFIG.PROXY_URL) {
        throw new Error('KINOPOISK_PROXY_UNAVAILABLE');
    }

    const targetUrl = new URL(url);
    const apiOrigin = new URL(KINOPOISK_CONFIG.BASE_URL).origin;
    if (targetUrl.origin !== apiOrigin || !targetUrl.pathname.startsWith('/v1.4/')) {
        throw new Error('KINOPOISK_PROXY_INVALID_TARGET');
    }

    const token = await getIdToken();
    const proxyUrl = new URL(KINOPOISK_CONFIG.PROXY_URL);
    proxyUrl.searchParams.set('path', `${targetUrl.pathname}${targetUrl.search}`);

    return fetch(proxyUrl.toString(), {
        ...options,
        headers: {
            'Accept': 'application/json',
            ...options.headers,
            'Authorization': `Bearer ${token}`
        }
    });
}

async function searchKinopoiskMovie(kpId, title, year) {
    if (kpId) {
        const response = await fetchKinopoiskViaProxy(`${KINOPOISK_CONFIG.BASE_URL}/movie/${kpId}`);
        if (!response.ok) {
            throw new Error(`Kinopoisk API error: ${response.status}`);
        }
        return await response.json();
    } else if (title) {
        // Search with more results to find the best match
        const response = await fetchKinopoiskViaProxy(`${KINOPOISK_CONFIG.BASE_URL}/movie/search?page=1&limit=10&query=${encodeURIComponent(title)}`);
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
