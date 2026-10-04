/**
 * MovieDetailsPlayerSurface - the single owner of what MovieDetails renders
 * into #videoContainer.
 *
 * Parsers may still render their own players into the container through
 * renderPlayer(); everything MovieDetails itself mounts (frames, native
 * wrappers, placeholders, the poster fallback, resets) goes through here so
 * URL validation, escaping and reset semantics stay in one place. Overlays
 * that must survive resets live outside the container (see .player-stage).
 */
class MovieDetailsPlayerSurface {
    constructor({ getContainer } = {}) {
        if (typeof getContainer !== 'function') throw new TypeError('PlayerSurface needs getContainer()');
        this.getContainer = getContainer;
    }

    // Provider and embed URLs come from scraped pages or third-party APIs.
    // Only web/extension schemes may become frame or image sources.
    static getSafeWebUrl(url) {
        const value = String(url || '').trim();
        if (!value) return null;
        try {
            const base = typeof window !== 'undefined' ? window.location?.href : undefined;
            const parsed = new URL(value, base);
            return ['https:', 'http:', 'chrome-extension:'].includes(parsed.protocol) ? parsed.href : null;
        } catch {
            return null;
        }
    }

    static escapeAttribute(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    static renderFrameInto(container, url, { allow, title = 'Video player' } = {}) {
        const safeUrl = MovieDetailsPlayerSurface.getSafeWebUrl(url);
        if (!safeUrl || !container) return false;
        const escape = MovieDetailsPlayerSurface.escapeAttribute;
        const allowAttribute = allow ? ` allow="${escape(allow)}"` : '';
        container.innerHTML = `<iframe class="player-surface__media" src="${escape(safeUrl)}" allowfullscreen${allowAttribute} title="${escape(title)}"></iframe>`;
        return true;
    }

    get container() {
        return this.getContainer() || null;
    }

    clear() {
        const container = this.container;
        if (container) container.innerHTML = '';
    }

    showPlaceholder(message) {
        const container = this.container;
        if (!container) return;
        container.innerHTML = `<div class="video-placeholder"><span>${MovieDetailsPlayerSurface.escapeAttribute(message)}</span></div>`;
    }

    /** @returns {boolean} false when the URL is rejected; a placeholder is shown instead. */
    mountFrame(url, options = {}) {
        if (MovieDetailsPlayerSurface.renderFrameInto(this.container, url, options)) return true;
        this.showPlaceholder('Источник вернул некорректный адрес плеера');
        return false;
    }

    mountElement(element) {
        const container = this.container;
        if (!container || !element) return;
        container.innerHTML = '';
        container.appendChild(element);
    }

    /** @returns {Element|null} the play button of the poster fallback */
    showPoster(posterUrl) {
        const container = this.container;
        if (!container) return null;
        container.innerHTML = '<div class="player-surface__poster"><button class="player-surface__primary-action" id="mainPlayBtn" type="button" aria-label="Play"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></button></div>';
        const safeUrl = MovieDetailsPlayerSurface.getSafeWebUrl(posterUrl);
        const poster = container.querySelector?.('.player-surface__poster');
        if (poster && safeUrl) poster.style.backgroundImage = `url(${JSON.stringify(safeUrl)})`;
        return container.querySelector?.('#mainPlayBtn') || null;
    }

    getActiveFrame() {
        const container = this.container;
        return container?.querySelector?.('iframe[data-player-source-active="true"]')
            || container?.querySelector?.('iframe')
            || null;
    }
}

if (typeof window !== 'undefined') {
    window.MovieDetailsPlayerSurface = MovieDetailsPlayerSurface;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MovieDetailsPlayerSurface };
}
