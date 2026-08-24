(function exposeAppError(root) {
    class AppError extends Error {
        constructor(code, options = {}) {
            const message = options.message || code || 'UNKNOWN_ERROR';
            super(message);
            this.name = 'AppError';
            this.code = code || 'UNKNOWN_ERROR';
            this.category = options.category || 'unknown';
            this.severity = options.severity || 'error';
            this.retryable = options.retryable !== false;
            this.params = { ...(options.params || {}) };
            this.context = { ...(options.context || {}) };
            this.userMessage = options.userMessage || null;
            this.cause = options.cause || null;
        }

        static from(error, fallbackCode = 'UNKNOWN_ERROR', options = {}) {
            if (error instanceof AppError) return error;

            const message = typeof error === 'string' ? error : error?.message;
            return new AppError(fallbackCode, {
                ...options,
                message: message || fallbackCode,
                cause: error
            });
        }

        toJSON() {
            return {
                name: this.name,
                code: this.code,
                category: this.category,
                severity: this.severity,
                retryable: this.retryable,
                params: { ...this.params },
                context: { ...this.context }
            };
        }
    }

    root.AppError = AppError;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { AppError };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
