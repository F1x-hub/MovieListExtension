(function() {
    console.log('[MovieList Extension] Injected script executing in page context');
    
    let firebaseManagerInstance = null;
    let servicesLoading = false;
    let isSettingUpButton = false;
    
    // CSS Styles
    const styles = `
        .movie-list-menu-btn {
            position: absolute !important;
            top: 10px !important;
            right: 10px !important;
            z-index: 99999 !important;
            background: rgba(15, 23, 42, 0.9) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 50% !important;
            width: 36px !important;
            height: 36px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            cursor: pointer !important;
            color: #e2e8f0 !important;
            padding: 0 !important;
            margin: 0 !important;
            transition: all 0.2s ease !important;
            backdrop-filter: blur(8px) !important;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
        }

        .movie-list-menu-btn:hover {
            background: rgba(30, 41, 59, 0.95) !important;
            transform: scale(1.05);
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05) !important;
        }

        .movie-list-menu-btn svg {
            width: 20px;
            height: 20px;
            fill: currentColor;
        }

        .movie-list-dropdown {
            position: absolute !important;
            top: 50px !important;
            right: 10px !important;
            z-index: 100000 !important;
            background: #0f172a !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 12px !important;
            width: 220px !important;
            padding: 8px !important;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04) !important;
            animation: menuFadeIn 0.2s ease-out !important;
            display: none;
        }

        .movie-list-dropdown.active {
            display: block !important;
        }

        @keyframes menuFadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .movie-list-menu-item {
            display: flex !important;
            align-items: center !important;
            width: 100% !important;
            padding: 10px 12px !important;
            background: transparent !important;
            border: none !important;
            border-radius: 8px !important;
            color: #e2e8f0 !important;
            font-size: 14px !important;
            cursor: pointer !important;
            transition: all 0.2s ease !important;
            text-align: left !important;
            gap: 12px !important;
        }

        .movie-list-menu-item:hover {
            background: rgba(255, 255, 255, 0.1) !important;
        }

        .movie-list-menu-item.active {
            color: #38bdf8 !important;
            background: rgba(56, 189, 248, 0.1) !important;
        }

        .movie-list-menu-icon {
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .movie-list-divider {
            height: 1px;
            background: rgba(255, 255, 255, 0.1);
            margin: 6px 0;
        }

        /* Modal Styles */
        .movie-list-modal-overlay {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            bottom: 0 !important;
            background: rgba(0, 0, 0, 0.8) !important;
            z-index: 200000 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            backdrop-filter: blur(4px) !important;
            animation: fadeIn 0.2s ease-out !important;
            padding: 20px !important;
        }

        .movie-list-modal {
            background: linear-gradient(180deg, #ef4675 0%, #ef4675 120px, #1e293b 120px) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 16px !important;
            width: 90% !important;
            max-width: 700px !important;
            max-height: 90vh !important;
            overflow-y: auto !important;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important;
            animation: slideUp 0.3s ease-out !important;
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes slideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .movie-list-modal-header {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            padding: 24px !important;
            color: white !important;
        }

        .movie-list-modal-title {
            font-size: 28px !important;
            font-weight: 700 !important;
            color: white !important;
            margin: 0 !important;
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
        }

        .movie-list-close-btn {
            background: rgba(255, 255, 255, 0.2) !important;
            border: none !important;
            color: white !important;
            cursor: pointer !important;
            padding: 8px 12px !important;
            border-radius: 8px !important;
            font-size: 20px !important;
            transition: all 0.2s !important;
            width: 36px !important;
            height: 36px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
        }

        .movie-list-close-btn:hover {
            background: rgba(255, 255, 255, 0.3) !important;
        }

        .movie-list-modal-body {
            padding: 24px !important;
        }

        .movie-list-movie-card {
            background: rgba(30, 41, 59, 0.6) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 12px !important;
            padding: 20px !important;
            display: flex !important;
            gap: 20px !important;
            margin-bottom: 24px !important;
        }

        .movie-list-movie-poster {
            width: 140px !important;
            height: 200px !important;
            border-radius: 8px !important;
            object-fit: cover !important;
            flex-shrink: 0 !important;
        }

        .movie-list-movie-info {
            flex: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 12px !important;
        }

        .movie-list-movie-title {
            font-size: 24px !important;
            font-weight: 700 !important;
            color: #f8fafc !important;
            margin: 0 !important;
        }

        .movie-list-movie-meta {
            font-size: 14px !important;
            color: #94a3b8 !important;
        }

        .movie-list-movie-ratings {
            display: flex !important;
            gap: 16px !important;
            flex-wrap: wrap !important;
        }

        .movie-list-rating-badge {
            background: rgba(255, 255, 255, 0.1) !important;
            padding: 6px 12px !important;
            border-radius: 6px !important;
            font-size: 13px !important;
            font-weight: 600 !important;
        }

        .movie-list-rating-badge.kp {
            color: #fbbf24 !important;
        }

        .movie-list-rating-badge.imdb {
            color: #f59e0b !important;
        }

        .movie-list-rating-section {
            background: rgba(30, 41, 59, 0.4) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 12px !important;
            padding: 24px !important;
            margin-bottom: 20px !important;
        }

        .movie-list-section-title {
            font-size: 18px !important;
            font-weight: 700 !important;
            color: #f8fafc !important;
            margin: 0 0 20px 0 !important;
        }

        .movie-list-current-rating {
            display: flex !important;
            align-items: center !important;
            gap: 12px !important;
            margin-bottom: 12px !important;
        }

        .movie-list-current-rating-label {
            font-size: 14px !important;
            color: #cbd5e1 !important;
        }

        .movie-list-current-rating-value {
            font-size: 24px !important;
            font-weight: 700 !important;
            color: #ef4675 !important;
        }

        .movie-list-current-comment {
            background: rgba(15, 23, 42, 0.5) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 8px !important;
            padding: 12px !important;
            color: #94a3b8 !important;
            font-style: italic !important;
            font-size: 14px !important;
        }

        .movie-list-slider-container {
            margin-bottom: 24px !important;
        }

        .movie-list-slider-value {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            background: #ef4675 !important;
            color: white !important;
            font-size: 32px !important;
            font-weight: 700 !important;
            padding: 16px 24px !important;
            border-radius: 12px !important;
            margin-bottom: 16px !important;
            min-width: 120px !important;
        }

        .movie-list-slider-value-small {
            font-size: 20px !important;
            opacity: 0.7 !important;
        }

        .movie-list-slider-wrapper {
            position: relative !important;
            margin-bottom: 8px !important;
        }

        .movie-list-slider {
            width: 100% !important;
            height: 8px !important;
            border-radius: 4px !important;
            background: linear-gradient(to right, #ef4675 0%, #ef4675 var(--value), #334155 var(--value), #334155 100%) !important;
            outline: none !important;
            -webkit-appearance: none !important;
            appearance: none !important;
        }

        .movie-list-slider::-webkit-slider-thumb {
            -webkit-appearance: none !important;
            appearance: none !important;
            width: 24px !important;
            height: 24px !important;
            border-radius: 50% !important;
            background: white !important;
            cursor: pointer !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        }

        .movie-list-slider::-moz-range-thumb {
            width: 24px !important;
            height: 24px !important;
            border-radius: 50% !important;
            background: white !important;
            cursor: pointer !important;
            border: none !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
        }

        .movie-list-slider-labels {
            display: flex !important;
            justify-content: space-between !important;
            color: #64748b !important;
            font-size: 12px !important;
            padding: 0 4px !important;
        }

        .movie-list-comment-section {
            margin-bottom: 24px !important;
        }

        .movie-list-comment-textarea {
            width: 100% !important;
            min-height: 100px !important;
            background: rgba(15, 23, 42, 0.6) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 8px !important;
            padding: 12px !important;
            color: #e2e8f0 !important;
            font-size: 14px !important;
            font-family: inherit !important;
            resize: vertical !important;
            outline: none !important;
        }

        .movie-list-comment-textarea::placeholder {
            color: #64748b !important;
        }

        .movie-list-comment-textarea:focus {
            border-color: #ef4675 !important;
            background: rgba(15, 23, 42, 0.8) !important;
        }

        .movie-list-char-count {
            text-align: right !important;
            font-size: 12px !important;
            color: #64748b !important;
            margin-top: 4px !important;
        }

        .movie-list-modal-footer {
            display: flex !important;
            justify-content: flex-end !important;
            gap: 12px !important;
            padding: 0 24px 24px !important;
        }

        .movie-list-btn {
            padding: 12px 32px !important;
            border-radius: 8px !important;
            font-weight: 600 !important;
            font-size: 16px !important;
            cursor: pointer !important;
            transition: all 0.2s !important;
            border: none !important;
        }

        .movie-list-btn-cancel {
            background: rgba(255, 255, 255, 0.1) !important;
            color: #e2e8f0 !important;
        }

        .movie-list-btn-cancel:hover {
            background: rgba(255, 255, 255, 0.15) !important;
        }

        .movie-list-btn-primary {
            background: #ef4675 !important;
            color: white !important;
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
        }

        .movie-list-btn-primary:hover {
            background: #dc2f5f !important;
        }
        
        .movie-list-btn-primary:disabled {
            opacity: 0.5 !important;
            cursor: not-allowed !important;
        }
    `;

    function injectStyles() {
        if (!document.getElementById('movie-list-extension-styles')) {
            const style = document.createElement('style');
            style.id = 'movie-list-extension-styles';
            style.textContent = styles;
            document.head.appendChild(style);
        }
    }
    
    async function loadFirebaseScripts() {
        console.log('[MovieList Extension] loadFirebaseScripts called');
        
        if (firebaseManagerInstance && firebaseManagerInstance.isInitialized) {
            console.log('[MovieList Extension] FirebaseManager already initialized, returning existing instance');
            return firebaseManagerInstance;
        }
        
        if (servicesLoading) {
            console.log('[MovieList Extension] Services already loading, waiting...');
            let attempts = 0;
            while (servicesLoading && attempts < 100) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            if (firebaseManagerInstance && firebaseManagerInstance.isInitialized) {
                return firebaseManagerInstance;
            }
        }
        
        servicesLoading = true;
        
        try {
            const configElement = document.getElementById('movieListExtensionConfig');
            if (!configElement) throw new Error('Config element not found');
            
            const urlsAttr = configElement.getAttribute('data-script-urls');
            if (!urlsAttr) throw new Error('Script URLs not found');
            
            const scriptUrls = JSON.parse(urlsAttr);
            console.log('[MovieList Extension] Loading', scriptUrls.length, 'scripts');
            
            for (const url of scriptUrls) {
                console.log('[MovieList Extension] Loading script:', url);
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = url;
                    script.onload = () => {
                        console.log('[MovieList Extension] ✓ Loaded:', url);
                        resolve();
                    };
                    script.onerror = () => reject(new Error(`Failed to load: ${url}`));
                    (document.head || document.documentElement).appendChild(script);
                });
            }
            
            console.log('[MovieList Extension] All scripts loaded, waiting for initialization...');
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            console.log('[MovieList Extension] Checking for FirebaseManager...');
            console.log('[MovieList Extension] typeof FirebaseManager:', typeof FirebaseManager);
            console.log('[MovieList Extension] typeof MovieCacheService:', typeof MovieCacheService);
            console.log('[MovieList Extension] typeof UserService:', typeof UserService);
            console.log('[MovieList Extension] typeof RatingService:', typeof RatingService);
            
            if (typeof FirebaseManager === 'undefined') throw new Error('FirebaseManager class not found');
            
            console.log('[MovieList Extension] Creating FirebaseManager instance...');
            firebaseManagerInstance = new FirebaseManager();
            
            let attempts = 0;
            while (!firebaseManagerInstance.isInitialized && attempts < 100) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            
            if (!firebaseManagerInstance.isInitialized) throw new Error('Firebase Manager initialization timeout');
            
            console.log('[MovieList Extension] FirebaseManager initialized, initializing services...');
            firebaseManagerInstance.initializeServices();
            console.log('[MovieList Extension] Services initialized successfully');
            
            servicesLoading = false;
            return firebaseManagerInstance;
        } catch (error) {
            console.error('[MovieList Extension] Error loading scripts:', error);
            servicesLoading = false;
            throw error;
        }
    }
    
    async function init() {
        injectStyles();
        setupMenuButton();
        setupMutationObserver();
    }
    
    // ... (Extraction functions remain the same: extractMovieTitle, extractKinopoiskId)
    function extractMovieTitle() {
        const titleSelectors = ['h1', '.FullstoryFormRight h1', 'title'];
        for (const selector of titleSelectors) {
            const el = document.querySelector(selector);
            if (el) {
                let title = el.textContent.trim();
                title = title.replace(/смотреть онлайн/gi, '').trim();
                if (title.includes('/')) title = title.split('/')[0].trim();
                return title;
            }
        }
        return document.title.split(' - ')[0].trim();
    }
    
    function extractKinopoiskId() {
        const iframes = document.querySelectorAll('iframe[src*="kp"], iframe[src*="kinopoisk"]');
        for (const iframe of iframes) {
            if (iframe.src) {
                const match = iframe.src.match(/kp[=:]?(\d+)/i) || iframe.src.match(/kinopoiskID["\s:=]+(\d+)/i);
                if (match) return parseInt(match[1]);
            }
        }
        
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            if (script.textContent) {
                const match = script.textContent.match(/kinopoiskID["\s:=]+(\d+)/i) || script.textContent.match(/kp["\s:=]+(\d+)/i);
                if (match) return parseInt(match[1]);
            }
        }
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

    async function getMovieData() {
        const kpId = extractKinopoiskId();
        const title = extractMovieTitle();
        
        if (!kpId && !title) return null;
        
        // Use postMessage to search via content script -> background
        return new Promise((resolve) => {
            window.postMessage({
                type: 'MOVIELIST_SEARCH_MOVIE',
                kpId: kpId,
                title: title
            }, '*');

            const handler = (event) => {
                if (event.data && event.data.type === 'MOVIELIST_SEARCH_RESPONSE') {
                    window.removeEventListener('message', handler);
                    if (event.data.success && event.data.movie) {
                        const movie = event.data.movie;
                        resolve({
                            movieId: movie.id || movie.kinopoiskId,
                            movieTitle: movie.name || '',
                            movieTitleRu: movie.alternativeName || movie.name || '',
                            posterPath: movie.poster?.url || movie.posterUrl || '',
                            releaseYear: movie.year || null,
                            genres: (movie.genres || []).map(g => typeof g === 'string' ? g : (g.name || g)),
                            avgRating: movie.rating?.kp || movie.kpRating || 0
                        });
                    } else {
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

    async function setupMenuButton() {
        if (isSettingUpButton || document.getElementById('movieListMenuBtn')) return;
        
        isSettingUpButton = true;
        
        try {
            const poster = document.querySelector('.FullstoryFormLeft img');
            if (!poster) return;
            
            // Wrapper logic
            let imageWrapper = poster.parentElement;
            const posterContainer = poster.parentElement;
            
            if (!posterContainer.style.position || posterContainer.style.position === 'static') {
                posterContainer.style.position = 'relative';
            }
            
            const needsWrapper = imageWrapper === posterContainer || imageWrapper.classList.contains('FullstoryFormLeft');
            
            if (needsWrapper) {
                imageWrapper = document.createElement('div');
                imageWrapper.className = 'movieListPosterWrapper';
                imageWrapper.style.cssText = 'position: relative; display: inline-block; width: 100%;';
                posterContainer.insertBefore(imageWrapper, poster);
                imageWrapper.appendChild(poster);
            } else {
                imageWrapper.style.position = 'relative';
                imageWrapper.style.display = 'inline-block';
            }
            
            // Create Menu Button
            const btn = document.createElement('button');
            btn.id = 'movieListMenuBtn';
            btn.className = 'movie-list-menu-btn';
            btn.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                </svg>
            `;
            btn.title = 'Меню действий';
            
            // Create Dropdown
            const dropdown = document.createElement('div');
            dropdown.className = 'movie-list-dropdown';
            dropdown.id = 'movieListDropdown';
            
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const isActive = dropdown.classList.contains('active');
                
                // Close all other dropdowns
                document.querySelectorAll('.movie-list-dropdown').forEach(d => d.classList.remove('active'));
                
                if (!isActive) {
                    await renderMenuContent(dropdown);
                    dropdown.classList.add('active');
                }
            };
            
            // Close on click outside
            document.addEventListener('click', (e) => {
                if (!btn.contains(e.target) && !dropdown.contains(e.target)) {
                    dropdown.classList.remove('active');
                }
            });
            
            imageWrapper.appendChild(btn);
            imageWrapper.appendChild(dropdown);
            
        } catch (error) {
            console.error('[MovieList Extension] Error setupMenuButton:', error);
        } finally {
            isSettingUpButton = false;
        }
    }
    
    async function renderMenuContent(dropdown) {
        console.log('[MovieList Extension] renderMenuContent called');
        dropdown.innerHTML = '<div style="padding:10px;text-align:center;color:#94a3b8;">Загрузка...</div>';
        
        try {
            console.log('[MovieList Extension] Loading Firebase scripts...');
            await loadFirebaseScripts();
            console.log('[MovieList Extension] Firebase scripts loaded');
            
            console.log('[MovieList Extension] Getting current user via postMessage...');
            const user = await getUser();
            console.log('[MovieList Extension] Current user:', user);
            
            if (!user) {
                console.warn('[MovieList Extension] No user found, showing login message');
                dropdown.innerHTML = `
                    <div style="padding:10px;text-align:center;color:#94a3b8;">
                        Пожалуйста, войдите в расширение
                    </div>
                `;
                return;
            }
            
            console.log('[MovieList Extension] User authenticated:', user.uid);
            
            const movieData = await getMovieData();
            if (!movieData) {
                dropdown.innerHTML = `
                    <div style="padding:10px;text-align:center;color:#ef4444;">
                        Фильм не найден
                    </div>
                `;
                return;
            }
            
            // Check statuses
            const watchlistService = firebaseManagerInstance.getWatchlistService();
            const favoriteService = firebaseManagerInstance.getFavoriteService();
            const ratingService = firebaseManagerInstance.getRatingService();
            
            const [inWatchlist, isFavorite, userRating] = await Promise.all([
                watchlistService.isInWatchlist(user.uid, movieData.movieId),
                favoriteService.isFavorite(user.uid, movieData.movieId),
                ratingService.getRating(user.uid, movieData.movieId)
            ]);
            
            dropdown.innerHTML = '';
            
            // Watchlist Item
            const watchlistItem = createMenuItem(
                inWatchlist ? 'Удалить из Watchlist' : 'Добавить в Watchlist',
                inWatchlist ? '✓' : '🔖',
                inWatchlist
            );
            watchlistItem.onclick = async () => {
                if (inWatchlist) await watchlistService.removeFromWatchlist(user.uid, movieData.movieId);
                else await watchlistService.addToWatchlist(user.uid, movieData);
                dropdown.classList.remove('active');
            };
            dropdown.appendChild(watchlistItem);
            
            // Favorite Item
            const favoriteItem = createMenuItem(
                isFavorite ? 'Удалить из Избранного' : 'Добавить в Избранное',
                isFavorite ? '❤️' : '🤍',
                isFavorite
            );
            favoriteItem.onclick = async () => {
                if (isFavorite) await favoriteService.removeFromFavorites(user.uid, movieData.movieId);
                else await favoriteService.addToFavorites(user.uid, movieData);
                dropdown.classList.remove('active');
            };
            dropdown.appendChild(favoriteItem);
            
            // Divider
            const divider = document.createElement('div');
            divider.className = 'movie-list-divider';
            dropdown.appendChild(divider);
            
            // Rating Item
            const ratingItem = createMenuItem(
                userRating ? `Ваша оценка: ${userRating.rating}` : 'Оценить фильм',
                '⭐',
                !!userRating
            );
            ratingItem.onclick = () => {
                dropdown.classList.remove('active');
                showRatingModal(movieData, userRating?.rating, userRating?.comment || '');
            };
            dropdown.appendChild(ratingItem);
            
        } catch (error) {
            console.error('Error rendering menu:', error);
            dropdown.innerHTML = '<div style="padding:10px;text-align:center;color:#ef4444;">Ошибка загрузки</div>';
        }
    }
    
    function createMenuItem(text, icon, isActive) {
        const btn = document.createElement('button');
        btn.className = `movie-list-menu-item ${isActive ? 'active' : ''}`;
        btn.innerHTML = `
            <span class="movie-list-menu-icon">${icon}</span>
            <span>${text}</span>
        `;
        return btn;
    }
    
    function showRatingModal(movieData, currentRating = 0, currentComment = '') {
        const overlay = document.createElement('div');
        overlay.className = 'movie-list-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'movie-list-modal';
        
        let selectedRating = currentRating;
        let comment = currentComment;
        
        // Build modal HTML
        modal.innerHTML = `
            <div class="movie-list-modal-header">
                <h3 class="movie-list-modal-title">
                    <span style="font-size: 28px;">⭐</span>
                    Rate This Movie
                </h3>
                <button class="movie-list-close-btn">✕</button>
            </div>
            
            <div class="movie-list-modal-body">
                <!-- Movie Card -->
                <div class="movie-list-movie-card">
                    <img src="${movieData.posterPath || 'https://via.placeholder.com/140x200?text=No+Poster'}" 
                         class="movie-list-movie-poster" 
                         alt="${movieData.movieTitle}">
                    <div class="movie-list-movie-info">
                        <h4 class="movie-list-movie-title">${movieData.movieTitle}</h4>
                        <div class="movie-list-movie-meta">
                            ${movieData.releaseYear || ''} • ${(movieData.genres || []).slice(0, 3).join(', ')}
                        </div>
                        <div class="movie-list-movie-ratings">
                            ${movieData.avgRating ? `<div class="movie-list-rating-badge kp">КП: ${movieData.avgRating.toFixed(1)}</div>` : ''}
                        </div>
                    </div>
                </div>
                
                <!-- Current Rating Section (if exists) -->
                ${currentRating > 0 ? `
                    <div class="movie-list-rating-section">
                        <div class="movie-list-section-title">Your Current Rating</div>
                        <div class="movie-list-current-rating">
                            <span class="movie-list-current-rating-label">Rating:</span>
                            <span class="movie-list-current-rating-value">${currentRating}/10</span>
                        </div>
                        ${currentComment ? `<div class="movie-list-current-comment">${currentComment}</div>` : '<div class="movie-list-current-comment">No comment</div>'}
                    </div>
                ` : ''}
                
                <!-- Rating Slider -->
                <div class="movie-list-rating-section">
                    <div class="movie-list-section-title">Your Rating</div>
                    <div class="movie-list-slider-container">
                        <div class="movie-list-slider-value">
                            <span>${selectedRating > 0 ? selectedRating : '?'}</span>
                            <span class="movie-list-slider-value-small">/10</span>
                        </div>
                        <div class="movie-list-slider-wrapper">
                            <input type="range" 
                                   min="1" 
                                   max="10" 
                                   value="${selectedRating || 5}" 
                                   class="movie-list-slider" 
                                   id="ratingSlider"
                                   style="--value: ${((selectedRating || 5) - 1) / 9 * 100}%">
                        </div>
                        <div class="movie-list-slider-labels">
                            ${Array.from({length: 10}, (_, i) => `<span>${i + 1}</span>`).join('')}
                        </div>
                    </div>
                </div>
                
                <!-- Comment Section -->
                <div class="movie-list-comment-section">
                    <div class="movie-list-section-title">Share Your Thoughts</div>
                    <textarea 
                        class="movie-list-comment-textarea" 
                        id="commentTextarea"
                        placeholder="What did you think about this movie? (Optional)"
                        maxlength="500">${comment}</textarea>
                    <div class="movie-list-char-count">
                        <span id="charCount">${comment.length}</span>/500
                    </div>
                </div>
            </div>
            
            <div class="movie-list-modal-footer">
                <button class="movie-list-btn movie-list-btn-cancel">Cancel</button>
                <button class="movie-list-btn movie-list-btn-primary" id="saveRatingBtn">
                    <span>💾</span>
                    <span>Save Rating</span>
                </button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Get elements
        const slider = modal.querySelector('#ratingSlider');
        const sliderValue = modal.querySelector('.movie-list-slider-value span:first-child');
        const commentTextarea = modal.querySelector('#commentTextarea');
        const charCount = modal.querySelector('#charCount');
        const saveBtn = modal.querySelector('#saveRatingBtn');
        const cancelBtn = modal.querySelector('.movie-list-btn-cancel');
        const closeBtn = modal.querySelector('.movie-list-close-btn');
        
        // Update slider value on input
        slider.oninput = function() {
            const value = parseInt(this.value);
            selectedRating = value;
            sliderValue.textContent = value;
            this.style.setProperty('--value', `${(value - 1) / 9 * 100}%`);
        };
        
        // Update char count
        commentTextarea.oninput = function() {
            comment = this.value;
            charCount.textContent = this.value.length;
        };
        
        // Close handlers
        const close = () => overlay.remove();
        closeBtn.onclick = close;
        cancelBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        
        // Save button handler
        saveBtn.onclick = async () => {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span>⏳</span><span>Saving...</span>';
            
            try {
                const user = await getUser();
                if (!user) {
                    alert('Пожалуйста, войдите в систему');
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<span>💾</span><span>Save Rating</span>';
                    return;
                }
                
                // Send rating via background script (proper authentication)
                window.postMessage({
                    type: 'MOVIELIST_ADD_RATING',
                    userId: user.uid,
                    userName: user.displayName || 'User',
                    userPhoto: user.photoURL || '',
                    movieId: movieData.movieId,
                    movieTitle: movieData.movieTitle,
                    posterPath: movieData.posterPath,
                    rating: selectedRating,
                    comment: comment.trim()
                }, '*');
                
                // Wait for response
                await new Promise((resolve) => {
                    const handler = (event) => {
                        if (event.data && event.data.type === 'MOVIELIST_ADD_RATING_RESPONSE') {
                            window.removeEventListener('message', handler);
                            if (event.data.success) {
                                console.log('[MovieList Extension] Rating saved successfully');
                                close();
                                
                                // Show success message
                                const successMsg = document.createElement('div');
                                successMsg.style.cssText = `
                                    position: fixed;
                                    top: 20px;
                                    right: 20px;
                                    background: #10b981;
                                    color: white;
                                    padding: 16px 24px;
                                    border-radius: 8px;
                                    font-weight: 600;
                                    z-index: 300000;
                                    animation: slideIn 0.3s ease-out;
                                `;
                                successMsg.textContent = `✓ Rating saved: ${selectedRating}/10`;
                                document.body.appendChild(successMsg);
                                
                                setTimeout(() => successMsg.remove(), 3000);
                                resolve();
                            } else {
                                throw new Error(event.data.error || 'Failed to save rating');
                            }
                        }
                    };
                    window.addEventListener('message', handler);
                    
                    setTimeout(() => {
                        window.removeEventListener('message', handler);
                        resolve();
                    }, 10000);
                });
                
            } catch (error) {
                console.error('[MovieList Extension] Error saving rating:', error);
                alert('Ошибка при сохранении оценки');
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<span>💾</span><span>Save Rating</span>';
            }
        };
    }
    
    function setupMutationObserver() {
        let debounceTimer = null;
        const observer = new MutationObserver((mutations) => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (!document.getElementById('movieListMenuBtn')) {
                    setupMenuButton();
                }
            }, 500);
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
