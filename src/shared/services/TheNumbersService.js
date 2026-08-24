/**
 * TheNumbersService - Personal-use HTML provider adapter for The Numbers.
 *
 * Requests are intentionally bounded by a 24-hour local cache. The service
 * does not send cookies or browser-only request headers and only accepts an
 * explicit source URL, a manually verified mapping, or a verified title slug.
 */
class TheNumbersService {
    static CACHE_PREFIX = 'the_numbers_box_office_v2_';
    static TRACKED_KEY = 'the_numbers_tracked_movies_v1';
    static CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    static SOURCE_HOST = 'www.the-numbers.com';
    static SOURCE_YEAR_TOLERANCE = 1;
    static SOURCE_DISCOVERY_LIMIT = 8;

    constructor(options = {}) {
        this.storage = options.storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
        this.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
        this.inFlight = new Map();
    }

    static normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u2018\u2019']/g, '')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    static normalizeUrl(url) {
        try {
            const parsed = new URL(String(url || '').trim());
            if (parsed.protocol !== 'https:' || parsed.hostname !== this.SOURCE_HOST) return null;
            parsed.hash = '';
            parsed.search = '';
            return parsed.toString().replace(/\/$/, '');
        } catch {
            return null;
        }
    }

    static getMovieTitleCandidates(movie) {
        return [movie?.name, movie?.alternativeName, movie?.enName, movie?.originalName]
            .filter(Boolean)
            .map(this.normalizeText)
            .filter(Boolean);
    }

    static getMappingTitleCandidates(entry) {
        return [entry?.title, ...(Array.isArray(entry?.aliases) ? entry.aliases : [])]
            .filter(Boolean)
            .map(this.normalizeText)
            .filter(Boolean);
    }

    static resolveSourceMapping(movie, mappings = globalThis.THE_NUMBERS_SOURCE_MAPPINGS || []) {
        const movieYear = Number(movie?.year);
        if (!Number.isFinite(movieYear)) return null;

        const movieTitles = this.getMovieTitleCandidates(movie);
        if (movieTitles.length === 0) return null;

        return mappings
            .map((entry, index) => {
                const mappingYear = Number(entry?.year);
                const yearDistance = Math.abs(mappingYear - movieYear);
                const configuredTolerance = Number(entry?.yearTolerance);
                const yearTolerance = Number.isFinite(configuredTolerance)
                    ? Math.max(0, configuredTolerance)
                    : this.SOURCE_YEAR_TOLERANCE;
                const mappingTitles = this.getMappingTitleCandidates(entry);
                const titleRank = movieTitles.findIndex(title => mappingTitles.includes(title));

                if (!Number.isFinite(mappingYear) || yearDistance > yearTolerance || titleRank < 0) return null;
                return { entry, index, titleRank, yearDistance };
            })
            .filter(Boolean)
            .sort((left, right) =>
                left.yearDistance - right.yearDistance
                || left.titleRank - right.titleRank
                || left.index - right.index
            )[0]?.entry || null;
    }

    static resolveSourceUrl(movie, mappings = globalThis.THE_NUMBERS_SOURCE_MAPPINGS || []) {
        const explicit = movie?.theNumbersUrl || movie?.boxOffice?.sourceUrl || movie?.externalId?.theNumbersUrl;
        const explicitUrl = this.normalizeUrl(explicit);
        if (explicitUrl) return explicitUrl;

        const match = this.resolveSourceMapping(movie, mappings);
        return this.normalizeUrl(match?.url);
    }

    static slugifyTitle(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/&/g, ' and ')
            .replace(/[^a-zA-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    static getSourceTitleSlugs(movie) {
        const titles = [movie?.enName, movie?.alternativeName, movie?.originalName, movie?.name]
            .filter(Boolean)
            .map(this.slugifyTitle)
            .filter(Boolean);
        return [...new Set(titles)];
    }

    static getSourceUrlCandidates(movie, mappings = globalThis.THE_NUMBERS_SOURCE_MAPPINGS || []) {
        const candidates = [];
        const add = url => {
            const normalized = this.normalizeUrl(url);
            if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
        };
        add(movie?.theNumbersUrl || movie?.boxOffice?.sourceUrl || movie?.externalId?.theNumbersUrl);
        add(this.resolveSourceUrl(movie, mappings));

        const movieYear = Number(movie?.year);
        const years = Number.isFinite(movieYear) ? [null, movieYear, movieYear - 1, movieYear + 1] : [null];
        for (const slug of this.getSourceTitleSlugs(movie)) {
            const parts = slug.split('-');
            const article = /^(the|a|an)$/i.test(parts[0]) ? parts.shift() : null;
            const slugVariants = [slug];
            if (article && parts.length > 0) slugVariants.push(`${parts.join('-')}-${article}`);

            for (const variant of slugVariants) {
                for (const year of years) {
                    add(`https://${this.SOURCE_HOST}/movie/${variant}${year ? `-(${year})` : ''}`);
                }
            }
        }
        return candidates.slice(0, this.SOURCE_DISCOVERY_LIMIT);
    }

    static extractSourcePageTitle(html) {
        const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
            || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
            || '';
        return this.stripHtml(heading)
            .replace(/\s+-\s+Box Office and Financial Information.*$/i, '')
            .replace(/\s*\((?:19|20)\d{2}\)\s*$/, '')
            .trim();
    }

    static getTitleSignature(value) {
        return this.normalizeText(value)
            .replace(/\b(?:19|20)\d{2}\b/g, '')
            .trim()
            .split(' ')
            .filter(Boolean)
            .sort()
            .join(' ');
    }

    static isVerifiedSourcePage(html, movie) {
        const pageTitle = this.extractSourcePageTitle(html);
        const pageYear = Number(html.match(/<h1\b[^>]*>[\s\S]*?\b((?:19|20)\d{2})\b[\s\S]*?<\/h1>/i)?.[1]);
        const movieYear = Number(movie?.year);
        const titleMatches = this.getMovieTitleCandidates(movie).some(title =>
            this.getTitleSignature(title) === this.getTitleSignature(pageTitle)
        );
        const yearMatches = Number.isFinite(movieYear) && Number.isFinite(pageYear)
            && Math.abs(movieYear - pageYear) <= this.SOURCE_YEAR_TOLERANCE;
        return titleMatches && yearMatches;
    }

    static getMovieIdentity(movie) {
        const kinopoiskId = Number(movie?.kinopoiskId || movie?.id);
        if (!Number.isSafeInteger(kinopoiskId) || kinopoiskId <= 0) return null;
        return {
            kinopoiskId,
            title: movie?.name || movie?.alternativeName || movie?.enName || '',
            year: Number(movie?.year) || null
        };
    }

    static cacheKey(kinopoiskId) {
        return `${this.CACHE_PREFIX}${kinopoiskId}`;
    }

    static decodeHtmlEntities(value) {
        return String(value || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
            .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
    }

    static stripHtml(value) {
        return this.decodeHtmlEntities(String(value || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' '))
            .replace(/\s+/g, ' ')
            .trim();
    }

    static parseMoney(value) {
        const text = this.stripHtml(value);
        if (!text || /^(?:n\/a|na|-)$/i.test(text)) return null;
        const numeric = text.replace(/[^\d.-]/g, '');
        if (!numeric || !/^-?\d+(?:\.\d+)?$/.test(numeric)) return null;
        const amount = Number(numeric);
        return Number.isFinite(amount) ? amount : null;
    }

    static extractBalancedLiteral(source, marker, opening, closing) {
        const markerMatch = source.match(marker);
        if (!markerMatch) return null;

        const start = source.indexOf(opening, markerMatch.index + markerMatch[0].length);
        if (start < 0) return null;

        let depth = 0;
        let quote = null;
        let escaped = false;
        for (let index = start; index < source.length; index += 1) {
            const char = source[index];
            if (quote) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === quote) quote = null;
                continue;
            }
            if (char === '"' || char === "'") {
                quote = char;
                continue;
            }
            if (char === opening) depth += 1;
            if (char === closing) {
                depth -= 1;
                if (depth === 0) return source.slice(start, index + 1);
            }
        }
        return null;
    }

    static parseChartData(html) {
        const chartObject = html.match(/window\.movieBoxOfficeCharts\s*=\s*\{[\s\S]*?\bcanvases\s*:/i)?.[0];
        if (!chartObject) return null;

        try {
            const labels = JSON.parse(this.extractBalancedLiteral(chartObject, /\blabels\s*:/i, '[', ']') || 'null');
            const data = JSON.parse(this.extractBalancedLiteral(chartObject, /\bdata\s*:/i, '[', ']') || 'null');
            const bands = JSON.parse(this.extractBalancedLiteral(chartObject, /\bbands\s*:/i, '{', '}') || 'null');
            if (!Array.isArray(labels) || !Array.isArray(data) || labels.length < 2 || data.length < 2) return null;

            const points = labels.map((date, index) => ({
                date: typeof date === 'string' ? date : '',
                cumulative: Number.isFinite(Number(data[index])) ? Number(data[index]) : null,
                band: bands?.[date] && typeof bands[date] === 'object'
                    ? {
                        bottom10: Number.isFinite(Number(bands[date].p10)) ? Number(bands[date].p10) : null,
                        median: Number.isFinite(Number(bands[date].p50)) ? Number(bands[date].p50) : null,
                        top10: Number.isFinite(Number(bands[date].p90)) ? Number(bands[date].p90) : null
                    }
                    : null
            })).filter(point => point.date && point.cumulative !== null);

            return points.length >= 2 ? { type: 'domestic-cumulative', points } : null;
        } catch {
            return null;
        }
    }

    static parseHtml(html, sourceUrl = '') {
        if (typeof html !== 'string' || !html.trim()) throw new Error('THE_NUMBERS_EMPTY_RESPONSE');

        const financeTable = html.match(/<table\b[^>]*\bid\s*=\s*["']movie_finances["'][^>]*>[\s\S]*?<\/table>/i)?.[0];
        if (!financeTable) throw new Error('THE_NUMBERS_FINANCE_TABLE_NOT_FOUND');

        const rows = financeTable.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
        const result = {
            provider: 'the-numbers',
            sourceUrl: this.normalizeUrl(sourceUrl),
            currency: 'USD',
            theatrical: {
                domestic: null,
                international: null,
                worldwide: null
            },
            physicalMedia: {
                region: 'domestic',
                dvdSales: { amount: null, estimated: false },
                bluRaySales: { amount: null, estimated: false },
                total: { amount: null, estimated: false }
            },
            chart: null,
            opusDataId: null,
            fetchedAt: Date.now()
        };

        let inPhysicalMediaSection = false;
        for (const row of rows) {
            const cells = [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map(match => ({
                attributes: match[1] || '',
                html: match[2] || '',
                text: this.stripHtml(match[2] || '')
            }));
            if (cells.length === 0) continue;

            const label = cells[0].text;
            if (/Domestic Physical Disc Sales/i.test(label)) {
                inPhysicalMediaSection = true;
                continue;
            }
            if (/^(?:Theatrical Performance|Domestic Box Office|International Box Office|Worldwide Box Office)$/i.test(label)) {
                if (/Theatrical Performance/i.test(label)) inPhysicalMediaSection = false;
            }

            const dataCell = cells.find(cell => /(?:^|\s)class\s*=\s*["'][^"']*\bdata\b/i.test(cell.attributes));
            const amount = dataCell ? this.parseMoney(dataCell.text) : null;
            const estimated = /estimated/i.test(label);

            if (/^Domestic Box Office$/i.test(label)) result.theatrical.domestic = amount;
            else if (/^International Box Office$/i.test(label)) result.theatrical.international = amount;
            else if (/^Worldwide Box Office$/i.test(label)) result.theatrical.worldwide = amount;
            else if (inPhysicalMediaSection && /^DVD Sales/i.test(label)) {
                result.physicalMedia.dvdSales = { amount, estimated };
            } else if (inPhysicalMediaSection && /^Blu-ray Sales/i.test(label)) {
                result.physicalMedia.bluRaySales = { amount, estimated };
            } else if (inPhysicalMediaSection && /^Total$/i.test(label)) {
                result.physicalMedia.total = { amount, estimated };
            }
        }

        const opusMatch = html.match(/OpusData\s+ID:\s*([\d]+)/i);
        if (opusMatch) result.opusDataId = opusMatch[1];
        result.chart = this.parseChartData(html);

        const hasFinancialValue = Object.values(result.theatrical).some(value => value !== null)
            || Object.values(result.physicalMedia).some(value => value && typeof value === 'object' && value.amount !== null)
            || result.chart?.points?.length >= 2;
        if (!hasFinancialValue) throw new Error('THE_NUMBERS_NO_FINANCIAL_DATA');

        return result;
    }

    async getCached(kinopoiskId) {
        if (!this.storage?.get) return null;
        const key = TheNumbersService.cacheKey(kinopoiskId);
        const stored = await this.storage.get(key);
        return stored?.[key] || null;
    }

    async setCached(kinopoiskId, snapshot) {
        if (!this.storage?.set) return;
        await this.storage.set({ [TheNumbersService.cacheKey(kinopoiskId)]: snapshot });
    }

    async trackMovie(identity, sourceUrl) {
        if (!this.storage?.get || !this.storage?.set) return;
        const stored = await this.storage.get(TheNumbersService.TRACKED_KEY);
        const tracked = stored?.[TheNumbersService.TRACKED_KEY] || {};
        tracked[String(identity.kinopoiskId)] = { ...identity, sourceUrl };
        await this.storage.set({ [TheNumbersService.TRACKED_KEY]: tracked });
    }

    async fetchHtml(sourceUrl) {
        if (!this.fetchImpl) throw new Error('THE_NUMBERS_FETCH_UNAVAILABLE');
        const response = await this.fetchImpl(sourceUrl, {
            method: 'GET',
            credentials: 'omit',
            cache: 'no-store',
            headers: { Accept: 'text/html,application/xhtml+xml' }
        });
        if (!response.ok) throw new Error(`THE_NUMBERS_HTTP_${response.status}`);
        return response.text();
    }

    async fetchSnapshot(sourceUrl) {
        return TheNumbersService.parseHtml(await this.fetchHtml(sourceUrl), sourceUrl);
    }

    async discoverSource(movie, mappings) {
        const candidates = TheNumbersService.getSourceUrlCandidates(movie, mappings);
        for (const sourceUrl of candidates) {
            try {
                const html = await this.fetchHtml(sourceUrl);
                if (!TheNumbersService.isVerifiedSourcePage(html, movie)) continue;
                return {
                    sourceUrl,
                    snapshot: TheNumbersService.parseHtml(html, sourceUrl)
                };
            } catch {
                // Candidate URLs are speculative; continue with the next slug.
            }
        }
        return null;
    }

    async refreshMovie(movie, options = {}) {
        const identity = TheNumbersService.getMovieIdentity(movie);
        if (!identity) return null;

        const movieKey = String(identity.kinopoiskId);
        if (this.inFlight.has(movieKey)) return this.inFlight.get(movieKey);

        const refreshPromise = (async () => {
            const cached = await this.getCached(identity.kinopoiskId);
            const cacheAge = Date.now() - Number(cached?.fetchedAt || 0);
            if (!options.forceRefresh && cached && cacheAge >= 0 && cacheAge < TheNumbersService.CACHE_TTL_MS) {
                return cached;
            }

            let sourceUrl = TheNumbersService.resolveSourceUrl(movie, options.mappings);
            let discoveredSnapshot = null;
            if (!sourceUrl) {
                const discovered = await this.discoverSource(movie, options.mappings);
                sourceUrl = discovered?.sourceUrl || null;
                discoveredSnapshot = discovered?.snapshot || null;
            }
            if (!sourceUrl) return cached ? { ...cached, status: 'stale' } : null;

            await this.trackMovie(identity, sourceUrl);
            try {
                const snapshot = discoveredSnapshot || await this.fetchSnapshot(sourceUrl);
                const fresh = {
                    ...snapshot,
                    sourceUrl,
                    fetchedAt: Date.now(),
                    nextRefreshAt: Date.now() + TheNumbersService.CACHE_TTL_MS,
                    status: 'fresh'
                };
                await this.setCached(identity.kinopoiskId, fresh);
                return fresh;
            } catch (error) {
                if (cached) return { ...cached, status: 'stale', error: error.message };
                throw error;
            }
        })().finally(() => this.inFlight.delete(movieKey));

        this.inFlight.set(movieKey, refreshPromise);
        return refreshPromise;
    }

    async refreshTrackedMovies() {
        if (!this.storage?.get) return [];
        const stored = await this.storage.get(TheNumbersService.TRACKED_KEY);
        const tracked = Object.values(stored?.[TheNumbersService.TRACKED_KEY] || {});
        const results = [];
        for (const entry of tracked) {
            try {
                const snapshot = await this.refreshMovie({
                    kinopoiskId: entry.kinopoiskId,
                    name: entry.title,
                    year: entry.year,
                    theNumbersUrl: entry.sourceUrl
                });
                results.push({ kinopoiskId: entry.kinopoiskId, status: snapshot?.status || 'skipped' });
            } catch (error) {
                results.push({ kinopoiskId: entry.kinopoiskId, status: 'failed', error: error.message });
            }
        }
        return results;
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = TheNumbersService;
if (typeof globalThis !== 'undefined') globalThis.TheNumbersService = TheNumbersService;
