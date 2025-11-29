chrome.runtime.onInstalled.addListener(() => {
    console.log('Movie Rating Extension installed');
});

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
    } else if (message.type === 'GET_ID_TOKEN') {
        // This will be handled by popup or content script that has access to Firebase
        sendResponse({ error: 'Not implemented in service worker' });
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
        console.log('[Update] Checking for updates...');
        const manifest = chrome.runtime.getManifest();
        const currentVersion = manifest.version;

        const response = await fetch(`https://api.github.com/repos/${UPDATE_CONFIG.githubOwner}/${UPDATE_CONFIG.githubRepo}/releases/latest`);
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const data = await response.json();
        const latestVersion = data.tag_name.replace('v', ''); // Remove 'v' prefix if present

        console.log(`[Update] Current: ${currentVersion}, Latest: ${latestVersion}`);

        if (compareVersions(latestVersion, currentVersion) > 0) {
            console.log('[Update] Update available!');
            
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
            console.log('[Update] No updates available');
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
    chrome.notifications.create('update-available', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Доступно обновление расширения',
        message: `Версия ${version} готова к установке`,
        buttons: [
            { title: 'Обновить сейчас' },
            { title: 'Позже' }
        ],
        requireInteraction: true
    });

    // Store download URL for button click handler
    chrome.storage.local.set({ pendingUpdateUrl: downloadUrl, pendingUpdateVersion: version });
}

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (notificationId === 'update-available') {
        if (buttonIndex === 0) { // "Update Now"
            chrome.storage.local.get(['pendingUpdateUrl'], (result) => {
                if (result.pendingUpdateUrl) {
                    downloadUpdate(result.pendingUpdateUrl);
                }
            });
        }
        chrome.notifications.clear(notificationId);
    }
});

function downloadUpdate(url) {
    chrome.downloads.download({
        url: url,
        filename: 'extension_update.zip',
        conflictAction: 'overwrite',
        saveAs: false
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error('[Update] Download failed:', chrome.runtime.lastError);
            return;
        }
        console.log('[Update] Download started, ID:', downloadId);
        
        // Listen for download completion
        const onDownloadComplete = (delta) => {
            if (delta.id === downloadId && delta.state && delta.state.current === 'complete') {
                chrome.downloads.onChanged.removeListener(onDownloadComplete);
                
                chrome.downloads.search({ id: downloadId }, (results) => {
                    if (results && results[0]) {
                        const filePath = results[0].filename;
                        console.log('[Update] Download complete:', filePath);
                        
                        // Save path and open instructions
                        chrome.storage.local.set({ updateZipPath: filePath }, () => {
                            chrome.tabs.create({ url: 'src/pages/update/update_instructions.html' });
                        });
                    }
                });
            }
        };
        chrome.downloads.onChanged.addListener(onDownloadComplete);
    });
}
