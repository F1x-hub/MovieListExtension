/**
 * AwardsParsingService - reads awards and nominations from Kinopoisk's public pages.
 *
 * A film's page (/film/{id}/awards/) and a person's page (/name/{id}/awards/) share one
 * layout: a table per ceremony («Оскар, 2015 год»), a «Победитель» section and a
 * «Номинации» section, and one list item per category. A film's item names the people
 * it went to, a person's item names the film. Every ceremony Kinopoisk lists is kept:
 * the Oscar, Golden Globe, BAFTA, Cannes, Venice, Berlin, Emmy, SAG and the rest.
 */
class AwardsParsingService {
    /** Awards parsed before every ceremony was kept carry no `awardsSchema` on the movie. */
    static SCHEMA_VERSION = 2;
    static FETCH_TIMEOUT_MS = 15000;
    static PERSON_CACHE_PREFIX = 'kp_person_awards_v1_';
    static PERSON_CACHE_INDEX = 'kp_person_awards_v1_index';
    static PERSON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    static PERSON_CACHE_LIMIT = 50;

    constructor() {
        this.baseUrl = 'https://www.kinopoisk.ru';
        this.ceremonyWinnersCache = new Map();
    }

    /**
     * Awards of a film or series.
     * @param {number|string} movieId - Kinopoisk movie ID
     * @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
     * @returns {Promise<Array>} award objects (see parseAwardsPage)
     */
    async getAwards(movieId, options = {}) {
        const id = Number(movieId);
        if (!Number.isSafeInteger(id) || id <= 0) return [];
        const html = await this.fetchPage(`/film/${id}/awards/`, options);
        return html ? this.parseAwardsPage(html) : [];
    }

