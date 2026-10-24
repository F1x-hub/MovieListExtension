/**
 * HomeSeasonalBanner
 *
 * Presents the active season on Home. SeasonalThemeService decides whether a
 * season is active and enabled; this module only owns the banner copy and its
 * per-season dismissal.
 */
(function (global) {
    'use strict';

    const DISMISS_KEY = 'movieExtensionSeasonBannerDismissed';

    class HomeSeasonalBanner {
        constructor(root = document.getElementById('season-banner')) {
            this.root = root;
            this.title = root?.querySelector('.season-banner__title') || null;
            this.message = root?.querySelector('.season-banner__message') || null;
            this.cta = root?.querySelector('.season-banner__cta') || null;
            this.closeButton = root?.querySelector('.season-banner__close') || null;
            this.season = null;

            this.closeButton?.addEventListener('click', () => this.dismiss());
            this.unsubscribe = global.SeasonalThemeService?.subscribe?.(() => this.render()) || null;
        }

        static getDismissToken(season) {
            return season ? `${season.id}-${season.year}` : '';
        }

        isDismissed(season) {
            try {
                return global.localStorage?.getItem(DISMISS_KEY) === HomeSeasonalBanner.getDismissToken(season);
            } catch {
                return false;
            }
        }

        dismiss() {
            if (!this.season) return;
            try {
                global.localStorage?.setItem(DISMISS_KEY, HomeSeasonalBanner.getDismissToken(this.season));
            } catch {
                // Hiding still applies for this page view.
            }
            this.hide();
        }

        hide() {
            if (this.root) this.root.hidden = true;
        }

        translate(key) {
            const fullKey = `home.season.${this.season.id}.${key}`;
            const value = global.i18n?.get?.(fullKey);
            return typeof value === 'string' && value !== fullKey ? value : '';
        }

        getMessage(date) {
            const service = global.SeasonalThemeService;
            const days = service.getDaysUntilPeak(this.season, date);
            if (days === 0) return this.translate('today');
            if (days < 0) return this.translate('after');

            const locale = global.i18n?.currentLocale || 'en';
            let form;
            try {
                form = new Intl.PluralRules(locale).select(days);
            } catch {
                form = 'other';
            }
            const template = this.translate(`before.${form}`) || this.translate('before.other');
            return template.replace('{count}', String(days));
        }

        render(date = new Date()) {
            const service = global.SeasonalThemeService;
            if (!this.root || !service) return;

            const season = service.getActiveDecor(date);
            this.season = season;
            if (!season || this.isDismissed(season)) {
                this.hide();
                return;
            }

            if (this.title) this.title.textContent = this.translate('title');
            if (this.message) this.message.textContent = this.getMessage(date);
            if (this.cta) {
                const label = this.translate('cta');
                this.cta.textContent = label;
                this.cta.hidden = !label || !season.ctaHref;
                if (season.ctaHref) this.cta.setAttribute('href', season.ctaHref);
                else this.cta.removeAttribute('href');
            }
            if (this.closeButton) {
                const label = this.translate('dismiss');
                this.closeButton.setAttribute('aria-label', label);
                this.closeButton.title = label;
            }
            this.root.dataset.season = season.id;
            this.root.hidden = false;
        }
    }

    global.HomeSeasonalBanner = HomeSeasonalBanner;
})(typeof window !== 'undefined' ? window : globalThis);
