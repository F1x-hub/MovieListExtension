(function() {
    console.log('[MovieList Extension] Injected script executing in page context for kinogo.inc');
    
    let isSettingUpButton = false;
    
    async function init() {
        console.log('[MovieList Extension] Initializing watchlist feature for kinogo.inc...');
        setupWatchlistButton();
        setupMutationObserver();
    }
    
    function extractMovieTitle() {
        console.log('[MovieList Extension] Extracting movie title from page...');
        
        // Try to get title from h1 span[itemprop="name"]
        const titleElement = document.querySelector('h1 span[itemprop="name"]');
        if (titleElement) {
            let title = titleElement.textContent.trim();
            // Remove year in parentheses (e.g., "Полярный экспресс (2004)" -> "Полярный экспресс")
            title = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
            if (title && title.length > 0) {
                console.log(`[MovieList Extension] Found title: "${title}"`);
                return title;
            }
        }
        
        // Try to get title from h1
        const h1Element = document.querySelector('h1');
        if (h1Element) {
            let title = h1Element.textContent.trim();
            // Remove year in parentheses
            title = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
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
            // Remove year in parentheses
            title = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
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
    
    function extractReleaseYear() {
        console.log('[MovieList Extension] Extracting release year from page...');
        
        // Try to extract from title (e.g., "Полярный экспресс (2004)")
        const titleElement = document.querySelector('h1 span[itemprop="name"], h1');
        if (titleElement) {
            const titleText = titleElement.textContent.trim();
            const yearMatch = titleText.match(/\((\d{4})\)/);
            if (yearMatch && yearMatch[1]) {
                const year = parseInt(yearMatch[1]);
                if (year >= 1900 && year <= 2100) {
                    console.log(`[MovieList Extension] Found release year in title: ${year}`);
                    return year;
                }
            }
        }
        
        // Try to extract from page text (e.g., "Год: 2004")
        const fullStory = document.querySelector('.fullstory');
        if (fullStory) {
            const text = fullStory.textContent;
            const yearMatch = text.match(/Год:\s*(\d{4})/i);
            if (yearMatch && yearMatch[1]) {
                const year = parseInt(yearMatch[1]);
                if (year >= 1900 && year <= 2100) {
                    console.log(`[MovieList Extension] Found release year in text: ${year}`);
                    return year;
                }
            }
        }
        
        console.log('[MovieList Extension] Release year not found on page');
        return null;
    }
    
    function extractKinopoiskId() {
        console.log('[MovieList Extension] Extracting Kinopoisk ID from page...');
        
        // Look for Kinopoisk links
        const kinopoiskLinks = document.querySelectorAll('a[href*="kinopoisk"], a[href*="kp"]');
        for (const link of kinopoiskLinks) {
            const href = link.getAttribute('href');
            if (!href) continue;
            
            const match = href.match(/kinopoisk\.ru\/film\/(\d+)/i) || href.match(/film[\/=](\d+)/i);
            if (match && match[1]) {
                const kpId = parseInt(match[1]);
                console.log(`[MovieList Extension] Found Kinopoisk ID in link: ${kpId}`);
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
                alert('Пожалуйста, войдите в систему, чтобы управлять Watchlist');
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
                btn.title = 'Добавить в Watchlist';
                btn.disabled = false;
                btn.style.opacity = '1';
                return;
            }
            
            // Otherwise, add to watchlist
            const kpId = extractKinopoiskId();
            const title = extractMovieTitle();
            const year = extractReleaseYear();
            
            console.log('[MovieList Extension] Searching movie - KP ID:', kpId, 'Title:', title, 'Year:', year);
            const movie = await searchMovie(kpId, title, year);
            
            console.log('[MovieList Extension] Movie search result:', movie);
            
            if (movie && (movie.id || movie.kinopoiskId)) {
                console.log('[MovieList Extension] Movie found:', movie);
                
                const foundMovieId = movie.id || movie.kinopoiskId;
                const posterUrl = movie.poster?.url || movie.posterUrl || '';
                const rating = movie.rating?.kp || movie.kpRating || 0;
                const genres = (movie.genres || []).map(genre =>
                    typeof genre === 'string' ? genre : (genre.name || genre)
                );
                
                const movieData = {
                    movieId: foundMovieId,
                    movieTitle: movie.name || title || '',
                    movieTitleRu: movie.alternativeName || movie.name || title || '',
                    posterPath: posterUrl,
                    releaseYear: movie.year || year || null,
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
                btn.title = 'Удалить из Watchlist';
                btn.disabled = false;
                btn.style.opacity = '1';
            } else {
                console.error('[MovieList Extension] Could not find movie. Movie object:', movie);
                alert('Не удалось найти фильм. Пожалуйста, попробуйте позже.');
                if (btn) {
                    btn.innerHTML = isInWatchlist ? '✓' : '🔖';
                    btn.disabled = false;
                    btn.style.opacity = '1';
                }
            }
        } catch (error) {
            console.error('[MovieList Extension] Error in handleWatchlistClick:', error);
            alert('Произошла ошибка: ' + error.message);
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
        console.log('[MovieList Extension] Setting up watchlist button for kinogo.inc...');
        
        try {
            // Find poster - on kinogo.inc it's img[itemprop="image"] inside .fullimg
            const poster = document.querySelector('.fullimg img[itemprop="image"]');
            if (!poster) {
                console.log('[MovieList Extension] Poster image not found');
                return;
            }
            
            // Get the parent element of the image
            let imageWrapper = poster.parentElement;
            
            // If the parent is .fullimg or doesn't have relative positioning, create a wrapper
            const needsWrapper = imageWrapper.classList.contains('fullimg') || 
                                (!imageWrapper.style.position || imageWrapper.style.position === 'static');
            
            if (needsWrapper) {
                // Check if image is directly in .fullimg or has another parent
                if (imageWrapper.classList.contains('fullimg')) {
                    // Create a wrapper div specifically for the image and button
                    const newWrapper = document.createElement('div');
                    newWrapper.className = 'movieListPosterWrapper';
                    newWrapper.style.cssText = 'position: relative; display: inline-block; float: left;';
                    
                    // Insert wrapper before the image
                    imageWrapper.insertBefore(newWrapper, poster);
                    
                    // Move the image into the wrapper
                    newWrapper.appendChild(poster);
                    
                    imageWrapper = newWrapper;
                } else {
                    // Use existing parent, but ensure it has relative positioning
                    imageWrapper.style.position = 'relative';
                    if (window.getComputedStyle(imageWrapper).display === 'static' || 
                        !imageWrapper.style.display) {
                        imageWrapper.style.display = 'inline-block';
                    }
                }
            } else {
                // Ensure existing wrapper has relative positioning
                imageWrapper.style.position = 'relative';
            }
            
            // Get user to check watchlist status
            const user = await getUser();
            let isInWatchlist = false;
            let movieId = null;
            
            if (user) {
                // Try to get movie info first to check watchlist status
                const kpId = extractKinopoiskId();
                const title = extractMovieTitle();
                const year = extractReleaseYear();
                
                if (kpId || title) {
                    console.log('[MovieList Extension] Checking watchlist status for:', kpId || title);
                    const movie = await searchMovie(kpId, title, year);
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
            
            // Add button directly to the image wrapper (will overlay the poster)
            imageWrapper.appendChild(btn);
            console.log('[MovieList Extension] Watchlist button injected successfully on poster');
            console.log('[MovieList Extension] Button position:', btn.getBoundingClientRect());
        } catch (error) {
            console.error('[MovieList Extension] Error in setupWatchlistButton:', error);
        } finally {
            isSettingUpButton = false;
        }
    }
    
    function setupMutationObserver() {
        console.log('[MovieList Extension] Setting up mutation observer for kinogo.inc...');
        
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
                const poster = document.querySelector('.fullimg img[itemprop="image"]');
                if (poster && !document.getElementById('movieListWatchlistBtn') && !isSettingUpButton) {
                    console.log('[MovieList Extension] Poster found, injecting button...');
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

