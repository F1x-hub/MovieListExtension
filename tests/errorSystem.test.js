import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = {
    console,
    Date,
    window: {},
    globalThis: {},
    kinopoiskQuota: {
        getQuotaStatus: () => ({ exhausted: true, until: Date.now() + 3600000, remainingMs: 3600000 })
    },
    i18n: {
        currentLocale: 'ru',
        get(key) {
            const values = {
                ru: {
                    'errors.kinopoisk.daily_limit.title': 'Лимит Kinopoisk API исчерпан',
                    'errors.kinopoisk.daily_limit.message': 'Данные Kinopoisk временно недоступны. {time}',
                    'errors.actions.back': 'Вернуться назад',
                    'errors.actions.close': 'Закрыть',
                    'errors.details': 'Технические детали',
                    'errors.generic.title': 'Что-то пошло не так',
                    'errors.generic.message': 'Не удалось выполнить запрос.'
                },
                en: {
                    'errors.kinopoisk.daily_limit.title': 'Kinopoisk API limit reached',
                    'errors.kinopoisk.daily_limit.message': 'Kinopoisk is temporarily unavailable. {time}',
                    'errors.actions.back': 'Go back',
                    'errors.actions.close': 'Close',
                    'errors.details': 'Technical details',
                    'errors.generic.title': 'Something went wrong',
                    'errors.generic.message': 'The request could not be completed.'
                }
            };
            return values[this.currentLocale]?.[key] || key;
        }
    }
};
sandbox.window = sandbox.globalThis;
sandbox.globalThis.kinopoiskQuota = sandbox.kinopoiskQuota;
sandbox.globalThis.i18n = sandbox.i18n;
const context = vm.createContext(sandbox);
const runtime = sandbox.globalThis;

function load(relativePath) {
    const filename = path.join(rootDir, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    new vm.Script(source, { filename }).runInContext(context);
}

load('src/shared/errors/AppError.js');
load('src/shared/errors/ErrorRegistry.js');
load('src/shared/errors/modules/ProviderErrorModules.js');
load('src/shared/errors/ErrorNormalizer.js');
load('src/shared/errors/ErrorPresentation.js');

const quotaError = runtime.errorNormalizer.normalize(new Error('Kinopoisk daily quota exhausted'), {
    operation: 'movie-details-load'
});
assert.equal(quotaError.code, 'KINOPOISK_DAILY_LIMIT');
assert.equal(quotaError.retryable, false);
assert.equal(quotaError.params.remainingMs, 3600000);

const statusQuotaError = runtime.errorNormalizer.normalize(new Error('HTTP error! status: 402'), {
    operation: 'movie-details-load',
    category: 'provider'
});
assert.equal(statusQuotaError.code, 'KINOPOISK_ACCESS_DENIED');

const explicitStatusQuotaError = runtime.errorNormalizer.normalize(new Error('HTTP 402: daily quota reached'), {
    operation: 'movie-details-load',
    category: 'provider'
});
assert.equal(explicitStatusQuotaError.code, 'KINOPOISK_DAILY_LIMIT');

assert.equal(runtime.errorNormalizer.normalize(new Error('HTTP error! status: 401'), {
    category: 'provider'
}).code, 'KINOPOISK_AUTH');
assert.equal(runtime.errorNormalizer.normalize(new Error('HTTP error! status: 403'), {
    category: 'provider'
}).code, 'KINOPOISK_ACCESS_DENIED');
assert.equal(runtime.errorNormalizer.normalize(new Error('HTTP error! status: 429'), {
    category: 'provider'
}).code, 'KINOPOISK_RATE_LIMITED');
assert.equal(runtime.errorNormalizer.normalize(new Error('HTTP error! status: 503'), {
    category: 'provider'
}).code, 'KINOPOISK_SERVER');
assert.equal(runtime.errorNormalizer.normalize({
    name: 'KinopoiskNetworkError',
    code: 'KINOPOISK_NETWORK',
    message: 'Failed to fetch'
}, { category: 'provider' }).code, 'KINOPOISK_NETWORK');

const quotaPresentation = runtime.ErrorPresentation.getPresentation(quotaError, {
    onBack: () => {}
});
assert.equal(quotaPresentation.primary, 'retry');
assert.match(quotaPresentation.message, /1 ч\./);
assert.doesNotMatch(quotaPresentation.message, /daily quota|Failed to get movie details/i);

runtime.i18n.currentLocale = 'en';
const englishPresentation = runtime.ErrorPresentation.getPresentation(quotaError, {
    onBack: () => {}
});
assert.equal(englishPresentation.title, 'Kinopoisk API limit reached');
assert.equal(englishPresentation.primaryLabel, 'Try again');

const userMessage = runtime.errorNormalizer.normalize('Пожалуйста, войдите в систему');
assert.equal(userMessage.code, 'USER_MESSAGE');
assert.equal(runtime.ErrorPresentation.getPresentation(userMessage).message, 'Пожалуйста, войдите в систему');

const customRegistry = new runtime.ErrorRegistry();
customRegistry.register({
    id: 'custom',
    priority: 200,
    matches: (error) => error?.code === 'CUSTOM_FAILURE',
    normalize: () => new runtime.AppError('CUSTOM_NORMALIZED', { retryable: false })
});
assert.equal(customRegistry.resolve({ code: 'CUSTOM_FAILURE' }).code, 'CUSTOM_NORMALIZED');

console.log('✅ Modular error system normalization and localization contract passed');
