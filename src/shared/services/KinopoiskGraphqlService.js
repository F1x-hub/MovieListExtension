/**
 * KinopoiskGraphqlService reads movie ratings from kinopoisk.ru's own GraphQL
 * API instead of loading hidden Kinopoisk pages: one JSON request per title
 * (~0.1 s) instead of a full page load (seconds).
 *
 * graphql.kinopoisk.ru accepts only query texts its own site sends ("the query
 * is not allowed" otherwise), so the queries below are copied verbatim from the
 * site's bundle (printed the way its Apollo client sends them). Requests carry
 * kinopoisk.ru Origin/Referer through the extension-scoped session DNR rule that
 * KinopoiskRatingSync.installRequestRules() installs in the background worker.
 */
class KinopoiskGraphqlService {
    static ENDPOINT = 'https://graphql.kinopoisk.ru/graphql/';

    static TOUCH_MOVIE_RATING_QUERY = 'query TouchMovieRating($movieId: Long!, $withUserData: Boolean!) { movie(id: $movieId) { id title { russian original __typename } poster { avatarsUrl fallbackUrl __typename } ... on Film { ratingLists { top250 { ...MovieRatingListsItem __typename } __typename } __typename } ... on TvSeries { ratingLists { top250 { ...MovieRatingListsItem __typename } __typename } __typename } ... on TvShow { ratingLists { top250 { ...MovieRatingListsItem __typename } __typename } __typename } ... on MiniSeries { ratingLists { top250 { ...MovieRatingListsItem __typename } __typename } __typename } genres { id name slug __typename } rating { imdb { ...KpRatingValue __typename } kinopoisk { ...KpRatingValue __t'
        + 'ypename } russianCritics { ...KpRatingValue __typename } worldwideCritics { value percent count isActive positiveCount negativeCount __typename } reviewCount { ...KpRatingValue __typename } positiveReviewRate { value __typename } plannedToWatch { ...KpRatingValue __typename } __typename } usersReviewsPositive: userReviews(types: [POSITIVE], limit: 0) { total __typename } usersReviewsNeutral: userReviews(types: [NEUTRAL], limit: 0) { total __typename } ...MovieUserData @include(if: $withUserData) __typename } } fragment PurchaseMetadata on MovieUserData { purchaseMetadata(includeWaiting: true) { id watchPeriod { watchPeriodStatus __typename } __typename } __typename } fragment Folder on Folde'
        + 'r { id name public __typename } fragment MovieUserFolders on Movie { userData { userFolders(offset: 0, limit: 20) { items { ...Folder __typename } __typename } isFavorite __typename } __typename } fragment MovieRatingListsItem on MovieInList { movieListSlug position __typename } fragment KpRatingValue on RatingValue { value isActive count __typename } fragment MovieUserData on Movie { userData { voting { value votedAt __typename } note { value makeDate __typename } watchStatuses { notInterested { value __typename } watched { value __typename } __typename } isPlannedToWatch ...PurchaseMetadata __typename } ...MovieUserFolders __typename } ';

    static SUGGEST_SEARCH_QUERY = 'query SuggestSearch($keyword: String!, $yandexCityId: Int, $limit: Int, $withUserData: Boolean!) { suggest(keyword: $keyword) { top(yandexCityId: $yandexCityId, limit: $limit) { topResult { global { ...SuggestMovieItem ...SuggestPersonItem ...SuggestCinemaItem ...SuggestMovieListItem __typename } __typename } movies { movie { ...SuggestMovieItem __typename } __typename } persons { person { ...SuggestPersonItem __typename } __typename } cinemas { cinema { ...SuggestCinemaItem __typename } __typename } movieLists { movieList { ...SuggestMovieListItem __typename } __typename } __typename } __typename } } fragment ShortImage on Image { avatarsUrl fallbackUrl __typename } fragment MovieHdVertical'
        + 'Poster on Movie { gallery { posters { hdVertical: vertical(override: OTT_WHEN_EXISTS) { ...ShortImage __typename } __typename } __typename } __typename } fragment MovieKpVerticalPoster on Movie { gallery { posters { kpVertical: vertical { ...ShortImage __typename } __typename } __typename } __typename } fragment TicketOption on Movie { ticketOption { purchasable releaseAnnounce { available releaseDate { accuracy date __typename } __typename } __typename } __typename } fragment SuggestMovieItem on Movie { id contentId title { russian original __typename } rating { kinopoisk { isActive value __typename } __typename } ...MovieHdVerticalPoster ...MovieKpVerticalPoster viewOption { buttonText isA'
        + 'vailableOnline: isWatchable(filter: {anyDevice: false, anyRegion: false}) purchasabilityStatus contentPackageToBuy { billingFeatureName __typename } subscriptionBadge { image { avatarsUrl __typename } __typename } type availabilityAnnounce { groupPeriodType announcePromise availabilityDate type __typename } __typename } ...TicketOption userData @include(if: $withUserData) { isPlannedToWatch __typename } ... on Film { productionYear __typename } ... on TvSeries { releaseYears { end start __typename } __typename } ... on TvShow { releaseYears { end start __typename } __typename } ... on MiniSeries { releaseYears { end start __typename } __typename } __typename } fragment SuggestPersonItem on P'
        + 'erson { id name originalName birthDate poster { avatarsUrl fallbackUrl __typename } __typename } fragment SuggestCinemaItem on Cinema { id ctitle: title city { id name geoId __typename } __typename } fragment SuggestMovieListItem on MovieListMeta { id cover { avatarsUrl __typename } coverBackground { avatarsUrl __typename } name url description movies(limit: 0) { total __typename } __typename } ';

