/** Stable provider values shared by discovery filters; labels follow the locale. */
const DiscoveryFilters = {
    definitions: {
    "types": [
        {
            "labelKey": "random.types.movie",
            "value": "movie"
        },
        {
            "labelKey": "random.types.tv_series",
            "value": "tv-series"
        },
        {
            "labelKey": "random.types.cartoon",
            "value": "cartoon"
        },
        {
            "labelKey": "random.types.anime",
            "value": "anime"
        }
    ],
    "genres": [
        {
            "labelKey": "random.genres.comedy",
            "value": "комедия"
        },
        {
            "labelKey": "random.genres.cartoon",
            "value": "мультфильм"
        },
        {
            "labelKey": "random.genres.horror",
            "value": "ужасы"
        },
        {
            "labelKey": "random.genres.sci_fi",
            "value": "фантастика"
        },
        {
            "labelKey": "random.genres.thriller",
            "value": "триллер"
        },
        {
            "labelKey": "random.genres.action",
            "value": "боевик"
        },
        {
            "labelKey": "random.genres.melodrama",
            "value": "мелодрама"
        },
        {
            "labelKey": "random.genres.detective",
            "value": "детектив"
        },
        {
            "labelKey": "random.genres.adventure",
            "value": "приключения"
        },
        {
            "labelKey": "random.genres.fantasy",
            "value": "фэнтези"
        },
        {
            "labelKey": "random.genres.war",
            "value": "военный"
        },
        {
            "labelKey": "random.genres.family",
            "value": "семейный"
        },
        {
            "labelKey": "random.genres.anime",
            "value": "аниме"
        },
        {
            "labelKey": "random.genres.history",
            "value": "история"
        },
        {
            "labelKey": "random.genres.drama",
            "value": "драма"
        },
        {
            "labelKey": "random.genres.documentary",
            "value": "документальный"
        },
        {
            "labelKey": "random.genres.kids",
            "value": "детский"
        },
        {
            "labelKey": "random.genres.crime",
            "value": "криминал"
        },
        {
            "labelKey": "random.genres.biography",
            "value": "биография"
        },
        {
            "labelKey": "random.genres.western",
            "value": "вестерн"
        },
        {
            "labelKey": "random.genres.film_noir",
            "value": "фильм-нуар"
        },
        {
            "labelKey": "random.genres.sport",
            "value": "спорт"
        },
        {
            "labelKey": "random.genres.reality_tv",
            "value": "реальное ТВ"
        },
        {
            "labelKey": "random.genres.short",
            "value": "короткометражка"
        },
        {
            "labelKey": "random.genres.music",
            "value": "музыка"
        },
        {
            "labelKey": "random.genres.musical",
            "value": "мюзикл"
        },
        {
            "labelKey": "random.genres.talk_show",
            "value": "ток-шоу"
        },
        {
            "labelKey": "random.genres.game",
            "value": "игра"
        }
    ],
    "countries": [
        {
            "labelKey": "random.countries.russia",
            "value": "Россия"
        },
        {
            "labelKey": "random.countries.ussr",
            "value": "СССР"
        },
        {
            "labelKey": "random.countries.usa",
            "value": "США"
        },
        {
            "labelKey": "random.countries.kazakhstan",
            "value": "Казахстан"
        },
        {
            "labelKey": "random.countries.france",
            "value": "Франция"
        },
        {
            "labelKey": "random.countries.south_korea",
            "value": "Южная Корея"
        },
        {
            "labelKey": "random.countries.uk",
            "value": "Великобритания"
        },
        {
            "labelKey": "random.countries.japan",
            "value": "Япония"
        },
        {
            "labelKey": "random.countries.italy",
            "value": "Италия"
        },
        {
            "labelKey": "random.countries.spain",
            "value": "Испания"
        },
        {
            "labelKey": "random.countries.germany",
            "value": "Германия"
        },
        {
            "labelKey": "random.countries.turkey",
            "value": "Турция"
        },
        {
            "labelKey": "random.countries.sweden",
            "value": "Швеция"
        },
        {
            "labelKey": "random.countries.denmark",
            "value": "Дания"
        },
        {
            "labelKey": "random.countries.norway",
            "value": "Норвегия"
        },
        {
            "labelKey": "random.countries.hong_kong",
            "value": "Гонконг"
        },
        {
            "labelKey": "random.countries.australia",
            "value": "Австралия"
        },
        {
            "labelKey": "random.countries.belgium",
            "value": "Бельгия"
        },
        {
            "labelKey": "random.countries.netherlands",
            "value": "Нидерланды"
        },
        {
            "labelKey": "random.countries.greece",
            "value": "Греция"
        },
        {
            "labelKey": "random.countries.austria",
            "value": "Австрия"
        }
    ]
},
    getOptions(i18n) {
        return Object.fromEntries(Object.entries(this.definitions).map(([group, options]) =>
            [group, options.map(option => ({ ...option, label: i18n.get(option.labelKey) }))]));
    }
};
if (typeof window !== 'undefined') window.DiscoveryFilters = DiscoveryFilters;
if (typeof module !== 'undefined' && module.exports) module.exports = DiscoveryFilters;
