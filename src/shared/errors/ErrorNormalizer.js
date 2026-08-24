(function exposeErrorNormalizer(root) {
    const AppError = root.AppError;
    const registry = root.errorRegistry || new root.ErrorRegistry();

    Object.values(root.ErrorModules || {}).forEach((errorModule) => registry.register(errorModule));

    function normalize(error, context = {}) {
        if (error instanceof AppError) return error;

        const resolved = registry.resolve(error, context);
        if (resolved instanceof AppError) return resolved;

        const text = [error?.code, error?.message].filter(Boolean).join(' ');
        if (/503|service unavailable|api_service_unavailable/i.test(text)) {
            return new AppError('KINOPOISK_UNAVAILABLE', {
                category: 'provider',
                retryable: true,
                context,
                cause: error
            });
        }

        if (error?.code === 'AUTH_REQUIRED') {
            return new AppError('AUTH_REQUIRED', {
                category: 'auth',
                retryable: false,
                context,
                cause: error
            });
        }

        if (typeof error === 'string') {
            return new AppError('USER_MESSAGE', {
                category: 'user',
                retryable: false,
                userMessage: error,
                context,
                cause: error
            });
        }

        return new AppError('GENERIC_LOAD_ERROR', {
            category: context.category || 'unknown',
            retryable: true,
            context,
            cause: error
        });
    }

    root.errorRegistry = registry;
    root.errorNormalizer = { normalize };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { normalize, registry };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
