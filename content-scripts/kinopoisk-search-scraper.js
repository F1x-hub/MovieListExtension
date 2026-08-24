/**
 * Content Script: Kinopoisk Search Scraper
 * Injected into kinopoisk.ru/new-search* inside the hidden offscreen iframe.
 * Observes DOM for search results or SSO / Captcha challenge and reports back via chrome.runtime.
 */

(function () {
    /**
     * Parse items from search result DOM sections
     * @param {Document|Element} root
     * @returns {Array<{ type: string, id: number }>}
     */
    function extractSearchItemsFromDOM(root = document) {
        const allowedSections = root.querySelectorAll(
            '[data-testid="search-top-result"], [data-testid="search-films"], [data-test-id="search-top-result"], [data-test-id="search-films"]'
        );

        if (!allowedSections || allowedSections.length === 0) {
            return [];
        }

        const items = [];
        const seenIds = new Set();

        allowedSections.forEach(section => {
            const nextLinks = section.querySelectorAll('a[data-test-id="next-link"], a[data-testid="next-link"]');
            nextLinks.forEach(anchor => {
                const href = anchor.getAttribute('href') || '';
                const match = href.match(/\/(film|series)\/(\d+)\//);
                if (match) {
                    const type = match[1].toLowerCase();
                    const id = parseInt(match[2], 10);
                    if (id && !seenIds.has(id)) {
                        seenIds.add(id);
                        const resultRoot = anchor.closest?.('[data-test-id="movie-list-item"], [data-testid="movie-list-item"]') || anchor;
                        const titleElement = anchor.querySelector('[class*="mainTitle"]');
                        const originalElement = anchor.querySelector('[class*="secondaryTitle"]');
                        const resultText = resultRoot.textContent || anchor.textContent || '';
                        const yearMatch = resultText.match(/\b((?:18|19|20)\d{2})\b/);
                        const title = titleElement?.textContent?.trim() || '';
                        const originalTitle = originalElement?.textContent?.replace(/^\s*,\s*/, '').trim() || '';
                        const ratingElement = resultRoot.querySelector(
                            '[class*="kinopoiskValuePositive"], [class*="kinopoiskValueNeutral"], [class*="kinopoiskValueNegative"]'
                        );
                        const votesElement = resultRoot.querySelector('[class*="kinopoiskCount"]');
                        const kpRating = parseSearchNumber(ratingElement?.textContent || '');
                        const kpVotes = parseSearchInteger(votesElement?.textContent || '');

                        items.push({
                            type,
                            id,
                            ...(title ? { title } : {}),
                            ...(originalTitle ? { originalTitle } : {}),
                            ...(yearMatch ? { year: Number(yearMatch[1]) } : {}),
                            ...(kpRating > 0 ? { kpRating } : {}),
                            ...(kpVotes > 0 ? { kpVotes } : {})
                        });
                    }
                }
            });
        });

        return items;
    }

    function getRatingHydrationState(root = document) {
        const allowedSections = root.querySelectorAll(
            '[data-testid="search-top-result"], [data-testid="search-films"], [data-test-id="search-top-result"], [data-test-id="search-films"]'
        );
        const resultRoots = [];
        const seenIds = new Set();

        allowedSections.forEach(section => {
            const nextLinks = section.querySelectorAll('a[data-test-id="next-link"], a[data-testid="next-link"]');
            nextLinks.forEach(anchor => {
                const match = (anchor.getAttribute('href') || '').match(/\/(film|series)\/(\d+)\//);
                if (!match) return;

                const id = parseInt(match[2], 10);
                if (!id || seenIds.has(id)) return;
                seenIds.add(id);

                const resultRoot = anchor.closest?.('[data-test-id="movie-list-item"], [data-testid="movie-list-item"]') || anchor;
                resultRoots.push(resultRoot);
            });
        });

        const ready = resultRoots.filter(resultRoot => {
            const hasNumericRating = resultRoot.querySelector(
                '[class*="kinopoiskValuePositive"], [class*="kinopoiskValueNeutral"], [class*="kinopoiskValueNegative"]'
            );
            const hasExplicitEmptyRating = /(?:^|\s)—(?:\s|$)/.test(resultRoot.textContent || '');
            return Boolean(hasNumericRating || hasExplicitEmptyRating);
        }).length;

        return {
            total: resultRoots.length,
            ready,
            pending: Math.max(0, resultRoots.length - ready)
        };
    }

    function parseSearchNumber(value) {
        const match = String(value || '').match(/\d+(?:[.,]\d+)?/);
        return match ? Number.parseFloat(match[0].replace(',', '.')) : 0;
    }

    function parseSearchInteger(value) {
        const digits = String(value || '').replace(/\D/g, '');
        return digits ? Number.parseInt(digits, 10) : 0;
    }

    function parseRating(value) {
        const match = String(value || '').match(/\d+(?:[.,]\d+)?/);
        return match ? Number.parseFloat(match[0].replace(',', '.')) : 0;
    }

    function parseVoteCount(value) {
        const text = String(value || '').replace(/\u00A0/g, ' ').trim();
        const labelledMatch = text.match(/(\d[\d\s.,]*)(?:\s*([kкmм]))?\s*(?:votes?|ratings?|оцен)/i);
        const match = labelledMatch || text.match(/(\d[\d\s.,]*)(?:\s*([kкmм]))?/i);
        if (!match) return 0;

        const number = Number.parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
        if (!Number.isFinite(number)) return 0;

        const suffix = String(match[2] || '').toLowerCase();
        if (suffix === 'k' || suffix === 'к') return Math.round(number * 1_000);
        if (suffix === 'm' || suffix === 'м') return Math.round(number * 1_000_000);
        return Math.round(number);
    }

    function findProviderVoteCount(root, provider, rating) {
        const selectors = provider === 'kp'
            ? [
                '[data-tid="kp-movie-rating"] [class*="count"]',
                '[class*="kinopoiskCount"]',
                '[data-tid*="kp-movie-rating"] [class*="count"]',
                '[data-testid*="kp-movie-rating"] [class*="count"]'
            ]
            : [
                '[class*="film-sub-rating"] [class*="count"]',
                '[data-tid*="imdb"] [class*="count"]',
                '[data-testid*="imdb"] [class*="count"]',
                '[class*="imdb"] [class*="count"]'
            ];

        for (const selector of selectors) {
            const element = root.querySelector?.(selector);
            const votes = parseVoteCount(element?.textContent || '');
            if (votes > 0) return votes;
        }

        const ratingNode = provider === 'kp'
            ? root.querySelector?.('[data-tid="kp-movie-rating.rating-value"]')
            : root.querySelector?.('[class*="film-sub-rating"]');
        const ratingContainer = provider === 'kp'
            ? ratingNode?.closest?.('.film-rating')
            : ratingNode;
        const contextualCount = ratingContainer?.querySelector?.('[class*="count"]');
        const contextualVotes = parseVoteCount(
            contextualCount?.getAttribute?.('aria-label') || contextualCount?.textContent || ''
        );
        if (contextualVotes > 0) return contextualVotes;

        const containerSelectors = provider === 'kp'
            ? ['[data-tid="kp-movie-rating"]', '[data-tid*="kp-movie-rating"]', '[data-testid*="kp-movie-rating"]']
            : ['[class*="film-sub-rating"]', '[data-tid*="imdb"]', '[data-testid*="imdb"]', '[class*="imdb"]'];
        for (const selector of containerSelectors) {
            const container = root.querySelector?.(selector);
            if (!container) continue;
            const elements = [container, ...Array.from(container.querySelectorAll?.('*') || [])];
            for (const element of elements) {
                const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
                if (!/(?:votes?|ratings?|оцен)/i.test(text)) continue;
                const votes = parseVoteCount(text);
                if (votes > 0 && Math.abs(votes - Number(rating || 0)) > 1) return votes;
            }
        }

        return 0;
    }

    function extractMoviePageRatingsFromDOM(root = document) {
        const textOf = (element) => String(element?.textContent || '').replace(/\s+/g, ' ').trim();
        const ratingFromSelectors = (selectors) => {
            for (const selector of selectors) {
                const element = root.querySelector?.(selector);
                const value = parseRating(element?.getAttribute?.('aria-label') || textOf(element));
                if (value > 0 && value <= 10) return value;
            }
            return 0;
        };

        const kpRating = ratingFromSelectors([
            '[data-tid="kp-movie-rating.rating-value"] span[aria-hidden="true"]',
            '[data-tid*="kp-movie-rating"] [aria-hidden="true"]',
            '[data-testid*="kp-movie-rating"] [aria-hidden="true"]',
            '[class*="kinopoiskValuePositive"]',
            '[class*="kinopoiskValueNeutral"]',
            '[class*="kinopoiskValueNegative"]'
        ]);

        let imdbRating = ratingFromSelectors([
            '[data-tid*="imdb"] [aria-hidden="true"]',
            '[data-tid*="imdb"] [data-testid*="rating"]',
            '[data-testid*="imdb"] [aria-hidden="true"]',
            '[data-testid*="imdb"] [data-testid*="rating"]',
            '[class*="imdb"] [aria-hidden="true"]',
            '[class*="imdb"] [class*="rating"]'
        ]);

        if (imdbRating <= 0) {
            const ratingNodes = root.querySelectorAll?.(
                '[data-tid*="rating"], [data-testid*="rating"], [class*="rating"]'
            ) || [];
            for (const node of ratingNodes) {
                const text = textOf(node);
                if (!/\bIMDb\b/i.test(text)) continue;
                const match = text.match(/\bIMDb\b[^0-9]{0,40}([0-9]+(?:[.,][0-9]+)?)/i);
                const value = parseRating(match?.[1] || '');
                if (value > 0 && value <= 10) {
                    imdbRating = value;
                    break;
                }
            }
        }

        if (imdbRating <= 0) {
            const scripts = root.querySelectorAll?.('script') || [];
            for (const script of scripts) {
                const source = script.textContent || '';
                const match = source.match(/(?:IMDb|imdb)[^\d]{0,80}(?:rating|value)?[^\d]{0,20}([0-9]+(?:[.,][0-9]+)?)/i);
                const value = parseRating(match?.[1] || '');
                if (value > 0 && value <= 10) {
                    imdbRating = value;
                    break;
                }
            }
        }

        const imdbLink = root.querySelector?.('a[href*="imdb.com/title/tt"]')?.getAttribute?.('href') || '';
        const imdbId = imdbLink.match(/imdb\.com\/title\/(tt\d{7,10})/i)?.[1] || null;
        const kpVotes = findProviderVoteCount(root, 'kp', kpRating);
        const imdbVotes = findProviderVoteCount(root, 'imdb', imdbRating);

        return {
            kpRating,
            imdbRating,
            imdbId,
            kpVotes,
            imdbVotes
        };
    }

    /**
     * Check if current page is an SSO redirect or CAPTCHA challenge
     * @param {Document} doc
     * @returns {boolean}
     */
    function isChallengeOrCaptchaPage(doc = document) {
        const url = (typeof window !== 'undefined' && window.location?.href) ? window.location.href : '';
        if (/sso\.(?:kinopoisk|passport\.yandex)\.ru|showcaptcha|smartcaptcha/i.test(url)) {
            return true;
        }

        const ssoForm = doc.querySelector('form[action*="sso.kinopoisk.ru"], form[action*="sso.passport.yandex.ru"]');
        if (ssoForm) return true;

        const captchaElem = doc.querySelector('#smartcaptcha, .smart-captcha, [data-testid*="captcha"], .CheckboxCaptcha');
        if (captchaElem) return true;

        const scripts = doc.querySelectorAll('script');
        for (let i = 0; i < scripts.length; i++) {
            const text = scripts[i].textContent || '';
            if (text.includes('sso.kinopoisk.ru/install') || text.includes('_emitProbe')) {
                return true;
            }
        }

        return false;
    }

    // Export helpers for test suites if running in node/module environment
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            extractSearchItemsFromDOM,
            getRatingHydrationState,
            isChallengeOrCaptchaPage,
            parseSearchNumber,
            parseSearchInteger,
            extractMoviePageRatingsFromDOM
        };
        return;
    }

    // Only run active observer in browser extension context
    if (typeof window === 'undefined' || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        return;
    }

    let isCompleted = false;
    let firstItemsAt = 0;
    let ratingWaitTimer = null;
    let observer = null;
    let intervalId = null;
    let timeoutId = null;
    const RATING_HYDRATION_TIMEOUT_MS = 1400;
    const DETAIL_RATING_TIMEOUT_MS = 2200;

    function getRequestMetadata() {
        let query = '';
        let requestId = '';
        try {
            if (typeof window !== 'undefined' && window.location?.href) {
                const urlObj = new URL(window.location.href);
                query = urlObj.searchParams.get('text') || '';
                if (urlObj.hash && urlObj.hash.startsWith('#agy_req_')) {
                    requestId = urlObj.hash.replace('#agy_req_', '').split('&')[0];
                }
                return {
                    query,
                    requestId,
                    requireRating: urlObj.hash.includes('agy_rating_1'),
                    isMoviePage: /\/(?:film|series)\/\d+\//i.test(urlObj.pathname)
                };
            }
        } catch {
            // Ignore URL parse error
        }
        return { query, requestId, requireRating: false, isMoviePage: false };
    }

    function sendResult(type, payload = {}) {
        if (isCompleted) return;
        isCompleted = true;

        if (observer) observer.disconnect();
        if (intervalId) clearInterval(intervalId);
        if (timeoutId) clearTimeout(timeoutId);
        if (ratingWaitTimer) clearTimeout(ratingWaitTimer);

        const meta = getRequestMetadata();

        chrome.runtime.sendMessage({
            target: 'kinopoisk-search-coordinator',
            type: type,
            url: window.location.href,
            query: meta.query,
            requestId: meta.requestId,
            ...payload
        }).catch(() => {
            // Background listener might have already handled or timed out
        });
    }

    function checkPage() {
        if (isCompleted) return;

        const meta = getRequestMetadata();

        // Check for challenge first
        if (isChallengeOrCaptchaPage(document)) {
            sendResult('SCRAPE_RESULT_BLOCKED', { reason: 'SCRAPE_BLOCKED_EVEN_WITH_SESSION' });
            return;
        }

        if (meta.isMoviePage) {
            const ratings = extractMoviePageRatingsFromDOM(document);
            if (ratings.kpRating > 0 && ratings.imdbRating > 0
                && ratings.kpVotes > 0 && ratings.imdbVotes > 0) {
                console.info('[KPScraperTrace] movie-page-ratings-ready', ratings);
                sendResult('SCRAPE_MOVIE_RATINGS_SUCCESS', { ratings });
                return;
            }
            if (!firstItemsAt) firstItemsAt = Date.now();
            if (Date.now() - firstItemsAt < DETAIL_RATING_TIMEOUT_MS) return;
            console.info('[KPScraperTrace] movie-page-ratings-empty', ratings);
            sendResult('SCRAPE_MOVIE_RATINGS_SUCCESS', { ratings });
            return;
        }

        const items = extractSearchItemsFromDOM(document);
        if (items.length > 0) {
            if (!firstItemsAt) firstItemsAt = Date.now();

            const hydration = getRatingHydrationState(document);
            if (meta.requireRating && hydration.pending > 0
                && Date.now() - firstItemsAt < RATING_HYDRATION_TIMEOUT_MS) {
                if (!ratingWaitTimer) {
                    ratingWaitTimer = setTimeout(() => {
                        ratingWaitTimer = null;
                        checkPage();
                    }, 150);
                }
                return;
            }

            console.info('[KPScraperTrace] result-ready', {
                itemCount: items.length,
                requireRating: meta.requireRating,
                ratingHydration: hydration,
                waitedMs: Date.now() - firstItemsAt
            });
            sendResult('SCRAPE_RESULT_SUCCESS', { items });
            return;
        }

        // Check if explicit empty state is rendered
        const emptyState = document.querySelector('[data-testid="empty-search-results"], .empty-search, .styles_empty__');
        if (emptyState) {
            sendResult('SCRAPE_RESULT_SUCCESS', { items: [] });
        }
    }

    // Initial check
    checkPage();

    // Observe DOM mutations
    observer = new MutationObserver(() => {
        checkPage();
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
            }
            checkPage();
        });
    }

    // Periodic polling fallback (every 350ms)
    intervalId = setInterval(checkPage, 350);

    // Timeout (7500ms)
    timeoutId = setTimeout(() => {
        if (!isCompleted) {
            // One final check before timing out
            if (isChallengeOrCaptchaPage(document)) {
                sendResult('SCRAPE_RESULT_BLOCKED', { reason: 'SCRAPE_BLOCKED_EVEN_WITH_SESSION' });
            } else if (getRequestMetadata().isMoviePage) {
                const ratings = extractMoviePageRatingsFromDOM(document);
                console.info('[KPScraperTrace] movie-page-ratings-timeout', ratings);
                sendResult('SCRAPE_MOVIE_RATINGS_SUCCESS', { ratings });
            } else {
                const finalItems = extractSearchItemsFromDOM(document);
                if (finalItems.length > 0) {
                    sendResult('SCRAPE_RESULT_SUCCESS', { items: finalItems });
                } else {
                    sendResult('SCRAPE_RESULT_TIMEOUT', { reason: 'TIMEOUT_WAITING_FOR_DOM' });
                }
            }
        }
    }, 7500);

})();