    constructor({ fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 6000 } = {}) {
        this.fetch = fetchImpl;
        this.timeoutMs = timeoutMs;
    }

    async graphql(operationName, query, variables) {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
        try {
            const response = await this.fetch(`${KinopoiskGraphqlService.ENDPOINT}?operationName=${operationName}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json', 'service-id': '25', 'x-preferred-language': 'ru' },
                body: JSON.stringify({ operationName, variables, query }),
                ...(controller ? { signal: controller.signal } : {})
            });
            if (!response.ok) throw new Error(`Kinopoisk GraphQL HTTP ${response.status}`);
            const payload = await response.json();
            if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
                throw new Error(payload.errors.map(item => item?.message).filter(Boolean).join('; ') || 'Kinopoisk GraphQL error');
            }
            return payload?.data || null;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    static ratingValue(value) {
        const number = Number(value?.value);
        return Number.isFinite(number) && number > 0 ? Math.round(number * 10) / 10 : 0;
    }

    /**
     * Kinopoisk and IMDb ratings with vote counts for one Kinopoisk title.
     * @returns {Promise<{kpRating:number,kpVotes:number,imdbRating:number,imdbVotes:number,imdbAnswered:boolean}|null>}
     *   null when the title is unknown; imdbAnswered is false when Kinopoisk has
     *   no IMDb block yet (new titles), so callers may fall back to the page.
     */
    async getMovieRatings(kinopoiskId) {
        const movieId = Number(kinopoiskId);
        if (!Number.isInteger(movieId) || movieId <= 0) return null;
        const data = await this.graphql('TouchMovieRating', KinopoiskGraphqlService.TOUCH_MOVIE_RATING_QUERY, { movieId, withUserData: false });
        const rating = data?.movie?.rating;
        if (!data?.movie) return null;
        return {
            kpRating: KinopoiskGraphqlService.ratingValue(rating?.kinopoisk),
            kpVotes: Number(rating?.kinopoisk?.count) || 0,
            imdbRating: KinopoiskGraphqlService.ratingValue(rating?.imdb),
            imdbVotes: Number(rating?.imdb?.count) || 0,
            imdbAnswered: Boolean(rating?.imdb)
        };
    }

    /**
     * Title search through the site's own search suggestions: the KP ID,
     * titles, year and KP rating of matching titles in one JSON request.
     * @returns {Promise<Array<{id:number,type:'film'|'series',title:string,originalTitle:string,year:number|null,kpRating:number}>>}
     */
    async searchMovies(keyword, { limit = 10 } = {}) {
        const text = String(keyword || '').trim();
        if (!text) return [];
        const data = await this.graphql('SuggestSearch', KinopoiskGraphqlService.SUGGEST_SEARCH_QUERY,
            { keyword: text, yandexCityId: 213, limit, withUserData: false });
        const top = data?.suggest?.top;
        const movies = [top?.topResult?.global, ...(top?.movies || []).map(item => item?.movie)]
            .filter(movie => movie && Number(movie.id) > 0 && movie.title);
        const seen = new Set();
        return movies.filter(movie => !seen.has(movie.id) && seen.add(movie.id)).map(movie => ({
            id: Number(movie.id),
            type: KinopoiskGraphqlService.SERIES_TYPES.has(movie.__typename) ? 'series' : 'film',
            title: movie.title?.russian || movie.title?.original || '',
            originalTitle: movie.title?.original || '',
            year: Number(movie.productionYear || movie.releaseYears?.[0]?.start) || null,
            kpRating: KinopoiskGraphqlService.ratingValue(movie.rating?.kinopoisk)
        }));
    }
}

KinopoiskGraphqlService.SERIES_TYPES = new Set(['TvSeries', 'MiniSeries', 'TvShow']);

if (typeof globalThis !== 'undefined') globalThis.KinopoiskGraphqlService = KinopoiskGraphqlService;
if (typeof module !== 'undefined' && module.exports) module.exports = KinopoiskGraphqlService;
