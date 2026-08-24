(function exposeErrorPresentation(root) {
    const DEFINITIONS = {
        KINOPOISK_DAILY_LIMIT: {
            title: 'errors.kinopoisk.daily_limit.title',
            message: 'errors.kinopoisk.daily_limit.message',
            primary: 'retry'
        },
        KINOPOISK_UNAVAILABLE: {
            title: 'errors.kinopoisk.unavailable.title',
            message: 'errors.kinopoisk.unavailable.message',
            primary: 'retry'
        },
        KINOPOISK_AUTH: {
            title: 'errors.kinopoisk.auth.title',
            message: 'errors.kinopoisk.auth.message',
            primary: 'close'
        },
        KINOPOISK_ACCESS_DENIED: {
            title: 'errors.kinopoisk.access.title',
            message: 'errors.kinopoisk.access.message',
            primary: 'close'
        },
        KINOPOISK_RATE_LIMITED: {
            title: 'errors.kinopoisk.rate_limit.title',
            message: 'errors.kinopoisk.rate_limit.message',
            primary: 'retry'
        },
        KINOPOISK_SERVER: {
            title: 'errors.kinopoisk.server.title',
            message: 'errors.kinopoisk.server.message',
            primary: 'retry'
        },
        KINOPOISK_NETWORK: {
            title: 'errors.kinopoisk.network.title',
            message: 'errors.kinopoisk.network.message',
            primary: 'retry'
        },
        TMDB_UNAVAILABLE: {
            title: 'errors.tmdb.unavailable.title',
            message: 'errors.tmdb.unavailable.message',
            primary: 'retry'
        },
        AUTH_REQUIRED: {
            title: 'errors.auth.required.title',
            message: 'errors.auth.required.message',
            primary: 'close'
        },
        MOVIE_NOT_FOUND: {
            title: 'errors.movie.not_found.title',
            message: 'errors.movie.not_found.message',
            primary: 'back'
        },
        INVALID_PERSON_KEY: {
            title: 'errors.person.invalid.title',
            message: 'errors.person.invalid.message',
            primary: 'back'
        },
        PERSON_NOT_FOUND: {
            title: 'errors.person.not_found.title',
            message: 'errors.person.not_found.message',
            primary: 'back'
        },
        PERSON_PROVIDER_ERROR: {
            title: 'errors.person.provider.title',
            message: 'errors.person.provider.message',
            primary: 'retry'
        },
        PLAYBACK_UNAVAILABLE: {
            title: 'errors.playback.unavailable.title',
            message: 'errors.playback.unavailable.message',
            primary: 'close'
        },
        USER_MESSAGE: {
            title: 'errors.generic.title',
            message: 'errors.generic.message',
            primary: 'close'
        },
        GENERIC_LOAD_ERROR: {
            title: 'errors.generic.title',
            message: 'errors.generic.message',
            primary: 'retry'
        },
        UNKNOWN_ERROR: {
            title: 'errors.generic.title',
            message: 'errors.generic.message',
            primary: 'close'
        }
    };

    function interpolate(value, params = {}) {
        return String(value || '').replace(/\{([\w.]+)\}/g, (match, key) => {
            const replacement = key.split('.').reduce((current, part) => current?.[part], params);
            return replacement == null ? match : String(replacement);
        });
    }

    function formatRemaining(ms, locale) {
        if (!Number.isFinite(ms) || ms <= 0) return '';
        const minutes = Math.max(1, Math.ceil(ms / 60000));
        if (locale === 'ru') {
            if (minutes >= 60) return `${Math.ceil(minutes / 60)} ч.`;
            return `${minutes} мин.`;
        }
        if (minutes >= 60) return `${Math.ceil(minutes / 60)} hour${Math.ceil(minutes / 60) === 1 ? '' : 's'}`;
        return `${minutes} minute${minutes === 1 ? '' : 's'}`;
    }

    function getTranslation(key, fallback) {
        const translated = root.i18n?.get?.(key);
        return translated && translated !== key ? translated : fallback;
    }

    function getPresentation(error, options = {}) {
        const normalized = root.errorNormalizer?.normalize?.(error, options.context || {}) || error;
        const definition = DEFINITIONS[normalized?.code] || DEFINITIONS.UNKNOWN_ERROR;
        const locale = root.i18n?.currentLocale || 'en';
        const params = {
            ...(normalized?.params || {}),
            time: formatRemaining(normalized?.params?.remainingMs, locale)
        };
        const messageFallback = normalized?.userMessage || getTranslation('errors.generic.message', 'Something went wrong.');
        const primary = options.onBack && definition.primary === 'back'
            ? 'back'
            : definition.primary === 'retry' && (
                normalized?.retryable !== false || normalized?.code === 'KINOPOISK_DAILY_LIMIT'
            )
                ? 'retry'
                : 'close';

        return {
            error: normalized,
            title: interpolate(getTranslation(definition.title, 'Something went wrong'), params),
            message: normalized?.code === 'USER_MESSAGE'
                ? messageFallback
                : interpolate(getTranslation(definition.message, messageFallback), params),
            primary,
            primaryLabel: getTranslation(`errors.actions.${primary}`, primary === 'retry' ? 'Try again' : primary === 'back' ? 'Go back' : 'Close'),
            closeLabel: getTranslation('errors.actions.close', 'Close'),
            detailsLabel: getTranslation('errors.details', 'Technical details'),
            technicalDetails: normalized?.cause?.message || normalized?.message || normalized?.code || 'UNKNOWN_ERROR'
        };
    }

    root.ErrorPresentation = { getPresentation, interpolate, formatRemaining };
})(typeof globalThis !== 'undefined' ? globalThis : window);
