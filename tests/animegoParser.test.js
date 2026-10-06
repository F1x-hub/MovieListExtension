const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

console.log('🧪 Running AnimeGoParser tests...');

const baseSource = fs.readFileSync('src/shared/services/parsers/BaseParserService.js', 'utf8');
const parserSource = fs.readFileSync('src/shared/services/parsers/AnimeGoParser.js', 'utf8');
const resolverSource = fs.readFileSync('src/shared/services/parsers/KodikStreamResolver.js', 'utf8');

function createParser(routes, { native = false } = {}) {
    const dom = new JSDOM('<!doctype html><body><div id="player"></div></body>', {
        runScripts: 'dangerously',
        url: 'chrome-extension://test/src/pages/movie-details/movie-details.html'
    });
    const requests = [];
    dom.window.fetch = async (url, options = {}) => {
        requests.push({ url: String(url), options });
        const route = routes[String(url)];
        if (!route) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
        const value = typeof route === 'function' ? await route(String(url), options) : route;
        return {
            ok: true,
            status: 200,
            text: async () => (typeof value === 'string' ? value : JSON.stringify(value)),
            json: async () => value
        };
    };
    dom.window.eval(baseSource);
    if (native) {
        dom.window.eval(resolverSource);
        installHlsStub(dom.window);
    }
    dom.window.eval(parserSource);
    return { parser: new dom.window.AnimeGoParser(), window: dom.window, requests };
}

// Records every HLS stream the parser attaches instead of loading media.
function installHlsStub(window) {
    window.Hls = function Hls() {};
    window.Hls.isSupported = () => true;
    window.__hlsCreated = [];
    window.HlsPlaybackFactory = {
        create(video, url, options) {
            const instance = { url, options, destroyed: false, destroy() { this.destroyed = true; } };
            window.__hlsCreated.push(instance);
            return instance;
        }
    };
}

function encodeKodikSource(url) {
    return Buffer.from(url, 'binary').toString('base64').replace(/[a-zA-Z]/g, char => {
        const base = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(((char.charCodeAt(0) - base - 18 + 26) % 26) + base);
    });
}

function kodikPage(hash) {
    return `<script>var urlParams = '{"d":"kodikplayer.com","d_sign":"s:1"}';
        vInfo.type = 'seria'; vInfo.hash = '${hash}'; vInfo.id = '1';</script>`;
}

// /ftor answers per embed hash: one manifest per quality.
function kodikFtor(_url, options) {
    const hash = new URLSearchParams(options.body).get('hash');
    const link = quality => [{ src: encodeKodikSource(`//cloud.solodcdn.com/${hash}/${quality}.mp4:hls:manifest.m3u8`) }];
    return { links: { 480: link(480), 720: link(720) } };
}

function searchCard({ id, slug, title, original, kind, year }) {
    return `
        <div class="ani-grid__item">
            <a class="ani-grid__item-picture" href="/anime/${slug}-${id}"><img alt="${title}"></a>
            <div class="ani-grid__item-body pt-2">
                <div class="fw-lighter small mb-1">${original}</div>
                <div class="ani-grid__item-title h5"><a title="${title}" href="/anime/${slug}-${id}">${title}</a></div>
                <div class="ani-grid__item-genres">
                    <span><span class="ani-grid__item-genres__link">${kind}</span></span>
                    <span>/</span>
                    <span><span class="ani-grid__item-genres__link">${year}</span></span>
                </div>
            </div>
        </div>`;
}

function providerButton({ player, translation, translationId, provider }) {
    return `<button type="button" data-player="${player}" data-provider-title="${provider}"
        data-translation-id="${translationId}" data-translation-title="${translation}">${translation}</button>`;
}

function episodeItem(number, id, type = 1) {
    return `<div class="player-video-bar__item" data-episode-number="${number}" data-episode-type="${type}" data-episode="${id}"></div>`;
}

const searchHtml = `<!doctype html><html><body><div class="ani-grid">
    ${searchCard({ id: 385, slug: 'boruto-film-naruto', title: 'Боруто: Фильм Наруто', original: 'Boruto: Naruto the Movie', kind: 'Фильм', year: 2015 })}
    ${searchCard({ id: 103, slug: 'naruto-uragannye-hroniki', title: 'Наруто: Ураганные хроники', original: 'Naruto: Shippuuden', kind: 'ТВ Сериал', year: 2007 })}
    ${searchCard({ id: 999, slug: 'naruto-uragannye-hroniki-remake', title: 'Наруто: Ураганные хроники', original: 'Naruto: Shippuuden Remake', kind: 'ТВ Сериал', year: 2030 })}
</div></body></html>`;

