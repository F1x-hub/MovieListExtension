(function exposeProviderErrorModules(root) {
    const AppError = root.AppError;

    function errorText(error) {
        return [
            error?.code,
            error?.name,
            error?.message,
            error?.cause?.code,
            error?.cause?.name,
            error?.cause?.message
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
    }

    function statusOf(error) {
        const directStatus = Number(error?.status);
        if (Number.isFinite(directStatus) && directStatus > 0) return directStatus;
        const causeStatus = Number(error?.cause?.status);
        if (Number.isFinite(causeStatus) && causeStatus > 0) return causeStatus;
        const match = errorText(error).match(/(?:status|http|error)[^0-9]*([0-9]{3})/);
        return match ? Number(match[1]) : null;
    }

    function hasExplicitQuotaSignal(error) {
        const text = errorText(error);
        return error?.code === 'DAILY_LIMIT_REACHED' ||
            error?.code === 'KINOPOISK_DAILY_LIMIT' ||
            error?.name === 'QuotaExhaustedError' ||
            text.includes('daily_limit_reached') ||
            text.includes('daily quota') ||
            text.includes('quota exhausted') ||
            text.includes('quota limit') ||
            text.includes('суточн') ||
            text.includes('лимит');
    }

    const kinopoiskModule = {
        id: 'kinopoisk',
        priority: 100,
        matches(error, context = {}) {
            const text = errorText(error);
            const status = statusOf(error);
            const isNetwork = error?.code === 'KINOPOISK_NETWORK' ||
                error?.name === 'KinopoiskNetworkError' ||
                /network|failed to fetch|fetch failed|timeout|timed out/.test(text);
            const isKinopoisk = !text.includes('tmdb') &&
                (text.includes('kinopoisk') || context.category === 'provider');
            return hasExplicitQuotaSignal(error) || isKinopoisk && (
                [401, 402, 403, 429].includes(status) ||
                status >= 500 ||
                isNetwork
            );
        },
        normalize(error, context = {}) {
            const quotaStatus = root.kinopoiskQuota?.getQuotaStatus?.() || {};
            const status = statusOf(error);
            const isQuota = hasExplicitQuotaSignal(error);

            if (isQuota) {
                return new AppError('KINOPOISK_DAILY_LIMIT', {
                    category: 'provider',
                    retryable: false,
                    params: {
                        remainingMs: quotaStatus.remainingMs || null,
                        retryAt: quotaStatus.until || null
                    },
                    context,
                    cause: error
                });
            }

            if (status === 401 || error?.code === 'KINOPOISK_AUTH') {
                return new AppError('KINOPOISK_AUTH', {
                    category: 'provider-auth',
                    retryable: false,
                    context,
                    cause: error
                });
            }

            if (status === 402 || status === 403 || error?.code === 'KINOPOISK_ACCESS_DENIED') {
                return new AppError('KINOPOISK_ACCESS_DENIED', {
                    category: 'provider-auth',
                    retryable: false,
                    context,
                    cause: error
                });
            }

            if (status === 429 || error?.code === 'KINOPOISK_RATE_LIMITED') {
                return new AppError('KINOPOISK_RATE_LIMITED', {
                    category: 'provider-rate-limit',
                    retryable: true,
                    params: { retryAfterMs: error?.retryAfterMs || null },
                    context,
                    cause: error
                });
            }

            if (status >= 500 || error?.code === 'KINOPOISK_SERVER') {
                return new AppError('KINOPOISK_SERVER', {
                    category: 'provider-server',
                    retryable: true,
                    context,
                    cause: error
                });
            }

            if (error?.code === 'KINOPOISK_NETWORK' || error?.name === 'KinopoiskNetworkError') {
                return new AppError('KINOPOISK_NETWORK', {
                    category: 'provider-network',
                    retryable: true,
                    context,
                    cause: error
                });
            }

            return new AppError('KINOPOISK_UNAVAILABLE', {
                category: 'provider',
                retryable: true,
                context,
                cause: error
            });
        }
    };

    const tmdbModule = {
        id: 'tmdb',
        priority: 80,
        matches(error) {
            const text = errorText(error);
            return text.includes('tmdb') && (
                text.includes('failed') ||
                text.includes('http') ||
                text.includes('network') ||
                text.includes('unavailable')
            );
        },
        normalize(error, context = {}) {
            return new AppError('TMDB_UNAVAILABLE', {
                category: 'provider',
                retryable: true,
                context,
                cause: error
            });
        }
    };

    const authModule = {
        id: 'auth',
        priority: 70,
        matches(error) {
            const text = errorText(error);
            return error?.code === 'AUTH_REQUIRED' || text.includes('login_required') || text.includes('not authenticated');
        },
        normalize(error, context = {}) {
            return new AppError('AUTH_REQUIRED', {
                category: 'auth',
                retryable: false,
                context,
                cause: error
            });
        }
    };

    const movieModule = {
        id: 'movie',
        priority: 60,
        matches(error) {
            const text = errorText(error);
            return error?.code === 'MOVIE_NOT_FOUND' || text === 'movie not found' || text.includes('exact movie card') && text.includes('not found');
        },
        normalize(error, context = {}) {
            return new AppError('MOVIE_NOT_FOUND', {
                category: 'not-found',
                retryable: false,
                context,
                cause: error
            });
        }
    };

    root.ErrorModules = {
        kinopoiskModule,
        tmdbModule,
        authModule,
        movieModule
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