    /**
     * Awards and nominations of a person, each with the film it was for. Kept in
     * chrome.storage.local for a week; an answer without awards is kept as well, a
     * failed load is not.
     * @param {number|string} personId - Kinopoisk person ID
     * @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
     * @returns {Promise<Array|null>} null when the page could not be read
     */
    async getPersonAwards(personId, options = {}) {
        const id = Number(personId);
        if (!Number.isSafeInteger(id) || id <= 0) return null;

        const cached = await this.readPersonCache(id);
        if (cached) return cached;

        const html = await this.fetchPage(`/name/${id}/awards/`, options);
        if (!html || options.signal?.aborted) return null;
        // A page without the ceremony tables is not an awards page (a captcha, a
        // redirect): keeping an empty answer for it would hide the person's awards.
        if (!/class=["']?trivia/.test(html) && !/награды и кинопремии/i.test(html)) return null;
        const awards = this.parseAwardsPage(html);
        await this.writePersonCache(id, awards);
        return awards;
    }

    async fetchPage(path, { signal, timeoutMs } = {}) {
        if (signal?.aborted) return null;
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(
            () => controller.abort(new DOMException('Awards page deadline', 'TimeoutError')),
            timeoutMs ?? AwardsParsingService.FETCH_TIMEOUT_MS
        );
        try {
            const response = await fetch(`${this.baseUrl}${path}`, { signal: controller.signal });
            if (!response.ok) {
                console.warn(`[AwardsParser] ${path}: ${response.status}`);
                return null;
            }
            return await response.text();
        } catch (error) {
            if (!signal?.aborted) console.warn(`[AwardsParser] ${path} failed:`, error?.message || error);
            return null;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
        }
    }

    /**
     * Parse an awards page of a film or a person.
     * @param {string} html
     * @returns {Array<{name: string, slug: string|null, year: number|null, ceremonyPath: string|null,
     *   nominationName: string, nominationUrl: string|null, win: boolean,
     *   recipients: Array<{name: string, kinopoiskId: number|null}>,
     *   films: Array<{title: string, kinopoiskId: number}>}>}
     */
    parseAwardsPage(html) {
        if (typeof html !== 'string' || html.length === 0) return [];
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const awards = [];
        const seen = new Set();

        doc.querySelectorAll('table[cellspacing="0"]').forEach(table => {
            // A ceremony is a table without tables inside: the outer ones hold the page
            // layout and every other ceremony.
            if (table.querySelector('table')) return;
            const ceremony = this.readCeremony(table);
            if (!ceremony) return;

            let win = null;
            table.querySelectorAll('tr').forEach(row => {
                const items = row.querySelectorAll('li.trivia');
                if (items.length === 0) {
                    const label = row.textContent.replace(/\s+/g, ' ').trim();
                    if (/^Победител/i.test(label)) win = true;
                    else if (/^Номинац/i.test(label)) win = false;
                    return;
                }
                if (win === null) return;
                items.forEach(item => {
                    const award = this.readAwardItem(item, ceremony, win);
                    if (!award) return;
                    const key = [award.slug || award.name, award.year, award.nominationName, award.win,
                        award.films.map(film => film.kinopoiskId).join(',')].join('|');
                    if (seen.has(key)) return;
                    seen.add(key);
                    awards.push(award);
                });
            });
        });

        console.log(`[AwardsParser] ${awards.length} awards (${awards.filter(a => a.win).length} wins)`);
        return awards;
    }

    readCeremony(table) {
        const link = table.querySelector('td.news b a[href^="/awards/"]');
        if (!link) return null;
        const path = link.getAttribute('href') || '';
        const pathMatch = path.match(/^\/awards\/([a-z0-9_-]+)\/(\d{4})\/?$/i);
        const text = link.textContent.replace(/\s+/g, ' ').trim();
        const name = text.split(',')[0].trim();
        if (!name) return null;
        const yearMatch = text.match(/\b(\d{4})\b/);
        const year = yearMatch ? Number(yearMatch[1]) : (pathMatch ? Number(pathMatch[2]) : null);
        return {
            name,
            slug: pathMatch ? pathMatch[1].toLowerCase() : null,
            year,
            path: pathMatch ? path : null
        };
    }

    readAwardItem(item, ceremony, win) {
        const categoryLink = item.querySelector('a[href^="/awards/"]');
        const title = (categoryLink ? categoryLink.textContent : item.textContent.split('(')[0])
            .replace(/\s+/g, ' ')
            .trim();
        if (!title) return null;

        const href = categoryLink?.getAttribute('href') || '';
        // Kinopoisk sometimes repeats another ceremony's anchor (Georges rows that point at a
        // SAG category): such a link would look up the wrong category, so only the
        // ceremony's own anchors are kept.
        const nominationUrl = /^\/awards\/[^#]+#nom\d+$/.test(href) && ceremony.path && href.startsWith(ceremony.path)
            ? href
            : null;

        const recipients = [];
        item.querySelectorAll('a[href^="/name/"]').forEach(link => {
            const name = link.textContent.replace(/\s+/g, ' ').trim();
            const id = Number((link.getAttribute('href').match(/^\/name\/(\d+)/) || [])[1]);
            if (name && !recipients.some(person => person.name === name)) {
                recipients.push({ name, kinopoiskId: Number.isSafeInteger(id) && id > 0 ? id : null });
            }
        });

        const films = [];
        item.querySelectorAll('a[href^="/film/"], a[href^="/series/"]').forEach(link => {
            const id = Number((link.getAttribute('href').match(/^\/(?:film|series)\/(\d+)/) || [])[1]);
            const filmTitle = link.textContent.replace(/\s+/g, ' ').trim().replace(/^«(.*)»$/, '$1').trim();
            if (Number.isSafeInteger(id) && id > 0 && filmTitle && !films.some(film => film.kinopoiskId === id)) {
                films.push({ title: filmTitle, kinopoiskId: id });
            }
        });

        return {
            name: ceremony.name,
            slug: ceremony.slug,
            year: ceremony.year,
            ceremonyPath: ceremony.path,
            nominationName: title,
            nominationUrl,
            win,
            recipients,
            films
        };
    }

    async readPersonCache(id) {
        const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
        if (!storage) return null;
        const key = `${AwardsParsingService.PERSON_CACHE_PREFIX}${id}`;
        try {
            const entry = (await storage.get(key))[key];
            if (!entry || !Array.isArray(entry.awards)) return null;
            if (Date.now() - Number(entry.savedAt || 0) > AwardsParsingService.PERSON_CACHE_TTL_MS) return null;
            return entry.awards;
        } catch (error) {
            console.warn('[AwardsParser] Person awards cache read failed:', error?.message || error);
            return null;
        }
    }

    async writePersonCache(id, awards) {
        const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
        if (!storage) return;
        const prefix = AwardsParsingService.PERSON_CACHE_PREFIX;
        const indexKey = AwardsParsingService.PERSON_CACHE_INDEX;
        try {
            const index = (await storage.get(indexKey))[indexKey];
            const ids = (Array.isArray(index) ? index : []).filter(entry => entry !== id);
            ids.push(id);
            const evicted = ids.splice(0, Math.max(0, ids.length - AwardsParsingService.PERSON_CACHE_LIMIT));
            await storage.set({ [`${prefix}${id}`]: { savedAt: Date.now(), awards }, [indexKey]: ids });
            if (evicted.length) await storage.remove(evicted.map(entry => `${prefix}${entry}`));
        } catch (error) {
            console.warn('[AwardsParser] Person awards cache write failed:', error?.message || error);
        }
    }

    /**
     * Get a ceremony category (winner and nominees) from its nomination link
     * @param {string} nominationUrl - e.g. "/awards/oscar/2018/#nom1850"
     * @returns {Promise<{winner: Object|null, nominees: Array}|null>} - Entries are
     *   { label, person, filmIds }, e.g. { label: "Гари Олдман — Темные времена", person: "Гари Олдман", filmIds: ["972777"] }
     */
    async getCategoryInfo(nominationUrl) {
        const match = String(nominationUrl || '').match(/^(\/awards\/[^#]+)#(nom\d+)$/);
        if (!match) return null;
        const [, ceremonyPath, nominationId] = match;

        let winnersPromise = this.ceremonyWinnersCache.get(ceremonyPath);
        if (!winnersPromise) {
            winnersPromise = this.fetchPage(ceremonyPath)
                .then(html => (html ? this.parseCeremonyWinners(html) : {}));
            this.ceremonyWinnersCache.set(ceremonyPath, winnersPromise);
        }

        const categories = await winnersPromise;
        return categories[nominationId] || null;
    }

    /**
     * Parse a ceremony page into a map of nomination anchor -> category info
     * @param {string} html - Ceremony page HTML (e.g. /awards/oscar/2018/)
     * @returns {Object<string, {winner: Object|null, nominees: Array}>}
     */
    parseCeremonyWinners(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const categories = {};

        const toEntry = (element) => {
            if (!element) return null;
            const label = element.textContent.replace(/\s+/g, ' ').trim();
            if (!label) return null;
            const person = element.querySelector('a[href^="/name/"]')?.textContent.trim() || null;
            const filmIds = Array.from(element.querySelectorAll('a[href^="/film/"]'))
                .map(link => (link.getAttribute('href').match(/^\/film\/(\d+)/) || [])[1])
                .filter(Boolean);
            return { label, person, filmIds };
        };

        doc.querySelectorAll('a[name^="nom"]').forEach(anchor => {
            const headerRow = anchor.closest('tr');
            const winnerRow = headerRow?.nextElementSibling;
            const winner = toEntry(winnerRow?.querySelector('td.awardCol2 b'));
            const nomineesRow = winnerRow?.nextElementSibling;
            // Only rows of this category: stop if the next row is already another category header.
            const nominees = nomineesRow && !nomineesRow.querySelector('a[name^="nom"]')
                ? Array.from(nomineesRow.querySelectorAll('li.trivia')).map(item => {
                    const clone = item.cloneNode(true);
                    clone.querySelectorAll('span, br').forEach(node => node.remove());
                    return toEntry(clone);
                }).filter(Boolean)
                : [];
            if (winner || nominees.length) categories[anchor.getAttribute('name')] = { winner, nominees };
        });

        return categories;
    }
}

// Export as global
if (typeof window !== 'undefined') {
    window.AwardsParsingService = AwardsParsingService;
}
