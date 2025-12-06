try {
    importScripts('../shared/utils/IconUtils.js');
} catch (e) {
    console.error('Failed to import IconUtils:', e);
}

chrome.runtime.onInstalled.addListener(() => {
    console.log('Movie Rating Extension installed');
    updateIconFromStorage();
});

chrome.runtime.onStartup.addListener(() => {
    updateIconFromStorage();
});

// Listen for theme changes from other parts of the extension
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.theme) {
        if (typeof IconUtils !== 'undefined') {
            IconUtils.updateExtensionIcon(changes.theme.newValue);
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

            // Token expired, validation expired, or doesn't exist - need to get a new one
            // Reject and let the user know they need to open popup to refresh authentication
            reject(new Error('Token expired or validation expired. Please open the extension popup to refresh authentication.'));
        });
    });
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
    }
});

async function searchKinopoiskMovie(kpId, title, year) {
    // Kinopoisk API key from config
    const apiKey = 'Q6Q938P-CG3M56S-GKJRF4P-J3TSZ6S';

    if (kpId) {
        const response = await fetch(`https://api.kinopoisk.dev/v1.4/movie/${kpId}`, {
            headers: {
                'X-API-KEY': apiKey
            }
        });
        if (!response.ok) {
            throw new Error(`Kinopoisk API error: ${response.status}`);
        }
        return await response.json();
    } else if (title) {
        // Search with more results to find the best match
        const response = await fetch(`https://api.kinopoisk.dev/v1.4/movie/search?page=1&limit=10&query=${encodeURIComponent(title)}`, {
            headers: {
                'X-API-KEY': apiKey
            }
        });
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
