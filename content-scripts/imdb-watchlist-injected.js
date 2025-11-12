(function() {
    console.log('[MovieList Extension] Injected script executing in page context for imdb.com');
    
    let isSettingUpButton = false;
    
    async function init() {
        console.log('[MovieList Extension] Initializing watchlist feature for imdb.com...');
        setupWatchlistButton();
        setupMutationObserver();
    }
    
    function extractMovieTitle() {
        console.log('[MovieList Extension] Extracting movie title from page...');
        
        // Try to get title from h1 with data-testid="hero__pageTitle"
        const titleElement = document.querySelector('h1[data-testid="hero__pageTitle"]');
        if (titleElement) {
            // Get the primary text span
            const primaryText = titleElement.querySelector('.hero__primary-text');
            if (primaryText) {
                let title = primaryText.textContent.trim();
                if (title && title.length > 0) {
                    console.log(`[MovieList Extension] Found title from hero__primary-text: "${title}"`);
                    return title;
                }
            }
            // Fallback to full h1 text
            let title = titleElement.textContent.trim();
            // Remove year and other metadata
            title = title.replace(/\([^)]*\)/g, '').trim();
            if (title && title.length > 0) {
                console.log(`[MovieList Extension] Found title from h1: "${title}"`);
                return title;
            }
        }
        
        // Fallback to page title
        const pageTitle = document.title;
        if (pageTitle) {
            let title = pageTitle.trim();
            if (title.includes(' - IMDb')) {
                title = title.split(' - IMDb')[0].trim();
            }
            if (title && title.length > 0) {
                console.log(`[MovieList Extension] Using page title: "${title}"`);
                return title;
            }
        }
        
        console.warn('[MovieList Extension] Could not extract movie title');
        return null;
    }
    
    function extractImdbId() {
        console.log('[MovieList Extension] Extracting IMDb ID from page...');
        
        // Extract from URL (e.g., /title/tt1312221/)
        const urlMatch = window.location.pathname.match(/\/title\/(tt\d+)/);
        if (urlMatch && urlMatch[1]) {
            const imdbId = urlMatch[1];
            console.log(`[MovieList Extension] Found IMDb ID from URL: ${imdbId}`);
            return imdbId;
        }
        
        // Try to find in meta tags
        const metaOgUrl = document.querySelector('meta[property="og:url"]');
        if (metaOgUrl) {
            const ogUrl = metaOgUrl.getAttribute('content');
            if (ogUrl) {
                const match = ogUrl.match(/\/title\/(tt\d+)/);
                if (match && match[1]) {
                    const imdbId = match[1];
                    console.log(`[MovieList Extension] Found IMDb ID from og:url: ${imdbId}`);
                    return imdbId;
                }
            }
        }
        
        // Look in scripts for IMDb ID
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            if (script.textContent) {
                const match = script.textContent.match(/["']imdbId["']\s*:\s*["'](tt\d+)["']/i) ||
                              script.textContent.match(/\/title\/(tt\d+)/i);
                if (match && match[1]) {
                    const imdbId = match[1];
                    console.log(`[MovieList Extension] Found IMDb ID in script: ${imdbId}`);
                    return imdbId;
                }
            }
        }
        
        console.log('[MovieList Extension] IMDb ID not found on page');
        return null;
    }
    
    function extractReleaseYear() {
        console.log('[MovieList Extension] Extracting release year from page...');
        
        // Try to get year from h1 title area (e.g., "2025" after the title)
        const titleElement = document.querySelector('h1[data-testid="hero__pageTitle"]');
        if (titleElement) {
            // Look for year in the list items after title
            const yearLink = titleElement.parentElement?.querySelector('a[href*="releaseinfo"]');
            if (yearLink) {
                const yearText = yearLink.textContent.trim();
                const yearMatch = yearText.match(/\b(19|20)\d{2}\b/);
                if (yearMatch) {
                    const year = parseInt(yearMatch[0]);
                    console.log(`[MovieList Extension] Found release year: ${year}`);
                    return year;
                }
            }
        }
        
        // Try to find in metadata lists
        const metadataItems = document.querySelectorAll('.ipc-metadata-list-item__list-content-item, .ipc-inline-list__item');
        for (const item of metadataItems) {
            const text = item.textContent.trim();
            const yearMatch = text.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
                const year = parseInt(yearMatch[0]);
                // Make sure it's a reasonable year (1900-2100)
                if (year >= 1900 && year <= 2100) {
                    console.log(`[MovieList Extension] Found release year in metadata: ${year}`);
                    return year;
                }
            }
        }
        
        // Try to extract from page title
        const pageTitle = document.title;
        const titleYearMatch = pageTitle.match(/\b(19|20)\d{2}\b/);
        if (titleYearMatch) {
            const year = parseInt(titleYearMatch[0]);
            if (year >= 1900 && year <= 2100) {
                console.log(`[MovieList Extension] Found release year in page title: ${year}`);
                return year;
            }
        }
        
        console.log('[MovieList Extension] Release year not found on page');
        return null;
    }
    
    function getUser() {
        return new Promise((resolve) => {
            const configElement = document.getElementById('movieListExtensionConfig');
            if (configElement) {
                const userAttr = configElement.getAttribute('data-user');
                if (userAttr) {
                    try {
                        const user = JSON.parse(userAttr);
                        console.log('[MovieList Extension] User from config:', user.uid);
                        resolve(user);
                        return;
                    } catch (error) {
                        console.error('[MovieList Extension] Error parsing user:', error);
                    }
                }
            }

            window.postMessage({ type: 'MOVIELIST_GET_USER' }, '*');
            
            const handler = (event) => {
                if (event.data && event.data.type === 'MOVIELIST_USER_RESPONSE') {
                    window.removeEventListener('message', handler);
                    resolve(event.data.user);
                }
            };
            window.addEventListener('message', handler);
            
            setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve(null);
            }, 1000);
        });
    }

    function searchMovie(kpId, title, year) {
        return new Promise((resolve) => {
            window.postMessage({
                type: 'MOVIELIST_SEARCH_MOVIE',
                kpId: kpId,
                title: title,
                year: year
            }, '*');

            const handler = (event) => {
                if (event.data && event.data.type === 'MOVIELIST_SEARCH_RESPONSE') {
                    window.removeEventListener('message', handler);
                    if (event.data.success) {
                        resolve(event.data.movie);
                    } else {
                        console.error('[MovieList Extension] Search failed:', event.data.error);
                        resolve(null);
                    }
                }
            };
            window.addEventListener('message', handler);

            setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve(null);
            }, 30000);
        });
    }

    function checkWatchlistStatus(movieId) {
        return new Promise((resolve) => {
            window.postMessage({
                type: 'MOVIELIST_CHECK_WATCHLIST',
                movieId: movieId
            }, '*');

            const handler = (event) => {
                if (event.data && event.data.type === 'MOVIELIST_CHECK_RESPONSE') {
                    window.removeEventListener('message', handler);
                    if (event.data.success) {
                        resolve(event.data.isInWatchlist);
                    } else {
                        resolve(false);
                    }
                }
            };
            window.addEventListener('message', handler);

            setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve(false);
            }, 5000);
        });
    }

    function addToWatchlist(movieData) {
        return new Promise((resolve, reject) => {
            window.postMessage({
                type: 'MOVIELIST_ADD_TO_WATCHLIST',
                movieData: movieData
            }, '*');

            const handler = (event) => {
                if (event.data && event.data.type === 'MOVIELIST_WATCHLIST_RESPONSE') {
                    window.removeEventListener('message', handler);
                    if (event.data.success) {
                        resolve();
                    } else {
                        reject(new Error(event.data.error || 'Failed to add to watchlist'));
                    }
                }
            };
            window.addEventListener('message', handler);

            setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error('Timeout'));
            }, 30000);
        });
    }

    function removeFromWatchlist(movieId) {
        return new Promise((resolve, reject) => {
            window.postMessage({
                type: 'MOVIELIST_REMOVE_FROM_WATCHLIST',
                movieId: movieId
            }, '*');

            const handler = (event) => {
                if (event.data && event.data.type === 'MOVIELIST_REMOVE_RESPONSE') {
                    window.removeEventListener('message', handler);
                    if (event.data.success) {
                        resolve();
                    } else {
                        reject(new Error(event.data.error || 'Failed to remove from watchlist'));
                    }
                }
            };
            window.addEventListener('message', handler);

            setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error('Timeout'));
            }, 30000);
        });
    }

    async function handleWatchlistClick() {
        console.log('[MovieList Extension] Watchlist button clicked');
        
        const btn = document.getElementById('movieListWatchlistBtn');
        if (!btn) return;
        
        const isInWatchlist = btn.dataset.inWatchlist === 'true';
        const movieId = btn.dataset.movieId ? parseInt(btn.dataset.movieId) : null;
        
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳';
            btn.style.opacity = '0.7';
        }
        
        try {
            const user = await getUser();
            if (!user) {
                console.log('[MovieList Extension] User not authenticated');
                alert('Please log in to manage your Watchlist');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = isInWatchlist ? '✓' : '🔖';
                    btn.style.opacity = '1';
                }
                return;
            }
            
            console.log('[MovieList Extension] User authenticated:', user.uid);
            
            // If already in watchlist, remove it
            if (isInWatchlist && movieId) {
                console.log('[MovieList Extension] Removing from watchlist, movie ID:', movieId);
                await removeFromWatchlist(movieId);
                console.log('[MovieList Extension] Successfully removed from watchlist');
                
                // Update button state
                btn.dataset.inWatchlist = 'false';
                btn.innerHTML = '🔖';
                btn.classList.remove('added');
                btn.title = 'Add to Watchlist';
                btn.disabled = false;
                btn.style.opacity = '1';
                return;
            }
            
            // Otherwise, add to watchlist
            const title = extractMovieTitle();
            const imdbId = extractImdbId();
            const year = extractReleaseYear();
            
            // For IMDb, we search by title since we don't have Kinopoisk ID
            // The Kinopoisk API can search by title, and we'll filter by year if available
            console.log('[MovieList Extension] Searching movie - Title:', title, 'Year:', year, 'IMDb ID:', imdbId);
            const movie = await searchMovie(null, title, year);
            
            console.log('[MovieList Extension] Movie search result:', movie);
            
            // Check if movie was found
            if (movie && (movie.id || movie.kinopoiskId)) {
                console.log('[MovieList Extension] Movie found:', movie);
                
                // Extract movie ID (can be either 'id' or 'kinopoiskId')
                const foundMovieId = movie.id || movie.kinopoiskId;
                
                // Extract poster URL (can be in poster.url or posterUrl)
                const posterUrl = movie.poster?.url || movie.posterUrl || '';
                
                // Extract rating (can be in rating.kp or kpRating)
                const rating = movie.rating?.kp || movie.kpRating || 0;
                
                // Extract genres (array of objects with 'name' field or array of strings)
                const genres = (movie.genres || []).map(genre => 
                    typeof genre === 'string' ? genre : (genre.name || genre)
                );
                
                const movieData = {
                    movieId: foundMovieId,
                    movieTitle: movie.name || title || '',
                    movieTitleRu: movie.alternativeName || movie.name || title || '',
                    posterPath: posterUrl,
                    releaseYear: movie.year || null,
                    genres: genres,
                    avgRating: rating
                };
                
                console.log('[MovieList Extension] Prepared movie data:', movieData);
                console.log('[MovieList Extension] Adding to watchlist...');
                await addToWatchlist(movieData);
                console.log('[MovieList Extension] Successfully added to watchlist');
                
                // Update button state
                btn.dataset.movieId = foundMovieId;
                btn.dataset.inWatchlist = 'true';
                btn.innerHTML = '✓';
                btn.classList.add('added');
                btn.title = 'Remove from Watchlist';
                btn.disabled = false;
                btn.style.opacity = '1';
            } else {
                console.error('[MovieList Extension] Could not find movie. Movie object:', movie);
                alert('Could not find the movie. Please try again later.');
                if (btn) {
                    btn.innerHTML = isInWatchlist ? '✓' : '🔖';
                    btn.disabled = false;
                    btn.style.opacity = '1';
                }
            }
        } catch (error) {
            console.error('[MovieList Extension] Error in handleWatchlistClick:', error);
            alert('An error occurred: ' + error.message);
            if (btn) {
                btn.innerHTML = isInWatchlist ? '✓' : '🔖';
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }
    }
    
    async function setupWatchlistButton() {
        if (isSettingUpButton) {
            console.log('[MovieList Extension] Button setup already in progress, skipping...');
            return;
        }
        
        if (document.getElementById('movieListWatchlistBtn')) {
            console.log('[MovieList Extension] Button already exists, skipping...');
            return;
        }
        
        isSettingUpButton = true;
        console.log('[MovieList Extension] Setting up watchlist button for imdb.com...');
        
        try {
            // Find poster container - on IMDb it's .ipc-poster with data-testid="hero-media__poster"
            const posterContainer = document.querySelector('.ipc-poster[data-testid="hero-media__poster"], .ipc-poster');
            if (!posterContainer) {
                console.log('[MovieList Extension] Poster container not found');
                return;
            }
            
            const poster = posterContainer.querySelector('img.ipc-image, img');
            if (!poster) {
                console.log('[MovieList Extension] Poster image not found');
                return;
            }
        
            // Remove existing button if it exists in wrong place
            const existingBtn = document.getElementById('movieListWatchlistBtn');
            if (existingBtn) {
                console.log('[MovieList Extension] Removing existing button');
                existingBtn.remove();
            }
            
            // Ensure container has relative positioning
            if (!posterContainer.style.position || posterContainer.style.position === 'static') {
                posterContainer.style.position = 'relative';
            }
            
            // Get user to check watchlist status
            const user = await getUser();
            let isInWatchlist = false;
            let movieId = null;
            
            if (user) {
                // Try to get movie info first to check watchlist status
                const title = extractMovieTitle();
                const year = extractReleaseYear();
                
                if (title) {
                    console.log('[MovieList Extension] Checking watchlist status for:', title);
                    const movie = await searchMovie(null, title, year);
                    if (movie && (movie.id || movie.kinopoiskId)) {
                        movieId = movie.id || movie.kinopoiskId;
                        isInWatchlist = await checkWatchlistStatus(movieId);
                        console.log('[MovieList Extension] Watchlist status:', isInWatchlist, 'for movie ID:', movieId);
                    }
                }
            }
            
            // Create the watchlist button
            const btn = document.createElement('button');
            btn.id = 'movieListWatchlistBtn';
            btn.className = 'movieListWatchlistBtn';
            btn.innerHTML = isInWatchlist ? '✓' : '🔖';
            btn.title = isInWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist';
            btn.setAttribute('aria-label', isInWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist');
            if (movieId) {
                btn.dataset.movieId = movieId;
            }
            btn.dataset.inWatchlist = isInWatchlist ? 'true' : 'false';
            
            if (isInWatchlist) {
                btn.classList.add('added');
            }
            
            btn.style.cssText = `
                position: absolute !important;
                top: 10px !important;
                right: 10px !important;
                z-index: 99999 !important;
                background: rgba(255, 255, 255, 0.95) !important;
                border: none !important;
                border-radius: 50% !important;
                width: 40px !important;
                height: 40px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                cursor: pointer !important;
                font-size: 20px !important;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
                color: #666 !important;
                padding: 0 !important;
                margin: 0 !important;
                line-height: 1 !important;
                opacity: 1 !important;
                visibility: visible !important;
            `;
            
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleWatchlistClick();
            };
            
            // Add button directly to the poster container (will overlay the poster)
            posterContainer.appendChild(btn);
            console.log('[MovieList Extension] Watchlist button injected successfully on poster');
            console.log('[MovieList Extension] Button position:', btn.getBoundingClientRect());
        } catch (error) {
            console.error('[MovieList Extension] Error in setupWatchlistButton:', error);
        } finally {
            isSettingUpButton = false;
        }
    }
    
    function setupMutationObserver() {
        console.log('[MovieList Extension] Setting up mutation observer for imdb.com...');
        
        let debounceTimer = null;
        
        const observer = new MutationObserver((mutations) => {
            // Ignore mutations caused by our own button
            const hasOurChanges = mutations.some(mutation => {
                return Array.from(mutation.addedNodes).some(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        return node.id === 'movieListWatchlistBtn' || 
                               node.querySelector?.('#movieListWatchlistBtn');
                    }
                    return false;
                });
            });
            
            if (hasOurChanges) {
                return;
            }
            
            // Debounce to prevent too many calls
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            
            debounceTimer = setTimeout(() => {
                const posterContainer = document.querySelector('.ipc-poster[data-testid="hero-media__poster"], .ipc-poster');
                if (posterContainer && !document.getElementById('movieListWatchlistBtn') && !isSettingUpButton) {
                    console.log('[MovieList Extension] Poster container found, injecting button...');
                    setupWatchlistButton();
                }
            }, 500);
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

