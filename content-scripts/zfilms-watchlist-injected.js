(function() {
    console.log('[MovieList Extension] Injected script executing in page context for zfilms-hd.by');
    
    let isSettingUpButton = false;
    
    function injectStyles() {
        if (!document.getElementById('movie-list-extension-styles')) {
            const style = document.createElement('style');
            style.id = 'movie-list-extension-styles';
            style.textContent = `
                .spin { animation: spin 1s linear infinite; transform-origin: center; }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    async function init() {
        console.log('[MovieList Extension] Initializing watchlist feature for zfilms-hd.by...');
        injectStyles();
        setupWatchlistButton();
        setupMutationObserver();
    }
    
    function extractMovieTitle() {
        console.log('[MovieList Extension] Extracting movie title from page...');
        
        // Try to get original title first (usually English title on zfilms-hd.by)
        const originalTitle = document.querySelector('.page__original-title');
        if (originalTitle) {
            let title = originalTitle.textContent.trim();
            if (title && title.length > 0) {
                console.log(`[MovieList Extension] Found original title: "${title}"`);
                return title;
            }
        }
        
        // Try to get title from h1
        const titleElement = document.querySelector('.sect__title, .page__header h1, h1');
        if (titleElement) {
            let title = titleElement.textContent.trim();
            // Remove common suffixes
            title = title.replace(/смотреть онлайн/gi, '').trim();
            title = title.replace(/онлайн/gi, '').trim();
            title = title.replace(/фильм/gi, '').trim();
            if (title && title.length > 0) {
                console.log(`[MovieList Extension] Found title from h1: "${title}"`);
                return title;
            }
        }
        
        // Fallback to page title
        const pageTitle = document.title;
        if (pageTitle) {
            let title = pageTitle.trim();
            title = title.replace(/смотреть онлайн/gi, '').trim();
            title = title.replace(/онлайн/gi, '').trim();
            title = title.replace(/фильм/gi, '').trim();
            if (title.includes(' - ')) {
                title = title.split(' - ')[0].trim();
            }
            if (title.includes(' | ')) {
                title = title.split(' | ')[0].trim();
            }
            if (title && title.length > 0) {
                console.log(`[MovieList Extension] Using page title: "${title}"`);
                return title;
            }
        }
        
        console.warn('[MovieList Extension] Could not extract movie title');
        return null;
    }
    
    function extractKinopoiskId() {
        console.log('[MovieList Extension] Extracting Kinopoisk ID from page...');
        
        // Look for Kinopoisk link in page info (zfilms-hd.by uses /go.php?url= format)
        const kinopoiskLinks = document.querySelectorAll('a[href*="kinopoisk"], a[href*="kp"]');
        for (const link of kinopoiskLinks) {
            const href = link.getAttribute('href');
            if (!href) continue;
            
            // Try to extract from URL parameter (e.g., /go.php?url=https://www.kinopoisk.ru/film/5515508)
            try {
                const urlMatch = href.match(/[?&]url=([^&]+)/);
                if (urlMatch && urlMatch[1]) {
                    const decodedUrl = decodeURIComponent(urlMatch[1]);
                    const match = decodedUrl.match(/kinopoisk\.ru\/film\/(\d+)/i);
                    if (match && match[1]) {
                        const kpId = parseInt(match[1]);
                        console.log(`[MovieList Extension] Found Kinopoisk ID in URL parameter: ${kpId}`);
                        return kpId;
                    }
                }
            } catch (e) {
                // Ignore decode errors
            }
            
            // Try direct match in href
            const match = href.match(/kinopoisk\.ru\/film\/(\d+)/i) || href.match(/film[\/=](\d+)/i);
            if (match && match[1]) {
                const kpId = parseInt(match[1]);
                console.log(`[MovieList Extension] Found Kinopoisk ID in link: ${kpId}`);
                return kpId;
            }
        }
        
        // Look in player iframe src (often contains Kinopoisk ID)
        const playerIframe = document.querySelector('.player-wrapper iframe, iframe[src*="m7-club"], iframe[src*="cdn.m7-club"]');
        if (playerIframe && playerIframe.src) {
            // URL format: //cdn.m7-club.com/v/5515508?trr=...
            const match = playerIframe.src.match(/[\/=](\d{7,8})(?:\?|$)/);
            if (match && match[1]) {
                const kpId = parseInt(match[1]);
                console.log(`[MovieList Extension] Found Kinopoisk ID in player iframe: ${kpId}`);
                return kpId;
            }
        }
        
        // Look in iframes
        const iframes = document.querySelectorAll('iframe[src*="kp"], iframe[src*="kinopoisk"]');
        for (const iframe of iframes) {
            if (iframe.src) {
                const match = iframe.src.match(/kp[=:]?(\d+)/i) || iframe.src.match(/kinopoiskID["\s:=]+(\d+)/i) || iframe.src.match(/film[\/=](\d+)/i);
                if (match && match[1]) {
                    const kpId = parseInt(match[1]);
                    console.log(`[MovieList Extension] Found Kinopoisk ID in iframe: ${kpId}`);
                    return kpId;
                }
            }
        }
        
        // Look in scripts
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            if (script.textContent) {
                const match = script.textContent.match(/kinopoisk\.ru\/film\/(\d+)/i) ||
                              script.textContent.match(/kinopoiskID["\s:=]+(\d+)/i) ||
                              script.textContent.match(/kp["\s:=]+(\d+)/i) ||
                              script.textContent.match(/film[\/=](\d+)/i);
                if (match && match[1]) {
                    const kpId = parseInt(match[1]);
                    console.log(`[MovieList Extension] Found Kinopoisk ID in script: ${kpId}`);
                    return kpId;
                }
            }
        }
        
        console.log('[MovieList Extension] Kinopoisk ID not found on page');
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

    function searchMovie(kpId, title) {
        return new Promise((resolve) => {
            window.postMessage({
                type: 'MOVIELIST_SEARCH_MOVIE',
                kpId: kpId,
                title: title
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
            btn.innerHTML = Icons.LOADING;
            btn.style.opacity = '0.7';
        }
        
        try {
            const user = await getUser();
            if (!user) {
                console.log('[MovieList Extension] User not authenticated');
                alert('Пожалуйста, войдите в систему, чтобы управлять Watchlist');
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = isInWatchlist ? Icons.CHECK : Icons.MORE_VERTICAL;
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
                btn.innerHTML = Icons.MORE_VERTICAL;
                btn.classList.remove('added');
                btn.title = 'Добавить в Watchlist';
                btn.disabled = false;
                btn.style.opacity = '1';
                return;
            }
            
            // Otherwise, add to watchlist
            const kpId = extractKinopoiskId();
            const title = extractMovieTitle();
            
            console.log('[MovieList Extension] Searching movie - KP ID:', kpId, 'Title:', title);
            const movie = await searchMovie(kpId, title);
            
            console.log('[MovieList Extension] Movie search result:', movie);
            
            // Check if movie was found - Kinopoisk API returns 'id' field, not 'kinopoiskId'
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
                    movieTitle: movie.name || '',
                    movieTitleRu: movie.alternativeName || movie.name || '',
                    posterPath: posterUrl,
                    releaseYear: movie.year || null,
                    genres: genres,
                    avgRating: rating,
                    description: movie.description || '',
                    kpRating: movie.rating?.kp || movie.kpRating || 0,
                    imdbRating: movie.rating?.imdb || movie.imdbRating || 0,
                };
                
                console.log('[MovieList Extension] Prepared movie data:', movieData);
                console.log('[MovieList Extension] Adding to watchlist...');
                await addToWatchlist(movieData);
                console.log('[MovieList Extension] Successfully added to watchlist');
                
                // Update button state
                btn.dataset.movieId = foundMovieId;
                btn.dataset.inWatchlist = 'true';
                btn.innerHTML = Icons.CHECK;
                btn.classList.add('added');
                btn.title = 'Удалить из Watchlist';
                btn.disabled = false;
                btn.style.opacity = '1';
            } else {
                console.error('[MovieList Extension] Could not find movie. Movie object:', movie);
                alert('Не удалось найти фильм. Пожалуйста, попробуйте позже.');
                if (btn) {
                    btn.innerHTML = isInWatchlist ? Icons.CHECK : Icons.MORE_VERTICAL;
                    btn.disabled = false;
                    btn.style.opacity = '1';
                }
            }
        } catch (error) {
            console.error('[MovieList Extension] Error in handleWatchlistClick:', error);
            alert('Произошла ошибка: ' + error.message);
            if (btn) {
                btn.innerHTML = isInWatchlist ? Icons.CHECK : Icons.MORE_VERTICAL;
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
        console.log('[MovieList Extension] Setting up watchlist button for zfilms-hd.by...');
        
        try {
            // Find poster container - on zfilms-hd.by it's .page__poster
            const posterContainer = document.querySelector('.page__poster');
            if (!posterContainer) {
                console.log('[MovieList Extension] Poster container not found');
                return;
            }
            
            const poster = posterContainer.querySelector('img');
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
                const kpId = extractKinopoiskId();
                const title = extractMovieTitle();
                
                if (kpId || title) {
                    console.log('[MovieList Extension] Checking watchlist status for:', kpId || title);
                    const movie = await searchMovie(kpId, title);
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
            btn.innerHTML = isInWatchlist ? Icons.CHECK : Icons.MORE_VERTICAL;
            btn.title = isInWatchlist ? 'Удалить из Watchlist' : 'Добавить в Watchlist';
            btn.setAttribute('aria-label', isInWatchlist ? 'Удалить из Watchlist' : 'Добавить в Watchlist');
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
        console.log('[MovieList Extension] Setting up mutation observer for zfilms-hd.by...');
        
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
                const posterContainer = document.querySelector('.page__poster');
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

