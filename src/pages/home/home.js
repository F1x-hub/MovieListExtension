class HomePage {
    constructor() {
        this.baseUrl = 'https://ex-fs.net';
        this.cacheKey = 'exFsData';
        this.cacheVersion = '3.0'; // Updated for new slider parsing logic
        this.cacheTTL = 24 * 60 * 60 * 1000; // 24 hours
        
        // Pagination state
        this.itemsPerPage = 5;
        this.currentPage = 0;
        this.totalPages = 0;
        this.sliderItems = [];
        
        // DOM Elements
        this.loader = document.getElementById('loader');
        this.errorScreen = document.getElementById('error-screen');
        this.errorMessage = document.getElementById('error-message');
        this.retryBtn = document.getElementById('retry-btn');
        this.contentContainer = document.getElementById('content');
        
        // UI State Manager
        this.page = Utils.createPageStateManager({
            loader: this.loader,
            errorScreen: this.errorScreen,
            errorMessage: this.errorMessage,
            contentContainer: this.contentContainer
        });
        
         // Featured Slider
        this.featuredSlider = document.getElementById('featured-slider');
        this.paginationContainer = document.getElementById('slider-pagination');
        
        // Sections (grids only)
        this.filmsSection = {
            grid: document.getElementById('films-grid')
        };
        this.seriesSection = {
            grid: document.getElementById('series-grid')
        };
        this.cartoonsSection = {
            grid: document.getElementById('cartoons-grid')
        };
        this.tvShowsSection = {
            grid: document.getElementById('tvShows-grid')
        };

        this.bindEvents();
    }

    bindEvents() {
        this.retryBtn.addEventListener('mousedown', () => {
            this.init();
        });

        // Clear cache button
        const clearCacheBtn = document.getElementById('clearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('mousedown', async () => {
                console.log('HomePage: Manually clearing cache...');
                await chrome.storage.local.remove([this.cacheKey]);
                console.log('HomePage: Cache cleared, reloading...');
                window.location.reload();
            });
        }

        // Delegate clicks for movie cards
    }

    async init() {
        this.page.showLoader();
        
        try {
            // 1. Check Cache
            const cached = await this.getFromCache();
            if (cached) {
                console.log('HomePage: Loading from cache');
                
                // Validate that slider has items - if not, clear cache and retry
                if (!cached.featuredSlider || cached.featuredSlider.length === 0) {
                    console.warn('HomePage: Cached data has no slider items, clearing cache and fetching fresh');
                    await chrome.storage.local.remove([this.cacheKey]);
                    // Retry init
                    return this.init();
                }
                
                this.render(cached);
                this.page.showContent();
                return;
            }

            // 2. Fetch Data
            console.log('HomePage: Fetching fresh data from ex-fs.net');
            const html = await this.fetchWithRetry(this.baseUrl);
            
            // 3. Parse Data
            const data = this.parseData(html);
            console.log('HomePage: Parsed data:', data);
            
            // 4. Cache Data
            await this.saveToCache(data);
            
            // 5. Render
            this.render(data);
            this.page.showContent();
            
            // Spoiler reveal logic
            Utils.bindSpoilerReveal(document);

        } catch (error) {
            console.error('HomePage Init Error:', error);
            this.page.showError('Произошла ошибка при загрузке данных: ' + error.message);
        }
    }

    // --- Networking ---

    async fetchWithRetry(url, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                        { type: 'FETCH_HTML', url: url },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                                return;
                            }
                            if (response && response.success) {
                                resolve(response.data);
                            } else {
                                reject(new Error(response ? response.error : 'Unknown error'));
                            }
                        }
                    );
                });
            } catch (error) {
                console.warn(`HomePage: Fetch attempt ${i + 1} failed:`, error);
                if (i === maxRetries - 1) throw error;
                
                // Exponential backoff: 1s, 2s, 4s
                const delay = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // --- Parsing ---

    parseData(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const result = {
            featuredSlider: [],
            films: { grid: [] },
            series: { grid: [] },
            cartoons: { grid: [] },
            tvShows: { grid: [] }
        };

        // 1. Parse Featured Slider (owl-carousel)
        const sliders = doc.querySelectorAll('.owl-carousel');
        if (sliders.length > 0) {
            const items = this.parseSliderItems(sliders[0]); // Use first slider as featured
            result.featuredSlider = items;
        }

        // 2. Parse Grid Sections (Sequential Logic)
        const titleBoxes = doc.querySelectorAll('.TitleScrollBox');
        
        titleBoxes.forEach(titleBox => {
            const link = titleBox.querySelector('a');
            const href = link ? link.getAttribute('href') : '';
            const titleText = link ? link.textContent.trim().toLowerCase() : '';
            
            let sectionKey = null;
            if (href && href.includes('/film/')) sectionKey = 'films';
            else if (href && href.includes('/serials/')) sectionKey = 'series';
            else if (href && href.includes('/multfilm/')) sectionKey = 'cartoons';
            else if (href && href.includes('/tv-show/')) sectionKey = 'tvShows';
            
            if (!sectionKey) {
                if (titleText.includes('фильмы')) sectionKey = 'films';
                else if (titleText.includes('сериалы')) sectionKey = 'series';
                else if (titleText.includes('мультфильмы')) sectionKey = 'cartoons';
                else if (titleText.includes('передачи') || titleText.includes('шоу')) sectionKey = 'tvShows';
            }

            if (!sectionKey) return;

            let nextElement = titleBox.nextElementSibling;
            while (nextElement && !nextElement.classList.contains('TitleScrollBox')) {
                if (nextElement.classList.contains('MiniPostAllForm') || 
                    nextElement.classList.contains('MiniPostAllFormDop')) {
                    
                    const card = this.parseMovieCard(nextElement);
                    if (card) {
                        result[sectionKey].grid.push(card);
                    }
                }
                nextElement = nextElement.nextElementSibling;
            }
        });

        return result;
    }

    parseSliderItems(sliderElement) {
        const items = [];
        
        console.log('=== SLIDER PARSING START ===');
        console.log('Slider element:', sliderElement);
        
        // owl-carousel's .owl-item elements are created by JS and don't exist in raw HTML
        // We need to look for <li> elements directly
        let itemNodes = sliderElement.querySelectorAll('li');
        console.log('Found li elements:', itemNodes.length);
        
        if (itemNodes.length === 0) {
            console.error('No li elements found in slider!');
            console.log('Slider HTML:', sliderElement.outerHTML.substring(0, 500));
            return items;
        }
        
        console.log(`Processing ${itemNodes.length} li elements...`);
        
        itemNodes.forEach((node, index) => {
            console.log(`\n--- Processing item ${index + 1} ---`);
            
            // Look for link inside: li > .MiniPostAllFormSl > .MiniPostSl > a
            let link = node.querySelector('.MiniPostSl a');
            console.log('Found .MiniPostSl a:', !!link);
            
            if (!link) {
                // Try alternative selector
                link = node.querySelector('a');
                console.log('Found any a:', !!link);
            }
            
            if (!link) {
                console.warn(`Item ${index + 1}: No link found`);
                return;
            }

            const href = link.getAttribute('href');
            console.log('Link href:', href);
            
            if (!href) {
                console.warn(`Item ${index + 1}: Link has no href`);
                return;
            }

            const img = node.querySelector('img');
            console.log('Found img:', !!img);
            
            if (!img) {
                console.warn(`Item ${index + 1}: No image found`);
                return;
            }
            
            // Get title from img title attribute
            const imgTitle = img.getAttribute('title');
            const imgAlt = img.getAttribute('alt');
            console.log('Image title attribute:', imgTitle);
            
            const title = imgTitle || imgAlt || '';
            
            // Extract "Смотреть «TITLE» онлайн" pattern
            let cleanTitle = title;
            const titleMatch = title.match(/«(.+?)»/);
            if (titleMatch) {
                cleanTitle = titleMatch[1];
                console.log('Extracted title from pattern:', cleanTitle);
            } else {
                console.log('No pattern match, using raw title:', cleanTitle);
            }
            
            // Trim at " / " to remove Ukrainian translation
            if (cleanTitle.includes(' / ')) {
                cleanTitle = cleanTitle.split(' / ')[0].trim();
                console.log('Trimmed title at " / ":', cleanTitle);
            }
            
            const posterData = this.extractPoster(img);
            console.log('Extracted poster:', posterData.poster);

            if (cleanTitle && posterData.poster) {
                const item = {
                    title: cleanTitle,
                    href: href,
                    poster: posterData.poster,
                    year: '',
                    quality: '',
                    isSlider: true
                };
                items.push(item);
                console.log(`✅ Successfully parsed item ${index + 1}:`, cleanTitle);
            } else {
                console.warn(`❌ Failed to parse item ${index + 1}: title=${!!cleanTitle}, poster=${!!posterData.poster}`);
            }
        });
        
        console.log(`\n=== SLIDER PARSING COMPLETE ===`);
        console.log(`Total items parsed: ${items.length}`);
        console.log('Parsed items:', items);
        
        return items;
    }

    parseMovieCard(element) {
        try {
            const link = element.querySelector('a');
            if (!link) return null;
            
            const href = link.getAttribute('href');
            
            const img = element.querySelector('img');
            const posterData = this.extractPoster(img);
            
            let title = '';
            // Look for title in .MiniPostName first
            const titleEl = element.querySelector('.MiniPostName a, .MiniPostName, .miniPostTitle, .ntitle');
            if (titleEl) {
                title = titleEl.textContent.trim();
            } else {
                // Fallback to link text or img alt
                title = link.textContent.trim() || (img ? img.getAttribute('alt') : '') || '';
            }
            
            // Trim at " / " to remove Ukrainian translation
            if (title.includes(' / ')) {
                title = title.split(' / ')[0].trim();
            }

            let year = '';
            let quality = '';
            
            // Look for year in various places
            const yearEl = element.querySelector('.year, .MiniPostYear');
            if (yearEl) {
                year = yearEl.textContent.trim();
            } else {
                // Try to extract from text content
                const infoText = element.textContent;
                const yearMatch = infoText.match(/\b(19|20)\d{2}\b/);
                if (yearMatch) {
                    year = yearMatch[0];
                }
            }
            
            const qualEl = element.querySelector('.kachestvo, .quality');
            if (qualEl) quality = qualEl.textContent.trim();

            return {
                title: title,
                href: href,
                poster: posterData.poster,
                year: year,
                quality: quality
            };

        } catch (e) {
            console.warn('Error parsing card:', e);
            return null;
        }
    }

    extractPoster(imgElement) {
        if (!imgElement) return { poster: null, thumb: null };
        
        const rawSrc = imgElement.getAttribute('src') || imgElement.getAttribute('data-src');
        if (!rawSrc) return { poster: null, thumb: null };

        let src = rawSrc;
        if (src.startsWith('/')) {
            src = this.baseUrl + src;
        }

        let originalPoster = src;
        if (src.includes('thumbs.php')) {
            try {
                const urlObj = new URL(src, this.baseUrl);
                const embeddedSrc = urlObj.searchParams.get('src');
                if (embeddedSrc) {
                    originalPoster = embeddedSrc;
                    if (originalPoster.startsWith('/')) {
                        originalPoster = this.baseUrl + originalPoster;
                    }
                }
            } catch (e) {
                // Failed to parse URL, keep original
            }
        }

        return {
            poster: originalPoster,
            thumb: src 
        };
    }

    async getFromCache() {
        return new Promise((resolve) => {
            chrome.storage.local.get([this.cacheKey], (result) => {
                const cached = result[this.cacheKey];
                if (!cached) {
                    resolve(null);
                    return;
                }

                if (cached.version !== this.cacheVersion) {
                    console.log('HomePage: Cache version mismatch, clearing');
                    chrome.storage.local.remove([this.cacheKey]);
                    resolve(null);
                    return;
                }

                if (Date.now() - cached.timestamp > this.cacheTTL) {
                    console.log('HomePage: Cache expired, clearing');
                    chrome.storage.local.remove([this.cacheKey]);
                    resolve(null);
                    return;
                }

                // Validate data structure
                if (!cached.data || !cached.data.featuredSlider) {
                    console.warn('HomePage: Invalid cache structure, clearing');
                    chrome.storage.local.remove([this.cacheKey]);
                    resolve(null);
                    return;
                }

                resolve(cached.data);
            });
        });
    }

    async saveToCache(data) {
        const cacheObject = {
            version: this.cacheVersion,
            timestamp: Date.now(),
            data: data
        };
        
        return new Promise((resolve) => {
            chrome.storage.local.set({ [this.cacheKey]: cacheObject }, () => {
                console.log('HomePage: Data cached');
                resolve();
            });
        });
    }

    render(data) {
        console.log('HomePage: Rendering data:', data);
        
        // Render featured slider
        if (this.featuredSlider && data.featuredSlider && data.featuredSlider.length > 0) {
            console.log('HomePage: Rendering featured slider with', data.featuredSlider.length, 'items');
            this.sliderItems = data.featuredSlider;
            this.featuredSlider.innerHTML = data.featuredSlider.map(item => this.createSliderCardHTML(item)).join('');
            
            // Initialize pagination
            this.initializePagination();
        } else {
            console.warn('HomePage: No featured slider data', {
                hasElement: !!this.featuredSlider,
                hasData: !!data.featuredSlider,
                itemCount: data.featuredSlider ? data.featuredSlider.length : 0
            });
        }
        
        // Render category sections
        this.createSection('Фильмы', this.filmsSection, data.films);
        this.createSection('Сериалы', this.seriesSection, data.series);
        this.createSection('Мультфильмы', this.cartoonsSection, data.cartoons);
        this.createSection('Передачи и шоу', this.tvShowsSection, data.tvShows);
        
        this.contentContainer.style.display = 'block';
    }

    createSection(title, domSection, dataSection) {
        if (domSection.grid && dataSection.grid && dataSection.grid.length > 0) {
            domSection.grid.innerHTML = dataSection.grid.map(item => this.createMovieCardHTML(item)).join('');
        } else {
            if (domSection.grid) {
                domSection.grid.innerHTML = '<p style="color:var(--theme-text-secondary); text-align:center;">Нет данных</p>';
            }
        }
    }

    createMovieCardHTML(item) {
        const title = this.escapeHtml(item.title || 'Без названия');
        const poster = item.poster || '../../icons/icon128-black.png'; 
        const year = item.year ? `<span class="card-year">${item.year}</span>` : '';
        const quality = item.quality ? `<span class="card-quality">${item.quality}</span>` : '';
        const href = item.href ? (item.href.startsWith('/') ? this.baseUrl + item.href : item.href) : '#';

        return `
            <a href="${chrome.runtime.getURL(`src/pages/search/search.html?sourceUrl=${encodeURIComponent(href)}`)}" class="movie-card" data-href="${href}">
                <img class="card-poster" src="${poster}" alt="${title}" loading="lazy">
                <div class="card-info">
                    <h3 class="card-title">${title}</h3>
                    <div class="card-meta">
                        ${year}
                        ${quality}
                    </div>
                </div>
            </a>
        `;
    }

    createSliderCardHTML(item) {
        const title = this.escapeHtml(item.title || 'Без названия');
        const poster = item.poster || '../../icons/icon128-black.png'; 
        const href = item.href ? (item.href.startsWith('/') ? this.baseUrl + item.href : item.href) : '#';

        return `
            <a href="${chrome.runtime.getURL(`src/pages/search/search.html?sourceUrl=${encodeURIComponent(href)}`)}" class="featured-card" data-href="${href}">
                <img class="featured-poster" src="${poster}" alt="${title}" loading="lazy">
                <div class="featured-overlay">
                    <h3 class="featured-title">${title}</h3>
                </div>
            </a>
        `;
    }

    escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // --- Pagination Methods ---

    initializePagination() {
        if (!this.sliderItems || this.sliderItems.length === 0) return;
        
        // Calculate total pages
        this.totalPages = Math.ceil(this.sliderItems.length / this.itemsPerPage);
        
        // Create pagination dots
        this.createPaginationDots();
        
        // Show first page
        this.currentPage = 0;
        this.showPage(0);
    }

    createPaginationDots() {
        if (!this.paginationContainer) return;
        
        // Clear existing dots
        this.paginationContainer.innerHTML = '';
        
        // Create dots
        for (let i = 0; i < this.totalPages; i++) {
            const dot = document.createElement('div');
            dot.className = 'pagination-dot';
            dot.dataset.page = i;
            
            // Add click listener
            dot.addEventListener('click', () => {
                this.showPage(i);
            });
            
            this.paginationContainer.appendChild(dot);
        }
    }

    showPage(pageIndex) {
        if (pageIndex < 0 || pageIndex >= this.totalPages) return;
        
        this.currentPage = pageIndex;
        
        // Constants (must match CSS)
        const cardWidth = 256;
        const gap = 20;
        const itemsPerPage = 5;
        
        let targetIndex = pageIndex * itemsPerPage;
        
        // "Last page" requirement: show exactly 5 elements if possible
        if (pageIndex === this.totalPages - 1 && this.sliderItems.length > itemsPerPage) {
            targetIndex = Math.max(0, this.sliderItems.length - itemsPerPage);
        }
        
        // Calculate offset
        const offset = -(targetIndex * (cardWidth + gap));
        
        // Apply transform to slider container
        if (this.featuredSlider) {
            this.featuredSlider.style.transform = `translateX(${offset}px)`;
        }
        
        // Update active dot
        this.updateActiveDot(pageIndex);
    }

    updateActiveDot(pageIndex) {
        if (!this.paginationContainer) return;
        
        const dots = this.paginationContainer.querySelectorAll('.pagination-dot');
        dots.forEach((dot, index) => {
            if (index === pageIndex) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }

    // Local showLoader/hideLoader/showError/hideError removed in favor of this.page (PageStateManager)
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Navigation
    if (typeof Navigation !== 'undefined') {
        const navigation = new Navigation();
        console.log('HomePage: Navigation initialized');
    } else {
        console.error('HomePage: Navigation class not found');
    }
    
    // Initialize HomePage
    window.homePage = new HomePage();
    window.homePage.init();
});
