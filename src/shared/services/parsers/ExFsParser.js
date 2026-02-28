/**
 * ExFsParser - Parser for ex-fs.net streaming source.
 * Searches for movies and extracts video player sources.
 * Parser for ex-fs.net streaming source.
 * 
 * @extends BaseParserService
 */
class ExFsParser extends BaseParserService {
    constructor() {
        super({
            id: 'exfs',
            name: 'Ex-FS',
            baseUrl: 'https://ex-fs.net'
        });
    }

    // ─── BaseParserService Contract ───────────────────────────────────

    /**
     * Search for a movie by title and year.
     * @param {string} title - Movie title (Russian preferred)
     * @param {string|number|null} year - Movie year
     * @returns {Promise<SearchResult|null>}
     */
    async search(title, year) {
        console.log(`[DEBUG ExFsParser] search() called. title: "${title}", year: ${year}`);
        try {
            const targetYear = year ? year.toString() : null;

            const formData = new FormData();
            formData.append('do', 'search');
            formData.append('subaction', 'search');
            formData.append('story', title);

            const response = await fetch(`${this.baseUrl}/index.php?do=search`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const html = await response.text();
            const result = this.parseSearchResults(html, title, targetYear);
            console.log(`[DEBUG ExFsParser] search result:`, result ? `url: ${result.url?.substring(0,80)}` : 'null');

            if (result) {
                result.parserId = this.id;
            }
            return result;

        } catch (error) {
            console.error(`[${this.name}] Search error:`, error);
            throw error;
        }
    }

    /**
     * Get video sources from a search result.
     * @param {SearchResult} searchResult - Result from search()
     * @returns {Promise<Array<VideoSource>>}
     */
    async getVideoSources(searchResult) {
        console.log(`[DEBUG ExFsParser] getVideoSources() called. searchResult:`, typeof searchResult === 'string' ? searchResult.substring(0,80) : searchResult?.url?.substring(0,80));
        try {
            const url = typeof searchResult === 'string' ? searchResult : searchResult.url;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to load movie page: ${response.status}`);
            }

            const html = await response.text();
            const sources = this.parseMoviePage(html);
            console.log(`[DEBUG ExFsParser] getVideoSources result: ${sources?.length || 0} sources`);
            return sources;

        } catch (error) {
            console.error(`[${this.name}] getVideoSources error:`, error);
            throw error;
        }
    }

    // ─── Internal Parsing Methods ─────────────────────────────────────

    /**
     * Parse search results HTML to find the best matching movie
     */
    parseSearchResults(html, targetTitle, targetYear) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const contentArea = doc.querySelector('#dle-content') || doc.body;
        const searchResultPosts = contentArea.querySelectorAll('.SeaRchresultPost');
        const matches = [];
        
        if (searchResultPosts.length > 0) {
            for (const post of searchResultPosts) {
                const titleLink = post.querySelector('.SeaRchresultPostTitle a');
                if (!titleLink) continue;
                
                const titleText = titleLink.textContent.trim();
                const url = titleLink.href;
                
                if (this.isTitleMatch(titleText, targetTitle)) {
                    let foundYear = null;
                    const infoDiv = post.querySelector('.SeaRchresultPostInfo');
                    if (infoDiv) {
                        const yearMatch = infoDiv.textContent.match(/\b(19|20)\d{2}\b/);
                        foundYear = yearMatch ? yearMatch[0] : null;
                    }
                    
                    matches.push({
                        title: titleText,
                        url: url,
                        year: foundYear,
                        parserId: this.id,
                        source: this.id
                    });
                }
            }
        } else {
            const links = Array.from(contentArea.querySelectorAll('a'));
            const movieLinks = links.filter(link =>
                link.href.includes('/film/') || link.href.includes('/serials/') || link.href.includes('/multfilm/')
            );
            
            for (const link of movieLinks) {
                const titleElement = link.querySelector('h2, h3, .title') || link;
                const titleText = titleElement.textContent.trim();
                
                if (this.isTitleMatch(titleText, targetTitle)) {
                    let foundYear = null;
                    let yearMatch = link.textContent.match(/\b(19|20)\d{2}\b/);
                    
                    if (!yearMatch) {
                        let parent = link.parentElement;
                        for (let i = 0; i < 3; i++) {
                            if (!parent) break;
                            const parentText = parent.textContent || '';
                            yearMatch = parentText.match(/\b(19|20)\d{2}\b/);
                            if (yearMatch) break;
                            parent = parent.parentElement;
                        }
                    }

                    foundYear = yearMatch ? yearMatch[0] : null;

                    matches.push({
                        title: titleText,
                        url: link.href,
                        year: foundYear,
                        parserId: this.id,
                        source: this.id
                    });
                }
            }
        }

        if (targetYear) {
            const yearMatch = matches.find(m => m.year === targetYear);
            if (yearMatch) return yearMatch;
        }

        if (matches.length > 0) return matches[0];
        return null;
    }

    isTitleMatch(foundTitle, targetTitle) {
        if (!foundTitle || !targetTitle) return false;
        const normalize = str => str.toLowerCase().replace(/[^a-zа-я0-9]/g, '');
        const normalizedFound = normalize(foundTitle);
        const normalizedTarget = normalize(targetTitle);
        return normalizedFound.includes(normalizedTarget) || normalizedTarget.includes(normalizedFound);
    }

    /**
     * Parse movie page HTML to extract video players
     */
    parseMoviePage(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const players = [];

        const tabContent = doc.querySelector('.tab-content');
        if (!tabContent) return players;

        const panes = tabContent.querySelectorAll('.tab-pane');

        // Check for video tags (raw sources)
        const videoTags = tabContent.querySelectorAll('video');
        videoTags.forEach(video => {
            const src = video.src || (video.querySelector('source') ? video.querySelector('source').src : null);
            if (src) {
                let name = 'Direct Video';
                const pane = video.closest('.tab-pane');
                if (pane) {
                     const tabLink = doc.querySelector(`.nav-tabs a[href="#${pane.id}"]`);
                     if (tabLink) name = tabLink.textContent.trim();
                }
                
                // Filter: Only allow 'Плеер Full HD'
                if (name === 'Плеер Full HD') {
                    name = 'Ex-FS';
                    players.push({ name, url: src, type: 'video' });
                }
            }
        });

        // Check for iframes
        panes.forEach((pane) => {
            const iframe = pane.querySelector('iframe');
            if (iframe && iframe.src) {
                let name = 'Player';
                const id = pane.id;
                const tabLink = doc.querySelector(`.nav-tabs a[href="#${id}"]`);
                if (tabLink) name = tabLink.textContent.trim();

                // Filter: Only allow 'Плеер Full HD'
                if (name === 'Плеер Full HD') {
                    name = 'Ex-FS';
                    players.push({ name, url: iframe.src, type: 'iframe' });
                }
            }
        });

        return players;
    }

    // ─── Extended Methods (beyond base contract) ──────────────────────

    /**
     * Get full movie details from a page URL.
     * This is an Ex-FS specific method, not part of the parser contract.
     * @param {string} url - Movie page URL
     * @returns {Promise<Object>} Movie object with details
     */
    async getMovieDetails(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load page');
            const html = await response.text();
            
            const details = this.extractMovieDetails(html, url);
            const players = this.parseMoviePage(html);
            
            if (players && players.length > 0) {
                details.videoSources = players;
                const isSeries = players.some(p => p.type === 'iframe' && p.url.includes('season='));
                if (isSeries) details.isSeries = true;
            } else {
                details.videoSources = [];
            }
            
            return details;
        } catch (error) {
            console.error(`[${this.name}] Error in getMovieDetails:`, error);
            throw error;
        }
    }

    /**
     * Extract metadata from movie page HTML
     */
    extractMovieDetails(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const movie = {
            kinopoiskId: null,
            webUrl: url,
            source: 'ex-fs',
            posterUrl: '',
            nameRu: '',
            nameEn: '',
            description: '',
            year: '',
            countries: [],
            genres: [],
            ratingKinopoisk: 0,
            ratingImdb: 0
        };

        // 1. Title
        const titleEl = doc.querySelector('.view-caption') || doc.querySelector('h1');
        if (titleEl) {
            let titleText = titleEl.textContent.trim();
            titleText = titleText.replace(/смотреть онлайн/i, '').trim();
            const parts = titleText.split(' / ');
            movie.nameRu = parts[0].trim();
            if (parts.length > 1) movie.nameEn = parts[1].trim();
        }

        // 1.1 Original Title
        if (!movie.nameEn) {
            const titleEnEl = doc.querySelector('.view-caption2');
            if (titleEnEl) {
                let titleEnText = titleEnEl.textContent.trim();
                titleEnText = titleEnText.replace(/watch online/i, '').trim();
                movie.nameEn = titleEnText;
            }
        }

        // 2. Poster
        const posterImg = doc.querySelector('.movieListPosterWrapper img, .FullstoryFormLeft img, .FullPostPoster img, .poster img, img[itemprop="image"]');
        if (posterImg) {
            let src = posterImg.getAttribute('src');
            if (src) {
                if (src.startsWith('/')) src = this.baseUrl + src;
                movie.posterUrl = src;
            }
        }

        // 3. Description
        const descEl = doc.querySelector('.FullstorySubFormText, .FullPostDescription, .description, [itemprop="description"]');
        if (descEl) movie.description = descEl.textContent.trim();

        // 4. Ratings
        const kpEl = doc.querySelector('.in_name_kp');
        if (kpEl) movie.ratingKinopoisk = parseFloat(kpEl.textContent.trim()) || 0;

        const imdbEl = doc.querySelector('.in_name_imdb');
        if (imdbEl) movie.ratingImdb = parseFloat(imdbEl.textContent.trim()) || 0;

        // 5. Metadata fields
        const infoBlock = doc.querySelector('.FullstoryInfo');
        if (infoBlock) {
            const titles = infoBlock.querySelectorAll('.FullstoryInfoTitle');
            titles.forEach(titleNode => {
                const label = titleNode.textContent.trim().toLowerCase();
                const contentNode = titleNode.nextElementSibling;
                
                if (contentNode) {
                    const text = contentNode.textContent.trim();
                    if (label.includes('год')) {
                         const yearMatch = text.match(/\d{4}/);
                         if (yearMatch) movie.year = parseInt(yearMatch[0]);
                    } else if (label.includes('страна')) {
                        movie.countries = text.split(',').map(c => c.trim()).filter(c => c).map(c => ({ country: c }));
                    } else if (label.includes('жанр')) {
                        movie.genres = text.split(',').map(g => g.trim()).filter(g => g).map(g => ({ genre: g }));
                    } else if (label.includes('время')) {
                        movie.filmLength = text;
                    } else if (label.includes('качество')) {
                        movie.quality = text;
                    }
                }
            });
        }
        
        // Fallback
        if (!infoBlock && !movie.year) {
             const oldInfoBlock = doc.querySelector('.FullPostInfo, .info, .solor-info');
             if (oldInfoBlock) {
                const text = oldInfoBlock.textContent;
                if (!movie.ratingKinopoisk) {
                    const kpMatch = text.match(/(?:кп|кинопоиск)\s*:?\s*(\d+(\.\d+)?)/i);
                    if (kpMatch) movie.ratingKinopoisk = parseFloat(kpMatch[1]);
                }
                if (!movie.ratingImdb) {
                     const imdbMatch = text.match(/(?:imdb|имдб)\s*:?\s*(\d+(\.\d+)?)/i);
                     if (imdbMatch) movie.ratingImdb = parseFloat(imdbMatch[1]);
                }
                const yearMatch = text.match(/(?:год|year)\s*:?\s*(\d{4})/i);
                if (yearMatch) movie.year = parseInt(yearMatch[1]);
             }
        }

        // 6. Crew
        movie.persons = [];
        const crewBlocks = doc.querySelectorAll('.TabDopInfoBlockOne');
        crewBlocks.forEach(block => {
            const titleNode = block.querySelector('.TabDopInfoBlockOneTitle');
            if (titleNode) {
                const title = titleNode.textContent.trim().toLowerCase();
                const links = block.querySelectorAll('a');
                
                let profession = '';
                if (title.includes('режиссер')) profession = 'DIRECTOR';
                else if (title.includes('продюсер')) profession = 'PRODUCER';
                else if (title.includes('сценарист')) profession = 'WRITER';
                else if (title.includes('оператор')) profession = 'OPERATOR';
                else if (title.includes('композитор')) profession = 'COMPOSER';
                else if (title.includes('художник')) profession = 'DESIGNER';
                else if (title.includes('монтажер')) profession = 'EDITOR';
                else if (title.includes('актер') || title.includes('ролях')) profession = 'ACTOR';

                if (profession) {
                    links.forEach(link => {
                         movie.persons.push({ name: link.textContent.trim(), enProfession: profession });
                    });
                }
            }
        });

        // 6.1 Actors
        const actorBlock = doc.querySelector('.FullstoryKadrFormAc');
        if (actorBlock) {
             const actorLinks = actorBlock.querySelectorAll('.MiniPostNameActors');
             actorLinks.forEach(link => {
                 const name = link.textContent.trim();
                 let photoUrl = null;
                 const prevLink = link.previousElementSibling;
                 if (prevLink && prevLink.tagName === 'A') {
                     const img = prevLink.querySelector('img');
                     if (img) {
                         const src = img.getAttribute('src');
                         if (src) photoUrl = src.startsWith('/') ? this.baseUrl + src : src;
                     }
                 }
                 movie.persons.push({ name, enProfession: 'ACTOR', photo: photoUrl });
             });
        }

        // 7. Frames
        movie.frames = [];
        const framesBlock = doc.querySelector('.FullstoryKadrFormImg');
        if (framesBlock) {
            const frameLinks = framesBlock.querySelectorAll('a.lightbox');
            frameLinks.forEach(link => {
                let href = link.getAttribute('href');
                if (href) {
                     if (href.startsWith('/')) href = this.baseUrl + href;
                     movie.frames.push({ url: href });
                }
            });
        }

        // 8. Budget and Fees
        movie.budget = null;
        movie.fees = {};
        const financeBlocks = doc.querySelectorAll('.TabDopInfoBlockToo');
        financeBlocks.forEach(block => {
            const titleNode = block.querySelector('.TabDopInfoBlockTooTitle');
            if (titleNode) {
                const title = titleNode.textContent.trim().toLowerCase();
                const clone = block.cloneNode(true);
                const cloneTitle = clone.querySelector('.TabDopInfoBlockTooTitle');
                if (cloneTitle) cloneTitle.remove();
                let valueText = clone.textContent.trim();

                const parseCurrency = (str) => {
                    if (str.includes('=')) str = str.split('=').pop().trim();
                    let currency = 'USD';
                    if (str.includes('€')) currency = 'EUR';
                    else if (str.includes('₽') || str.includes('руб')) currency = 'RUB';
                    const numStr = str.replace(/[^\d]/g, '');
                    const value = parseInt(numStr);
                    return value ? { value, currency } : null;
                };

                if (title.includes('бюджет')) movie.budget = parseCurrency(valueText);
                else if (title.includes('сборы в мире')) movie.fees.world = parseCurrency(valueText);
                else if (title.includes('сборы в сша')) movie.fees.usa = parseCurrency(valueText);
                else if (title.includes('сборы в рф') || title.includes('сборы в россии')) movie.fees.russia = parseCurrency(valueText);
            }
        });

        // Deduplicate persons
        const uniquePersons = new Map();
        movie.persons.forEach(p => {
            const key = `${p.enProfession}-${p.name}`;
            const existing = uniquePersons.get(key);
            if (!existing || (p.photo && !existing.photo)) uniquePersons.set(key, p);
        });
        movie.persons = Array.from(uniquePersons.values());

        if (!movie.ratingKinopoisk) movie.ratingKinopoisk = 0;
        if (!movie.ratingImdb) movie.ratingImdb = 0;

        return movie;
    }
}

// Export — backward compatible
if (typeof window !== 'undefined') {
    window.ExFsParser = ExFsParser;

}