(async () => {
    // 1. Contract and media-type gating.
    {
        const { parser } = createParser({});
        assert.equal(parser.id, 'animego');
        assert.equal(parser.name, 'AnimeGo');
        assert.equal(parser.getPlayerType(), 'video', 'the resolved Kodik stream is preferred over iframes');
        assert.equal(parser.supportsType('anime'), true);
        assert.equal(parser.supportsType('film'), false, 'AnimeGo must not be offered for live-action films');
        assert.equal(parser.supportsType('tv-series'), false);
        assert.equal(parser.getPerfCategory('SEARCH'), 'ANIMEGO_SEARCH');

        // Kinopoisk types many anime as series/films with the "аниме" genre.
        assert.equal(parser.supportsMedia({ type: 'tv-series', genres: [{ genre: 'аниме' }, { genre: 'фэнтези' }] }, 'tv-series'), true,
            'Solo Leveling-style DTOs (series + Kinopoisk anime genre) must show AnimeGo');
        assert.equal(parser.supportsMedia({ type: 'tv-series', genres: ['аниме'] }, 'tv-series'), true);
        assert.equal(parser.supportsMedia({ type: 'film', genres: [{ name: 'Anime' }] }, 'film'), true);
        assert.equal(parser.supportsMedia({ type: 'anime', genres: [] }, 'anime'), true);
        assert.equal(parser.supportsMedia({ type: 'tv-series', genres: [{ genre: 'драма' }] }, 'tv-series'), false);
        assert.equal(parser.supportsMedia({ type: 'film', genres: ['мультфильм'], countries: ['США'] }, 'film'), false,
            'Western animation is not offered AnimeGo');
        assert.equal(parser.supportsMedia(null, null), false);
    }

    // 1b. Other parsers keep the plain media-type gate.
    {
        const { window } = createParser({});
        window.eval(`class TypedParser extends BaseParserService {
            constructor() { super({ id: 'typed', name: 'Typed', baseUrl: 'https://typed.test' }); }
            getSupportedTypes() { return ['film']; }
        } window.TypedParser = TypedParser;`);
        const typed = new window.TypedParser();
        assert.equal(typed.supportsMedia({ genres: ['аниме'] }, 'film'), true);
        assert.equal(typed.supportsMedia({ genres: ['аниме'] }, 'tv-series'), false);
        assert.equal(typed.supportsMedia({}, null), true, 'an unknown type keeps the old permissive behaviour');
    }

    // 2. Search matches the exact title and year, not a same-title remake.
    {
        const { parser, requests } = createParser({
            'https://animego.me/search/anime?q=%D0%9D%D0%B0%D1%80%D1%83%D1%82%D0%BE%3A%20%D0%A3%D1%80%D0%B0%D0%B3%D0%B0%D0%BD%D0%BD%D1%8B%D0%B5%20%D1%85%D1%80%D0%BE%D0%BD%D0%B8%D0%BA%D0%B8': searchHtml
        });
        const result = await parser.search('Наруто: Ураганные хроники', 2007);
        assert.equal(result.animeId, '103');
        assert.equal(result.url, 'https://animego.me/anime/naruto-uragannye-hroniki-103');
        assert.equal(result.year, '2007');
        assert.equal(result.isSeries, true);
        assert.equal(result.parserId, 'animego');
        assert.equal(requests[0].options.credentials, 'omit');

        const byOriginal = parser.parseSearchResults(searchHtml, 'Boruto: Naruto the Movie', 2015);
        assert.equal(byOriginal.animeId, '385', 'original titles match too');
        assert.equal(byOriginal.isSeries, false);

        assert.equal(parser.parseSearchResults(searchHtml, 'Наруто', 2007), null,
            'a partial title without an exact match must not pass the threshold on its own year');
        assert.equal(parser.parseSearchResults(searchHtml, 'Naruto: Shippuuden TV', 2007)?.animeId, '103',
            'a near-identical romanization matches with the same year');
        assert.equal(parser.parseSearchResults(searchHtml, 'Naruto: Shippuuden TV', 2012), null,
            'a near-identical romanization alone is not enough without the year');
        assert.equal(parser.parseSearchResults(searchHtml, 'Ван-Пис', 1999), null);

        assert.deepEqual(Array.from(parser.constructor.buildTitleVariants('Solo Leveling: Поднятие уровня в одиночку')),
            ['Solo Leveling: Поднятие уровня в одиночку', 'Solo Leveling', 'Поднятие уровня в одиночку']);
        assert.deepEqual(Array.from(parser.constructor.buildTitleVariants('Ван-Пис')), ['Ван-Пис'],
            'hyphenated words are not split');
    }

    // 2b. A combined catalog title falls back to its parts.
    {
        const soloCard = searchCard({ id: 2477, slug: 'podnyatie-urovnya-v-odinochku-s1', title: 'Поднятие уровня в одиночку', original: 'Ore dake Level Up na Ken', kind: 'Сериал', year: 2024 });
        const page = `<!doctype html><body>${soloCard}</body>`;
        const q = text => `https://animego.me/search/anime?q=${encodeURIComponent(text)}`;
        const { parser, requests } = createParser({
            [q('Solo Leveling: Поднятие уровня в одиночку')]: page,
            [q('Solo Leveling')]: '<!doctype html><body></body>',
            [q('Поднятие уровня в одиночку')]: page
        });
        const result = await parser.search('Solo Leveling: Поднятие уровня в одиночку', 2024);
        assert.equal(result?.animeId, '2477');
        assert.equal(requests.length, 3, 'the combined title and its first part are tried before the second part');
        assert.equal(parser.parseSearchResults(searchHtml, 'Боруто: Фильм Наруто', 2010), null,
            'a year far from the catalog year is treated as another title');
    }

    // 3. Films: Kodik first with the Referer marker, Sibnet as fallback,
    //    unknown hosts dropped, XHR header sent.
    {
        const filmContent = `<div>${[
            providerButton({ player: '//video.sibnet.ru/shell.php?videoid=1', translation: 'AniLibria', translationId: 2, provider: 'Sibnet' }),
            providerButton({ player: '//kodikplayer.com/video/9869/abc/720p?translations=false', translation: 'AniLibria', translationId: 2, provider: 'Kodik' }),
            providerButton({ player: '//evil.example/embed', translation: 'X', translationId: 3, provider: 'Other' }),
            providerButton({ player: 'javascript:alert(1)', translation: 'Y', translationId: 4, provider: 'Other' })
        ].join('')}</div>`;
        const { parser, requests } = createParser({
            'https://animego.me/player/385': { status: 'success', data: { content: filmContent } }
        });
        const sources = await parser.getVideoSources({ url: 'https://animego.me/anime/boruto-film-naruto-385' });
        assert.deepEqual(Array.from(sources, source => source.url), [
            'https://kodikplayer.com/video/9869/abc/720p?translations=false&movieExtensionSite=animego.me',
            'https://video.sibnet.ru/shell.php?videoid=1'
        ]);
        assert.equal(sources[0].type, 'iframe');
        assert.equal(sources[0].name, 'AnimeGo · AniLibria · Kodik');
        assert.equal(requests[0].options.headers['X-Requested-With'], 'XMLHttpRequest',
            'AnimeGo returns player JSON only to XHR-style requests');
    }

    // 4. Series: episode descriptors across paged episode lists.
    const seriesContent = `<div data-anime-player-episodes-total-value="150" data-anime-player-episodes-page-size-value="100">
        ${episodeItem(1, 1618)}${episodeItem(2, 1619)}${episodeItem(57, 1674, 3)}
        ${providerButton({ player: '//kodikplayer.com/seria/1/first/720p', translation: '2x2', translationId: 9, provider: 'Kodik' })}
    </div>`;
    const pageTwo = { status: 'success', data: { content: `<div>${episodeItem(101, 1718)}${episodeItem(2, 1619)}</div>`, page: 1, pageSize: 100, total: 150 } };
    const episodeVideos = (id, extra = '') => ({
        status: 'success',
        data: {
            content: `<div>${extra}${providerButton({ player: `//kodikplayer.com/seria/${id}/dub9/720p`, translation: '2x2', translationId: 9, provider: 'Kodik' })}${providerButton({ player: `//kodikplayer.com/seria/${id}/dub1/720p`, translation: 'AniDUB', translationId: 1, provider: 'Kodik' })}</div>`
        }
    });
    {
        const { parser } = createParser({
            'https://animego.me/player/103': { status: 'success', data: { content: seriesContent } },
            'https://animego.me/player/103/episodes?page=1': pageTwo
        });
        const sources = await parser.getVideoSources({ url: 'https://animego.me/anime/naruto-uragannye-hroniki-103', animeId: '103' });
        assert.deepEqual(Array.from(sources, source => source.episodeNumber), [1, 2, 57, 101], 'episodes are deduplicated and ordered');
        assert.equal(sources[0].type, 'animego-episode');
        assert.equal(sources[0].url, 'https://animego.me/player/videos/1618');
        assert.equal(sources[2].filler, true);
        assert.equal(parser.supportsSourceType(sources[0]), true, 'episode descriptors survive MovieDetails source normalization');
        assert.equal(parser.extractEpisodeNumber(sources[3]), 101);
    }

    // 5. renderPlayer resolves the requested episode and keeps the chosen dub.
    {
        const { parser, window, requests } = createParser({
            'https://animego.me/player/videos/1619': episodeVideos(1619),
            'https://animego.me/player/videos/1674': episodeVideos(1674),
            'https://animego.me/player/videos/1618': { status: 'success', data: { content: '<div></div>' } }
        });
        const episodes = [
            { type: 'animego-episode', url: 'https://animego.me/player/videos/1618', episodeId: '1618', episodeNumber: 1, animeId: '103' },
            { type: 'animego-episode', url: 'https://animego.me/player/videos/1619', episodeId: '1619', episodeNumber: 2, animeId: '103' },
            { type: 'animego-episode', url: 'https://animego.me/player/videos/1674', episodeId: '1674', episodeNumber: 57, animeId: '103' }
        ];
        const container = window.document.getElementById('player');

        assert.equal(await parser.renderPlayer(container, episodes, { episode: 2 }), true);
        let iframe = container.querySelector('iframe');
        assert.equal(iframe.getAttribute('src'),
            'https://kodikplayer.com/seria/1619/dub9/720p?movieExtensionSite=animego.me');

        // The user picks the second dub; the next episode keeps it.
        parser._preferredTranslationByAnime.set('103', '1');
        assert.equal(await parser.renderPlayer(container, episodes, { resolvedEpisodeUrl: 'https://animego.me/player/videos/1674' }), true);
        iframe = container.querySelector('iframe');
        assert.equal(iframe.getAttribute('src'),
            'https://kodikplayer.com/seria/1674/dub1/720p?movieExtensionSite=animego.me');

        // Cached episode players are not fetched twice.
        const before = requests.length;
        await parser.renderPlayer(container, episodes, { episode: 2 });
        assert.equal(requests.length, before);

        // An episode without embeds reports unavailability instead of mounting.
        assert.equal(await parser.renderPlayer(container, episodes, { episode: 1 }), false);
        assert.equal(container.querySelector('iframe'), null);
        assert.match(container.textContent, /Серия 1 недоступна/);

        // A superseded render must not mount over a newer one.
        let releaseSlow;
        const { parser: racing, window: raceWindow } = createParser({
            'https://animego.me/player/videos/1618': () => new Promise(resolve => { releaseSlow = () => resolve(episodeVideos(1618)); }),
            'https://animego.me/player/videos/1619': episodeVideos(1619)
        });
        const raceContainer = raceWindow.document.getElementById('player');
        const slow = racing.renderPlayer(raceContainer, episodes, { episode: 1 });
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(await racing.renderPlayer(raceContainer, episodes, { episode: 2 }), true);
        releaseSlow();
        assert.equal(await slow, false);
        assert.match(raceContainer.querySelector('iframe').getAttribute('src'), /seria\/1619\//);
    }

    // 5b. Dub state for the host selector, explicit dub choice, fillers.
    {
        const { parser, window } = createParser({
            'https://animego.me/player/videos/1619': episodeVideos(1619),
            'https://animego.me/player/videos/1618': { status: 'success', data: { content: '<div></div>' } }
        });
        const episodes = [
            { type: 'animego-episode', url: 'https://animego.me/player/videos/1618', episodeId: '1618', episodeNumber: 1, animeId: '103', filler: false },
            { type: 'animego-episode', url: 'https://animego.me/player/videos/1619', episodeId: '1619', episodeNumber: 2, animeId: '103', filler: true }
        ];
        const container = window.document.getElementById('player');

        await parser.renderPlayer(container, episodes, { episode: 2 });
        let state = container.__providerDubState;
        assert.equal(state.providerId, 'animego');
        assert.equal(state.contextId, '103');
        assert.equal(state.episodeNumber, 2);
        assert.deepEqual(JSON.parse(JSON.stringify(state.translations)), [{ id: '9', name: '2x2' }, { id: '1', name: 'AniDUB' }]);
        assert.equal(state.activeTranslationId, '9');

        parser.setPreferredTranslation('103', '1');
        await parser.renderPlayer(container, episodes, { episode: 2 });
        state = container.__providerDubState;
        assert.equal(state.activeTranslationId, '1');
        assert.match(container.querySelector('iframe').getAttribute('src'), /dub1/);

        // A failed episode clears the published state so the selector hides.
        await parser.renderPlayer(container, episodes, { episode: 1 });
        assert.equal(container.__providerDubState, undefined);

        assert.deepEqual(Array.from(parser.getFillerEpisodeNumbers(episodes)), [2]);

        // Films apply the chosen dub too.
        const film = [
            { name: 'a', url: 'https://kodikplayer.com/video/1/a/720p', type: 'iframe', translationId: '2', translation: 'AniLibria', animeId: '385' },
            { name: 'b', url: 'https://kodikplayer.com/video/1/b/720p', type: 'iframe', translationId: '3', translation: 'AniDUB', animeId: '385' }
        ];
        parser.setPreferredTranslation('385', '3');
        assert.equal(await parser.renderPlayer(container, film, {}), true);
        assert.match(container.querySelector('iframe').getAttribute('src'), /video\/1\/b\//);
        assert.equal(container.__providerDubState.activeTranslationId, '3');
    }

    // 5b2. Native playback: the Kodik stream plays in the extension player,
    //      dub/quality are exposed to its settings menu, iframes stay fallbacks.
    {
        const nativeRoutes = {
            'https://animego.me/player/videos/1619': episodeVideos(1619),
            'https://kodikplayer.com/seria/1619/dub9/720p': kodikPage('dub9'),
            'https://kodikplayer.com/seria/1619/dub1/720p': kodikPage('dub1'),
            'https://kodikplayer.com/ftor': kodikFtor
        };
        const { parser, window, requests } = createParser(nativeRoutes, { native: true });
        const episodes = [
            { type: 'animego-episode', url: 'https://animego.me/player/videos/1619', episodeId: '1619', episodeNumber: 2, animeId: '103' }
        ];
        const container = window.document.getElementById('player');
        const tick = () => new Promise(resolve => setTimeout(resolve, 0));

        assert.equal(await parser.renderPlayer(container, episodes, { episode: 2 }), true);
        const video = container.querySelector('video');
        assert.ok(video, 'the Kodik stream mounts in the extension video player');
        assert.equal(container.querySelector('iframe'), null);
        assert.equal(window.__hlsCreated.at(-1).url, 'https://cloud.solodcdn.com/dub9/720.mp4:hls:manifest.m3u8',
            'best quality of the preferred dub');
        assert.equal(video.dataset.playerProvider, 'animego');
        requests.filter(request => request.url.startsWith('https://kodikplayer.com/')).forEach(request => {
            assert.equal(request.options.referrerPolicy, 'no-referrer');
        });

        const state = container.__animegoNativeState;
        assert.deepEqual(Array.from(state.mountSources, source => source.type), ['hls', 'iframe', 'iframe'],
            'provider iframes stay as runtime fallbacks');
        assert.equal(container.__providerDubState, undefined, 'the toolbar dub selector stays hidden');

        const voiceItems = () => Array.from(container.querySelectorAll('[data-player-voiceover-source] [data-voiceover-option]'));
        const qualityItems = () => Array.from(container.querySelectorAll('[data-player-quality-source] [data-quality-option]'));
        assert.deepEqual(voiceItems().map(item => item.textContent), ['2x2', 'AniDUB']);
        assert.equal(voiceItems().find(item => item.classList.contains('active')).dataset.voiceoverOption, '9');
        assert.deepEqual(qualityItems().map(item => item.textContent), ['720p', '480p']);
        assert.equal(container.querySelector('[data-animego-bridge]').hidden, true);

        // Quality: swap in place and resume from the same position.
        let played = false;
        Object.defineProperty(video, 'currentTime', { value: 42, writable: true, configurable: true });
        Object.defineProperty(video, 'paused', { value: false, configurable: true });
        Object.defineProperty(video, 'duration', { value: 1400, configurable: true });
        video.play = () => { played = true; return Promise.resolve(); };
        const first = window.__hlsCreated.at(-1);
        qualityItems()[1].click();
        assert.equal(first.destroyed, true, 'the previous stream is released');
        assert.equal(window.__hlsCreated.at(-1).url, 'https://cloud.solodcdn.com/dub9/480.mp4:hls:manifest.m3u8');
        assert.equal(container.querySelector('video'), video, 'the same video element (and player chrome) is kept');
        video.currentTime = 0;
        video.dispatchEvent(new window.Event('loadedmetadata'));
        assert.equal(video.currentTime, 42);
        assert.equal(played, true);
        assert.equal(qualityItems().find(item => item.classList.contains('active')).textContent, '480p');

        // Dub: resolve the other embed, keep the chosen quality and position.
        voiceItems()[1].click();
        await tick(); await tick(); await tick();
        assert.equal(window.__hlsCreated.at(-1).url, 'https://cloud.solodcdn.com/dub1/480.mp4:hls:manifest.m3u8');
        assert.equal(parser._preferredTranslationByAnime.get('103'), '1');
        assert.equal(voiceItems().find(item => item.classList.contains('active')).dataset.voiceoverOption, '1');
        assert.equal(container.querySelector('video'), video);

        // A stream that fails at runtime falls back to the dub's iframe and
        // hands the dub choice back to the host toolbar.
        const dubEvents = [];
        container.addEventListener('providerdubstatechange', event => dubEvents.push(event.detail.providerId));
        window.__hlsCreated.at(-1).options.onFatal({ reason: 'source-rejected' });
        assert.deepEqual(dubEvents, ['animego'], 'the runtime fallback announces the new dub state to the host');
        assert.equal(container.querySelector('video'), null);
        assert.match(container.querySelector('iframe').getAttribute('src'), /seria\/1619\/dub1\//);
        assert.equal(container.querySelector('[data-animego-bridge]'), null);
        assert.equal(container.__providerDubState.activeTranslationId, '1');
    }

    // 5b3. Without a resolvable stream the iframe player is used as before.
    {
        const { parser, window } = createParser({
            'https://animego.me/player/videos/1619': episodeVideos(1619)
        }, { native: true });
        const container = window.document.getElementById('player');
        const episodes = [{ type: 'animego-episode', url: 'https://animego.me/player/videos/1619', episodeId: '1619', episodeNumber: 2, animeId: '103' }];
        assert.equal(await parser.renderPlayer(container, episodes, { episode: 2 }), true);
        assert.equal(container.querySelector('video'), null);
        assert.match(container.querySelector('iframe').getAttribute('src'), /dub9/);
        assert.equal(container.__providerDubState.translations.length, 2, 'the toolbar dub selector takes over');
        assert.equal(container.querySelector('[data-animego-bridge]'), null);
    }

    // 5b5. Episode selection swaps the next episode into the same player.
    {
        const { parser, window } = createParser({
            'https://animego.me/player/videos/1619': episodeVideos(1619),
            'https://animego.me/player/videos/1620': episodeVideos(1620),
            'https://kodikplayer.com/seria/1619/dub9/720p': kodikPage('e2dub9'),
            'https://kodikplayer.com/seria/1620/dub9/720p': kodikPage('e3dub9'),
            'https://kodikplayer.com/ftor': kodikFtor
        }, { native: true });
        const container = window.document.getElementById('player');
        const episodes = [
            { type: 'animego-episode', url: 'https://animego.me/player/videos/1619', episodeId: '1619', episodeNumber: 2, animeId: '103' },
            { type: 'animego-episode', url: 'https://animego.me/player/videos/1620', episodeId: '1620', episodeNumber: 3, animeId: '103' }
        ];
        assert.equal(await parser.renderPlayer(container, episodes, { episode: 2 }), true);
        const video = container.querySelector('video');
        assert.equal(video.dataset.canonicalEpisodeNav, 'true', 'series videos let the player arrows ask the host');

        let played = false;
        Object.defineProperty(video, 'currentTime', { value: 800, writable: true, configurable: true });
        Object.defineProperty(video, 'paused', { value: true, configurable: true });
        video.play = () => { played = true; return Promise.resolve(); };

        assert.equal(await parser.applyEpisodeSelection(container, { episodeNumber: 3 }), true);
        assert.equal(container.querySelector('video'), video, 'the player is kept');
        assert.equal(window.__hlsCreated.at(-1).url, 'https://cloud.solodcdn.com/e3dub9/720.mp4:hls:manifest.m3u8');
        video.dispatchEvent(new window.Event('loadedmetadata'));
        assert.equal(video.currentTime, 0, 'a new episode starts from its beginning');
        assert.equal(played, true, 'and plays');
        const state = container.__animegoNativeState;
        assert.equal(state.episodeNumber, 3);
        assert.equal(state.options.episode, 3, 'a later remount opens the new episode');
        assert.match(state.mountSources[1].url, /seria\/1620\//, 'iframe fallbacks belong to the new episode');

        assert.equal(await parser.applyEpisodeSelection(container, { episodeNumber: 3 }), true, 'the current episode is a no-op');
        assert.equal(await parser.applyEpisodeSelection(container, { episodeNumber: 7 }), false, 'unknown episodes remount');

        // Films have no host episode navigation.
        const { parser: filmParser, window: filmWindow } = createParser({
            'https://kodikplayer.com/video/1/film/720p': kodikPage('film'),
            'https://kodikplayer.com/ftor': kodikFtor
        }, { native: true });
        const filmContainer = filmWindow.document.getElementById('player');
        await filmParser.renderPlayer(filmContainer, [
            { name: 'a', url: 'https://kodikplayer.com/video/1/film/720p?movieExtensionSite=animego.me', type: 'iframe', translationId: '2', animeId: '385' }
        ], {});
        assert.equal(filmContainer.querySelector('video').dataset.canonicalEpisodeNav, undefined);
        assert.equal(await filmParser.applyEpisodeSelection(filmContainer, { episodeNumber: 1 }), false);

        // The iframe fallback has no native state: the host remounts.
        const { parser: iframeParser, window: iframeWindow } = createParser({
            'https://animego.me/player/videos/1619': episodeVideos(1619)
        }, { native: true });
        const iframeContainer = iframeWindow.document.getElementById('player');
        await iframeParser.renderPlayer(iframeContainer, episodes, { episode: 2 });
        assert.equal(await iframeParser.applyEpisodeSelection(iframeContainer, { episodeNumber: 3 }), false);
    }

    // 5b6. Seasons: AnimeGo titles per season, absolute numbering, no guessing.
    {
        const Parser = createParser({}).parser.constructor;
        const marker = Parser.buildSeasonMarker(2);
        [' 2: восстаньте из тени', ' season 2: arise', ': 2nd season', ' 2 сезон', ' (сезон 2)'.replace('(', ''), ' ii', ' второй сезон']
            .forEach(rest => assert.ok(marker.test(rest), `"${rest}" marks season 2`));
        [' 20 лет спустя', ' 12', ': ураганные хроники', ' 3', ' season 23', ' iii']
            .forEach(rest => assert.ok(!marker.test(rest), `"${rest}" is not season 2`));
        assert.ok(Parser.buildSeasonMarker(3).test(' 3rd season'));

        const seasonSearch = `<!doctype html><body>
            ${searchCard({ id: 2477, slug: 'podnyatie-urovnya-v-odinochku-s1', title: 'Поднятие уровня в одиночку', original: 'Ore dake Level Up na Ken', kind: 'Сериал', year: 2024 })}
            ${searchCard({ id: 2723, slug: 'podnyatie-urovnya-v-odinochku-2-vosstante-iz-teni-v1', title: 'Поднятие уровня в одиночку 2: Восстаньте из тени', original: 'Ore dake Level Up na Ken Season 2: Arise from the Shadow', kind: 'Сериал', year: 2025 })}
            ${searchCard({ id: 999, slug: 'podnyatie-20', title: 'Поднятие уровня в одиночку 20 лет спустя', original: 'Ore dake 20', kind: 'Сериал', year: 2025 })}
        </body>`;
        const playerJson = (count, idBase) => ({
            status: 'success',
            data: { content: `<div>${Array.from({ length: count }, (_, index) => episodeItem(index + 1, idBase + index)).join('')}</div>` }
        });
        const videosFor = id => ({
            status: 'success',
            data: { content: providerButton({ player: `//kodikplayer.com/seria/${id}/dub9/720p`, translation: '2x2', translationId: 9, provider: 'Kodik' }) }
        });
        const query = 'Поднятие уровня в одиночку';
        const routes = {
            [`https://animego.me/search/anime?q=${encodeURIComponent(query)}`]: seasonSearch,
            'https://animego.me/player/2477': playerJson(12, 5001),
            'https://animego.me/player/2723': playerJson(13, 6001),
            'https://animego.me/player/videos/5001': videosFor(5001),
            'https://animego.me/player/videos/6001': videosFor(6001),
            'https://animego.me/player/videos/6002': videosFor(6002)
        };
        const { parser, window } = createParser(routes);

        const base = await parser.search(query, 2024);
        assert.equal(base.animeId, '2477');
        assert.equal(base.seasonNumber, null);
        const second = await parser.search(query, 2024, { seasonNumber: 2 });
        assert.equal(second.animeId, '2723', 'the season 2 title, not "20 лет спустя"');
        assert.equal(second.seasonNumber, 2);
        assert.equal((await parser.search(query, 2024, { seasonNumber: 3 })).animeId, '2477',
            'without a season 3 title the base title is used');

        const baseSources = await parser.getVideoSources({ url: base.url });
        assert.equal(baseSources[0].seasonScope, null);
        assert.equal(baseSources[0].query, query, 'the query survives a URL-only source request');

        const first = await parser.resolveSeasonEpisodes(baseSources, 1);
        assert.equal(first.mode, 'direct');
        assert.equal(first.episodes.length, 12);
        const scoped = await parser.resolveSeasonEpisodes(baseSources, 2);
        assert.equal(scoped.mode, 'scoped');
        assert.equal(scoped.episodes.length, 13);
        assert.equal(scoped.episodes[0].animeId, '2723');
        assert.equal(scoped.episodes[0].seasonEpisodeNumber, 1);
        const seasonSources = await parser.getVideoSources({ url: second.url });
        assert.equal(seasonSources[0].seasonScope, 2);
        assert.equal((await parser.resolveSeasonEpisodes(seasonSources, 2)).mode, 'scoped');
        assert.equal((await parser.resolveSeasonEpisodes(seasonSources, 1)).episodes[0].animeId, '2477',
            'a season title finds its way back to season 1');
        assert.equal(await parser.resolveSeasonEpisodes(baseSources, 3), null,
            'no season title and no layout: unavailable rather than a wrong episode');
        assert.deepEqual(Array.from((await parser.resolveSeasonEpisodes(baseSources, 3, {
            canonicalSeasons: [{ seasonNumber: 1, episodeCount: 5 }, { seasonNumber: 2, episodeCount: 4 }, { seasonNumber: 3, episodeCount: 3 }]
        })).episodes, episode => [episode.seasonEpisodeNumber, episode.episodeNumber]), [[1, 10], [2, 11], [3, 12]],
        'absolute numbering across canonical seasons');
        assert.equal(await parser.resolveSeasonEpisodes(baseSources, 3, {
            canonicalSeasons: [{ seasonNumber: 1, episodeCount: 5 }, { seasonNumber: 3, episodeCount: 3 }]
        }), null, 'a gap in earlier seasons stops absolute numbering');

        const container = window.document.getElementById('player');
        assert.equal(await parser.renderPlayer(container, baseSources, { season: 2, episode: 1 }), true);
        assert.match(container.querySelector('iframe').getAttribute('src'), /seria\/6001\//, 'S2E1 plays the season 2 title');
        assert.equal(await parser.renderPlayer(container, baseSources, { season: 3, episode: 1 }), false);
        assert.match(container.textContent, /Сезон 3 недоступен на AnimeGo/);
        assert.equal(await parser.renderPlayer(container, baseSources, { season: 1, episode: 40 }), false);
        assert.match(container.textContent, /Серия 40 недоступна на AnimeGo/);

        assert.deepEqual(Array.from(await parser.getSeasonEpisodeList(baseSources, 2), ep => ep.episodeNumber).slice(0, 3), [1, 2, 3]);

        // Kinopoisk lists Solo Leveling as one 25-episode season: S1E13+
        // continue into AnimeGo's season 2 title.
        const lumped = await parser.resolveSeasonEpisodes(baseSources, 1, { canonicalSeasons: [{ seasonNumber: 1, episodeCount: 25 }] });
        assert.equal(lumped.mode, 'continued');
        assert.equal(lumped.episodes.length, 25);
        assert.deepEqual([lumped.episodes[11].animeId, lumped.episodes[11].seasonEpisodeNumber], ['2477', 12]);
        assert.deepEqual([lumped.episodes[18].animeId, lumped.episodes[18].episodeNumber, lumped.episodes[18].seasonEpisodeNumber], ['2723', 7, 19],
            'S1E19 is episode 7 of the season 2 title');
        assert.equal((await parser.resolveSeasonEpisodes(baseSources, 1, { episodeNumber: 19 })).episodes.length, 25,
            'a requested episode beyond the title continues even without a layout');
        assert.equal((await parser.resolveSeasonEpisodes(baseSources, 1)).episodes.length, 12, 'no continuation when not needed');
        routes['https://animego.me/player/videos/6007'] = videosFor(6007);
        assert.equal(await parser.renderPlayer(container, baseSources, { season: 1, episode: 19 }), true);
        assert.match(container.querySelector('iframe').getAttribute('src'), /seria\/6007\//);

        // In place across seasons: the native player switches to the other title.
        const native = createParser({
            ...routes,
            'https://kodikplayer.com/seria/5001/dub9/720p': kodikPage('s1e1'),
            'https://kodikplayer.com/seria/6002/dub9/720p': kodikPage('s2e2'),
            'https://kodikplayer.com/ftor': kodikFtor
        }, { native: true });
        const nativeBase = await native.parser.getVideoSources({ url: (await native.parser.search(query, 2024)).url });
        const nativeContainer = native.window.document.getElementById('player');
        assert.equal(await native.parser.renderPlayer(nativeContainer, nativeBase, { season: 1, episode: 1 }), true);
        assert.equal(await native.parser.applyEpisodeSelection(nativeContainer, { seasonNumber: 2, episodeNumber: 2 }), true);
        assert.equal(native.window.__hlsCreated.at(-1).url, 'https://cloud.solodcdn.com/s2e2/720.mp4:hls:manifest.m3u8');
        assert.equal(nativeContainer.__animegoNativeState.animeId, '2723');
        assert.equal(nativeContainer.__animegoNativeState.options.season, 2);
        assert.equal(await native.parser.applyEpisodeSelection(nativeContainer, { seasonNumber: 4, episodeNumber: 1 }), false,
            'an unavailable season asks the host to remount (and show the message)');
    }

    // 5b4. The player menu reads the parser bridges.
    {
        const cleaner = fs.readFileSync('content-scripts/player-cleaner.js', 'utf8');
        assert.match(cleaner, /querySelector\('\[data-player-voiceover-source\], #seasonvar-voiceover-source'\)/);
        assert.match(cleaner, /querySelectorAll\('\[data-voiceover-option\], \.seasonvar-voiceover-item'\)/);
        assert.match(cleaner, /const bridgeOptions = getBridgeQualityOptions\(\);\s*if \(bridgeOptions\.length > 0\) return bridgeOptions;/,
            'bridge qualities win over single-level HLS and DOM heuristics');
        const seasonvar = fs.readFileSync('src/shared/services/parsers/SeasonvarParser.js', 'utf8');
        assert.match(seasonvar, /id="seasonvar-voiceover-source" data-player-voiceover-source="seasonvar"/);
        for (const page of ['src/pages/movie-details/movie-details.html', 'src/pages/search/search.html']) {
            const html = fs.readFileSync(page, 'utf8');
            assert.ok(html.indexOf('parsers/KodikStreamResolver.js') > 0
                && html.indexOf('parsers/KodikStreamResolver.js') < html.indexOf('parsers/AnimeGoParser.js'),
            `${page} loads the resolver before the AnimeGo parser`);
        }
        const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
        assert.ok(manifest.host_permissions.includes('https://*.solodcdn.com/*'), 'Kodik CDN segments load from the extension page');
    }

    // 5c. MovieDetails host: dub selector and filler marks.
    {
        const source = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
        const extract = (name, nextName) => {
            const start = source.indexOf(`\n    ${name}(`);
            const end = source.indexOf(`\n    ${nextName}(`, start + 1);
            assert.ok(start > 0 && end > start, `${name} must stay extractable`);
            return source.slice(start, end);
        };
        const methods = [
            extract('refreshProviderDubSelector', 'async onProviderDubChange'),
            extract('async onProviderDubChange', 'getSourceButtonProviderKey'),
            extract('renderPickerEpisodeButtons', 'async onPickerSeasonClick')
        ].join('\n');
        const html = fs.readFileSync('src/pages/movie-details/movie-details.html', 'utf8');
        assert.match(html, /id="sourceDubControl" hidden/);
        assert.match(html, /<select class="source-toolbar__dub-select" id="sourceDubSelect"/);

        const dom = new JSDOM(`<!doctype html><body>
            <label id="sourceDubControl" hidden><select id="sourceDubSelect"></select></label>
            <div id="pickerEpisodesLabel"></div>
            <div class="player-episode-picker__search" hidden><input id="pickerEpisodeSearch"></div>
            <div id="pickerEpisodeSearchHint" hidden></div>
            <div id="pickerEpisodeRanges" hidden></div>
            <div id="pickerEpisodesList"></div><div id="player"></div></body>`, { runScripts: 'dangerously' });
        dom.window.eval(baseSource);
        dom.window.eval(parserSource);
        dom.window.eval(`const PICKER_EPISODE_RANGE_SIZE = 100; const PICKER_EPISODE_SEARCH_MIN_COUNT = 24; class Host { ${methods} } window.Host = Host;`);
        const host = new dom.window.Host();
        const doc = dom.window.document;
        const videoContainer = doc.getElementById('player');
        const animego = new dom.window.AnimeGoParser();
        const switched = [];
        host.elements = { videoContainer };
        host.parserRegistry = { get: id => (id === 'animego' ? animego : null) };
        host.changeVideoSource = async value => { switched.push(value); return true; };
        host.onPickerEpisodeClick = async () => {};

        videoContainer.__providerDubState = {
            providerId: 'animego', contextId: '103', episodeNumber: 2, activeTranslationId: '1',
            translations: [{ id: '9', name: '2x2' }, { id: '1', name: 'AniDUB' }]
        };
        host.refreshProviderDubSelector('animego');
        const control = doc.getElementById('sourceDubControl');
        const select = doc.getElementById('sourceDubSelect');
        assert.equal(control.hidden, false);
        assert.deepEqual(Array.from(select.options, option => option.textContent), ['2x2', 'AniDUB']);
        assert.equal(select.value, '1');

        select.value = '9';
        select.dispatchEvent(new dom.window.Event('change'));
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepEqual(switched, ['parser:animego'], 'changing the dub remounts the AnimeGo source');
        assert.equal(animego._preferredTranslationByAnime.get('103'), '9');

        host.refreshProviderDubSelector('kinogo');
        assert.equal(control.hidden, true, 'other providers hide the dub selector');

        // A runtime stream -> iframe fallback shows the toolbar selector without a source switch.
        host.activePlayerId = 'animego';
        videoContainer.dispatchEvent(new dom.window.CustomEvent('providerdubstatechange', { detail: { providerId: 'animego' } }));
        assert.equal(control.hidden, false, 'the fallback event reveals the selector');
        host.refreshProviderDubSelector(null);
        videoContainer.dispatchEvent(new dom.window.CustomEvent('providerdubstatechange', { detail: { providerId: 'kinogo' } }));
        assert.equal(control.hidden, true, 'events of an inactive provider are ignored');
        assert.equal(videoContainer.dataset.providerDubStateBound, 'true');
        host.activePlayerId = null;
        videoContainer.__providerDubState.translations = [{ id: '9', name: '2x2' }];
        host.refreshProviderDubSelector('animego');
        assert.equal(control.hidden, true, 'a single dub needs no selector');

        // Filler marks follow the provider's season mapping (absolute numbers
        // of one AnimeGo title spread over two canonical seasons).
        host.activePlayerId = 'animego';
        host.selectedMovie = { seasons: [{ number: 1, episodeCount: 2 }, { number: 2, episodeCount: 2 }] };
        assert.deepEqual(JSON.parse(JSON.stringify(host.getCanonicalSeasonLayout())), [
            { seasonNumber: 1, episodeCount: 2, airYear: null }, { seasonNumber: 2, episodeCount: 2, airYear: null }
        ]);
        host.playerRegistry = { animego: { sources: [1, 2, 3, 4].map(number => ({
            type: 'animego-episode', episodeNumber: number, episodeId: String(number), filler: number === 2 || number === 4
        })) } };
        const seasonTwo = await host.loadProviderSeasonEpisodes(2);
        assert.deepEqual(Array.from(seasonTwo, ep => [ep.episodeNumber, ep.filler, ep.absoluteNumber]), [[1, false, 3], [2, true, 4]]);
        host.currentEpisodeHistory = { '2:1': { cAt: 1, src: 'MANUAL' } };
        host.renderPickerEpisodeButtons([{ episodeNumber: 1, name: '1 серия' }, { episodeNumber: 2, name: '2 серия' }], 2, 2, 2);
        let buttons = doc.querySelectorAll('.picker-episode-btn');
        assert.equal(buttons[0].classList.contains('picker-episode-btn--filler'), false);
        assert.equal(buttons[1].classList.contains('picker-episode-btn--filler'), true, 'S2E2 = absolute 4 is a filler');
        assert.equal(buttons[1].getAttribute('aria-label'), 'Серия 2, филлер');
        assert.equal(buttons[1].querySelector('.picker-episode-btn__filler').textContent, 'F',
            'filler state has a non-color cue');
        assert.equal(buttons[0].classList.contains('picker-episode-btn--watched'), true);
        assert.equal(buttons[0].getAttribute('aria-label'), 'Серия 1, просмотрена');
        assert.ok(buttons[0].querySelector('.picker-episode-btn__watched svg'), 'watched state has a check mark');
        assert.equal(doc.getElementById('pickerEpisodesLabel').textContent, 'Серия 2 из 2');
        assert.equal(doc.querySelector('.player-episode-picker__search').hidden, true, 'short seasons need no search');
        assert.equal(host.getProviderFillerEpisodes(1), null, 'the cache belongs to the loaded season');
        host.activePlayerId = 'kinogo';
        assert.equal(host.getProviderFillerEpisodes(2), null);
        host.activePlayerId = 'animego';

        // Long seasons: ranges of 100, the playing range first, number search.
        const picked = [];
        host.onPickerEpisodeClick = async (episodeNumber, seasonNumber) => { picked.push([episodeNumber, seasonNumber]); };
        host.currentEpisodeHistory = {};
        host.pickerEpisodeRange = null;
        const longSeason = Array.from({ length: 250 }, (_, index) => ({ episodeNumber: index + 1, name: `${index + 1} серия` }));
        host.renderPickerEpisodeButtons(longSeason, 1, 140, 1);
        const rangeButtons = () => Array.from(doc.querySelectorAll('#pickerEpisodeRanges .picker-range-btn'));
        assert.deepEqual(rangeButtons().map(button => button.textContent), ['1–100', '101–200', '201–250']);
        assert.equal(rangeButtons()[1].getAttribute('aria-pressed'), 'true', 'the range with the playing episode opens');
        buttons = doc.querySelectorAll('#pickerEpisodesList .picker-episode-btn');
        assert.equal(buttons.length, 100);
        assert.equal(buttons[0].textContent, '101');
        assert.equal(doc.getElementById('pickerEpisodesLabel').textContent, 'Серия 140 из 250');

        rangeButtons()[2].click();
        assert.equal(doc.querySelectorAll('#pickerEpisodesList .picker-episode-btn').length, 50);
        assert.equal(doc.querySelector('#pickerEpisodesList .picker-episode-btn').textContent, '201');

        const search = doc.getElementById('pickerEpisodeSearch');
        assert.equal(doc.querySelector('.player-episode-picker__search').hidden, false);
        search.value = '37';
        search.dispatchEvent(new dom.window.Event('input'));
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(rangeButtons()[0].getAttribute('aria-pressed'), 'true', 'typing reveals the episode range');
        assert.ok(doc.querySelector('.picker-episode-btn--match[data-episode-number="37"]'));
        search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepEqual(picked, [[37, 1]], 'Enter plays the typed episode');

        search.value = '999';
        search.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(doc.getElementById('pickerEpisodeSearchHint').hidden, false);
        assert.equal(doc.getElementById('pickerEpisodeSearchHint').textContent, 'Такой серии нет');
        assert.equal(picked.length, 1, 'a missing number does not navigate');
        search.value = '';
        search.dispatchEvent(new dom.window.Event('input'));
        assert.equal(doc.getElementById('pickerEpisodeSearchHint').hidden, true);
    }

    // 6. Wiring: registry order, page scripts, manifest, and Referer rule.
    {
        const init = fs.readFileSync('src/shared/services/parsers/parser-init.js', 'utf8');
        assert.match(init, /new ParserRegistry\(\['kinogo', 'exfs', 'seasonvar', 'rutube', 'animego'\]\)/,
            'AnimeGo stays last: the Search page uses the first parser as its primary source');
        assert.match(init, /registry\.register\(new AnimeGoParser\(\)\)/);

        for (const page of ['src/pages/movie-details/movie-details.html', 'src/pages/search/search.html']) {
            const html = fs.readFileSync(page, 'utf8');
            const parserIndex = html.indexOf('parsers/AnimeGoParser.js');
            assert.ok(parserIndex > html.indexOf('parsers/BaseParserService.js'), `${page} loads AnimeGo after the base class`);
            assert.ok(parserIndex < html.indexOf('parsers/parser-init.js'), `${page} loads AnimeGo before parser-init`);
        }

        const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
        assert.ok(manifest.host_permissions.includes('https://animego.me/*'));
        assert.ok(manifest.host_permissions.includes('https://*.kodikplayer.com/*'));

        const rules = JSON.parse(fs.readFileSync('src/background/provider-embed-rules.json', 'utf8'));
        assert.equal(new Set(rules.map(rule => rule.id)).size, rules.length, 'DNR rule ids are unique');
        const rule = rules.find(candidate => candidate.action.requestHeaders?.[0]?.value === 'https://animego.me/');
        assert.ok(rule, 'Kodik frames get the AnimeGo Referer');
        assert.deepEqual(rule.condition.requestDomains, ['kodikplayer.com']);
        assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
        const filter = new RegExp(rule.condition.regexFilter);
        assert.ok(filter.test('https://kodikplayer.com/seria/1/a/720p?movieExtensionSite=animego.me'));
        assert.ok(!filter.test('https://kodikplayer.com/seria/1/a/720p?movieExtensionSite=animegoXme'));
    }

    console.log('✅ AnimeGoParser tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
