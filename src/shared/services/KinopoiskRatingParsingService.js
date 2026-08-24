/**
 * KinopoiskRatingParsingService parses the public Kinopoisk movie page.
 */
class KinopoiskRatingParsingService {
    constructor() {
        this.baseUrl = 'https://www.kinopoisk.ru';
    }

    /**
     * Get the Kinopoisk rating and vote count for a movie.
     * @param {number|string} kinopoiskId - Kinopoisk movie ID
     * @returns {Promise<{rating: number, votes: number}>}
     */
    async getKinopoiskRating(kinopoiskId) {
        if (!kinopoiskId) {
            throw new Error('Kinopoisk ID is required to parse ratings');
        }

        const url = `${this.baseUrl}/film/${kinopoiskId}/`;
        const response = await fetch(url, {
            headers: {
                Accept: 'text/html'
            }
        });

        if (!response.ok) {
            throw new Error(`Kinopoisk rating page returned HTTP ${response.status}`);
        }

        return this.parseRatingPage(await response.text());
    }

    /**
     * Parse the Kinopoisk rating and vote count from movie-page HTML.
     * @param {string} html
     * @returns {{rating: number, votes: number}}
     */
    parseRatingPage(html) {
        const documentNode = new DOMParser().parseFromString(html, 'text/html');
        const ratingElement = documentNode.querySelector(
            '[data-tid="kp-movie-rating.rating-value"] span[aria-hidden="true"]'
        );
        const ratingNode = ratingElement.closest('[data-tid="kp-movie-rating.rating-value"]');
        const ratingContainer = ratingNode?.parentElement?.parentElement?.parentElement;
        const votesButton = documentNode.querySelector('button[aria-label*="оценк"]')
            || ratingContainer?.querySelector('button[aria-label], button')
            || Array.from(documentNode.querySelectorAll('button, [aria-label]')).find(element => {
                const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`;
                return /\d[\d\s\u00A0]*оцен/i.test(label);
            });

        if (!ratingElement) {
            throw new Error('Kinopoisk rating selector was not found in the page HTML');
        }
        if (!votesButton) {
            throw new Error('Kinopoisk votes selector was not found in the page HTML');
        }

        const rating = Number.parseFloat(ratingElement.textContent.trim().replace(',', '.'));
        const votesLabel = votesButton.getAttribute('aria-label') || votesButton.textContent || '';
        const votesMatch = votesLabel.match(/[\d\s\u00A0]+(?=\s*оцен)/i);
        const votesDigits = (votesMatch?.[0] || votesLabel).replace(/\D/g, '');
        const votes = Number.parseInt(votesDigits, 10);

        if (!Number.isFinite(rating)) {
            throw new Error('Kinopoisk rating value could not be parsed');
        }
        if (!Number.isInteger(votes) || votes <= 0) {
            throw new Error('Kinopoisk vote count could not be parsed');
        }

        const imdbIdMatch = String(html || '').match(/(?:imdb\.com\/title\/|imdbId["':\s]+)(tt\d{7,10})/i);
        return {
            rating,
            votes,
            imdbId: imdbIdMatch?.[1] || null
        };
    }
}

if (typeof window !== 'undefined') {
    window.KinopoiskRatingParsingService = KinopoiskRatingParsingService;
}
