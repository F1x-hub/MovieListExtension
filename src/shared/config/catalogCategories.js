/**
 * Canonical catalogue category contract shared by Home and the full catalogue.
 * Category names are product-facing and must not be replaced with provider
 * type strings at call sites.
 */
const CATALOG_CATEGORIES = Object.freeze({
    films: Object.freeze({
        key: 'films',
        title: 'Все фильмы',
        description: 'Игровые фильмы без анимации',
        mediaType: 'movie',
        providerType: 'movie',
        tmdbKind: 'movie',
        section: 'films',
        sortOptions: Object.freeze([
            Object.freeze({ value: 'popularity.desc', label: 'Популярные' }),
            Object.freeze({ value: 'vote_average.desc', label: 'По рейтингу' }),
            Object.freeze({ value: 'primary_release_date.desc', label: 'Новые фильмы' })
        ])
    }),
    series: Object.freeze({
        key: 'series',
        title: 'Все сериалы',
        description: 'Игровые сериалы без анимации',
        mediaType: 'tv',
        providerType: 'tv-series',
        tmdbKind: 'tv',
        section: 'series',
        sortOptions: Object.freeze([
            Object.freeze({ value: 'popularity.desc', label: 'Популярные' }),
            Object.freeze({ value: 'vote_average.desc', label: 'По рейтингу' }),
            Object.freeze({ value: 'first_air_date.desc', label: 'Новые сериалы' })
        ])
    }),
    cartoons: Object.freeze({
        key: 'cartoons',
        title: 'Все мультфильмы',
        description: 'Анимация со всего мира, кроме японского аниме',
        mediaType: 'mixed',
        providerType: 'cartoon',
        tmdbKind: 'mixed',
        section: 'cartoons',
        sortOptions: Object.freeze([
            Object.freeze({ value: 'popularity.desc', label: 'Популярные' }),
            Object.freeze({ value: 'vote_average.desc', label: 'По рейтингу' }),
            Object.freeze({ value: 'primary_release_date.desc', label: 'Новые мультфильмы' })
        ])
    }),
    anime: Object.freeze({
        key: 'anime',
        title: 'Всё аниме',
        description: 'Японская анимация: фильмы и сериалы',
        mediaType: 'mixed',
        providerType: 'anime',
        tmdbKind: 'mixed',
        section: 'anime',
        sortOptions: Object.freeze([
            Object.freeze({ value: 'popularity.desc', label: 'Популярные' }),
            Object.freeze({ value: 'vote_average.desc', label: 'По рейтингу' }),
            Object.freeze({ value: 'primary_release_date.desc', label: 'Новое аниме' })
        ])
    })
});

const CATALOG_CATEGORY_ALIASES = Object.freeze({
    movie: 'films',
    films: 'films',
    film: 'films',
    'tv-series': 'series',
    series: 'series',
    tv: 'series',
    cartoon: 'cartoons',
    cartoons: 'cartoons',
    anime: 'anime'
});

function normalizeCatalogCategory(value, fallback = 'films') {
    const normalized = String(value || '').trim().toLowerCase();
    const category = CATALOG_CATEGORY_ALIASES[normalized] || normalized;
    return CATALOG_CATEGORIES[category] ? category : fallback;
}

if (typeof window !== 'undefined') {
    window.CATALOG_CATEGORIES = CATALOG_CATEGORIES;
    window.CATALOG_CATEGORY_ALIASES = CATALOG_CATEGORY_ALIASES;
    window.normalizeCatalogCategory = normalizeCatalogCategory;
}

if (typeof globalThis !== 'undefined') {
    globalThis.CATALOG_CATEGORIES = CATALOG_CATEGORIES;
    globalThis.CATALOG_CATEGORY_ALIASES = CATALOG_CATEGORY_ALIASES;
    globalThis.normalizeCatalogCategory = normalizeCatalogCategory;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CATALOG_CATEGORIES,
        CATALOG_CATEGORY_ALIASES,
        normalizeCatalogCategory
    };
}
