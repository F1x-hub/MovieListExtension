(function exposeErrorRegistry(root) {
    class ErrorRegistry {
        constructor() {
            this.modules = [];
        }

        register(errorModule) {
            if (!errorModule || typeof errorModule.matches !== 'function' || typeof errorModule.normalize !== 'function') {
                throw new TypeError('Error module must provide matches() and normalize()');
            }

            this.modules = this.modules.filter((item) => item.id !== errorModule.id);
            this.modules.push({ priority: 0, ...errorModule });
            this.modules.sort((left, right) => right.priority - left.priority);
            return errorModule;
        }

        resolve(error, context = {}) {
            for (const errorModule of this.modules) {
                try {
                    if (errorModule.matches(error, context)) {
                        return errorModule.normalize(error, context);
                    }
                } catch (moduleError) {
                    console.warn(`[ErrorRegistry] Module ${errorModule.id || 'unknown'} failed`, moduleError);
                }
            }

            return null;
        }
    }

    root.ErrorRegistry = ErrorRegistry;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ErrorRegistry };
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
