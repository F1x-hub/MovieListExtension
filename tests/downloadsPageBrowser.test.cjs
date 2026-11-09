/**
 * Downloads page in Chromium with the real page, styles and navigation, a fake
 * local MediaPlayer and a fake TMDB proxy. Screenshots go to
 * artifacts/downloads-page/ for a person to look at; they prove layout in this
 * fixture, not the installed extension with a real MediaPlayer.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const origin = 'http://movielist.fixture';
const shots = path.join(root, 'artifacts/downloads-page');
const GB = 1024 ** 3;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const STUBBED = [/\/libs\/firebase-.*\.js$/, /\/src\/shared\/firestore\.js$/, /\/src\/shared\/services\/UserService\.js$/];
const POSTER = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function initialDownloads() {
    const base = { provider: 'Rutracker', quality: '1080p', downloadSpeedBytesPerSecond: 0, uploadSpeedBytesPerSecond: 0, peers: 0, playable: false, errorMessage: null, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z' };
    return [
        { ...base, id: uuid(1), mediaType: 'movie', tmdbId: 693134, title: 'Дюна: Часть вторая', quality: '2160p', status: 'downloading', progress: 0.63, totalBytes: 24 * GB, downloadedBytes: 15 * GB, downloadSpeedBytesPerSecond: 14_800_000, peers: 38, timeRemainingSeconds: 640, playable: true, createdAt: '2026-11-08T08:00:00.000Z', updatedAt: '2026-11-08T08:00:00.000Z' },
        { ...base, id: uuid(2), mediaType: 'tv', tmdbId: 1396, title: 'Во все тяжкие', provider: 'LostFilm', status: 'complete', progress: 1, totalBytes: 1.4 * GB, downloadedBytes: 1.4 * GB, selectedFile: { fileId: 'f1', seasonNumber: 1, episodeNumber: 1, name: 'S01E01.mkv' }, seasonNumber: 1, episodeNumber: 1, completedAt: '2026-11-05T10:00:00.000Z' },
        { ...base, id: uuid(3), mediaType: 'tv', tmdbId: 1396, title: 'Во все тяжкие', provider: 'LostFilm', status: 'downloading', progress: 0.22, totalBytes: 1.4 * GB, downloadedBytes: 0.3 * GB, downloadSpeedBytesPerSecond: 3_800_000, peers: 12, timeRemainingSeconds: 300, selectedFile: { fileId: 'f2', seasonNumber: 1, episodeNumber: 2, name: 'S01E02.mkv' }, seasonNumber: 1, episodeNumber: 2 },
        { ...base, id: uuid(4), mediaType: 'movie', tmdbId: 872585, title: 'Оппенгеймер', provider: 'Kinozal', status: 'paused', progress: 0.41, totalBytes: 15 * GB, downloadedBytes: 6.1 * GB },
        { ...base, id: uuid(5), mediaType: 'movie', tmdbId: 335984, title: 'Бегущий по лезвию 2049', provider: 'Rutor', status: 'error', progress: 0.08, totalBytes: 12.7 * GB, downloadedBytes: 1 * GB, errorMessage: 'Нет доступа к папке загрузок.' },
        { ...base, id: uuid(6), mediaType: 'movie', tmdbId: 157336, title: 'Интерстеллар', status: 'complete', progress: 1, totalBytes: 14.6 * GB, downloadedBytes: 14.6 * GB, completedAt: '2026-11-03T10:00:00.000Z' },
        { ...base, id: uuid(7), mediaType: 'movie', tmdbId: null, title: 'Planet.Earth.III.2023.1080p.WEB-DL', provider: 'Rutor', status: 'complete', progress: 1, totalBytes: 4.2 * GB, downloadedBytes: 4.2 * GB }
    ];
}

const TMDB = {
    'movie/693134': { id: 693134, title: 'Дюна: Часть вторая', original_title: 'Dune: Part Two', release_date: '2024-02-27', poster_path: '/dune.jpg' },
    'tv/1396': { id: 1396, name: 'Во все тяжкие', original_name: 'Breaking Bad', first_air_date: '2008-01-20', poster_path: '/bb.jpg' },
    'movie/872585': { id: 872585, title: 'Оппенгеймер', original_title: 'Oppenheimer', release_date: '2023-07-19', poster_path: '/opp.jpg' },
    'movie/335984': { id: 335984, title: 'Бегущий по лезвию 2049', original_title: 'Blade Runner 2049', release_date: '2017-10-04', poster_path: null },
    'movie/157336': { id: 157336, title: 'Интерстеллар', original_title: 'Interstellar', release_date: '2014-11-05', poster_path: '/inter.jpg' }
};

// Interstellar was opened on its film page in this browser: a verified mapping and its card stay.
const KNOWN_FILM_STORAGE = {
    tmdb_kp_mapping_cache_v2: {
        'movie:157336': { tmdbId: 157336, mediaType: 'movie', kpId: 258687, status: 'resolved', identityStatus: 'VERIFIED', verificationMethod: 'exact_external_tmdb', verificationSource: 'automatic', resolutionSource: 'automatic' }
    },
    local_movie_cache_258687: {
        id: '258687', kinopoiskId: 258687, name: 'Интерстеллар', alternativeName: 'Interstellar', year: 2014,
        posterUrl: 'https://avatars.mds.yandex.net/get-kinopoisk-image/fixture/600x900',
        posterPreviewUrl: 'https://avatars.mds.yandex.net/get-kinopoisk-image/fixture/300x450'
    }
};

async function mount(browser, { theme = 'dark', width = 1280, height = 1000, enabled = true, serviceDown = false, tmdbDown = false, storage = {} } = {}) {
    const page = await browser.newPage({ viewport: { width, height } });
    const state = { downloads: initialDownloads(), requests: [], serviceDown, errors: [], tmdbRequests: 0 };
    page.on('pageerror', error => state.errors.push(error.message));

    await page.route(`${origin}/**`, async (route) => {
        const url = new URL(route.request().url());
        if (STUBBED.some(pattern => pattern.test(url.pathname))) {
            return route.fulfill({ contentType: 'text/javascript', body: '' });
        }
        const file = path.join(root, decodeURIComponent(url.pathname));
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            return route.fulfill({ status: 404, body: '' });
        }
        return route.fulfill({ contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    });
    await page.route('http://127.0.0.1:3000/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        state.requests.push(`${request.method()} ${url.pathname}`);
        if (state.serviceDown) return route.abort('connectionrefused');
        if (url.pathname === '/api/downloads' && request.method() === 'GET') {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ downloads: state.downloads }) });
        }
        if (url.pathname === '/api/settings') {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ torrentRetentionDays: 7, options: [0, 1, 3, 7, 14, 30], storage: { supported: true, downloadPath: 'D:\\Media\\Фильмы и сериалы', defaultDownloadPath: 'C:\\MediaPlayer\\downloads' } }) });
        }
        const match = url.pathname.match(/^\/api\/downloads\/([^/]+)(?:\/(pause|resume))?$/);
        if (match) {
            const record = state.downloads.find(item => item.id === match[1]);
            if (!record) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
            if (request.method() === 'DELETE') {
                state.downloads = state.downloads.filter(item => item.id !== record.id);
                return route.fulfill({ status: 204, body: '' });
            }
            record.status = match[2] === 'pause' ? 'paused' : 'downloading';
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(record) });
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await page.route('https://us-central1-movielistdb-13208.cloudfunctions.net/**', (route) => {
        state.tmdbRequests += 1;
        // What the proxy answers while its project cannot start an instance.
        if (tmdbDown) return route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Error: Server Error</h1>' });
        const target = new URL(new URL(route.request().url()).searchParams.get('url'));
        const key = target.pathname.replace(/^\/3\//, '');
        const body = TMDB[key];
        return route.fulfill(body
            ? { contentType: 'application/json', body: JSON.stringify(body) }
            : { status: 404, contentType: 'application/json', body: '{}' });
    });
    await page.route('https://image.tmdb.org/**', route => route.fulfill({ contentType: 'image/png', body: POSTER }));
    await page.route('https://avatars.mds.yandex.net/**', route => route.fulfill({ contentType: 'image/png', body: POSTER }));

    await page.addInitScript(({ theme, enabled, origin, storage }) => {
        localStorage.setItem('movieExtensionTheme', theme);
        const values = {
            ...storage,
            mediaPlayerEnabled: enabled,
            mediaplayer_setup_v1: enabled
                ? { enabled: true, status: 'ready', installPath: 'C:\\Fixture\\MediaPlayer', checks: [] }
                : { enabled: false, status: 'disabled' },
            mediaplayer_device_token_v1: 'fixture-token'
        };
        const listeners = [];
        const local = {
            get(keys, callback) {
                const list = keys == null ? Object.keys(values) : (Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys)));
                const result = Object.fromEntries(list.filter(key => key in values).map(key => [key, values[key]]));
                if (callback) { callback(result); return undefined; }
                return Promise.resolve(result);
            },
            set(next, callback) {
                const changes = {};
                Object.entries(next).forEach(([key, value]) => { changes[key] = { oldValue: values[key], newValue: value }; values[key] = value; });
                listeners.forEach(listener => listener(changes, 'local'));
                callback?.();
                return Promise.resolve();
            },
            remove(keys, callback) {
                (Array.isArray(keys) ? keys : [keys]).forEach(key => delete values[key]);
                callback?.();
                return Promise.resolve();
            }
        };
        window.__fixtureStorage = { values, set: local.set };
        window.chrome = {
            storage: { local, sync: local, onChanged: { addListener: listener => listeners.push(listener), removeListener() {} } },
            runtime: {
                lastError: undefined,
                id: 'fixture',
                getURL: (value) => `${origin}/${String(value).replace(/^\//, '')}`,
                getManifest: () => ({ version: '1.5.2' }),
                sendMessage: (_message, callback) => callback?.({}),
                onMessage: { addListener() {} },
                sendNativeMessage: (_host, _message, callback) => callback?.({ success: false })
            },
            i18n: { getUILanguage: () => 'ru' }
        };
    }, { theme, enabled, origin, storage });

    await page.goto(`${origin}/src/pages/downloads/downloads.html`);
    return { page, state };
}

async function settle(page) {
    await page.waitForFunction(() => {
        const loader = document.getElementById('downloadsLoader');
        return loader && loader.hidden;
    }, null, { timeout: 15000 });
    await page.waitForTimeout(300);
}

(async () => {
    fs.mkdirSync(shots, { recursive: true });
    const browser = await chromium.launch();
    try {
        // ---------- Connected, dark ----------
        let { page, state } = await mount(browser, { theme: 'dark' });
        await settle(page);
        await page.waitForFunction(() => document.querySelectorAll('.dl-poster img').length >= 3, null, { timeout: 10000 });
        assert.equal(await page.locator('#navDownloadsBtn').isVisible(), true, 'the Downloads entry shows once MediaPlayer is connected');
        assert.equal(await page.locator('#navDownloadsBtn.active').count(), 1, 'and is marked as the current page');
        assert.equal(await page.locator('.dl-card').count(), 6, 'one card per film, one for the series');
        assert.equal(await page.locator('.dl-card--series .dl-episode').count(), 2);
        assert.equal(await page.locator('[data-count="all"]').textContent(), '6');
        assert.equal(await page.locator('[data-count="active"]').textContent(), '2');
        assert.match(await page.locator('.dl-card').first().textContent(), /Дюна|Во все тяжкие/, 'active downloads first');
        assert.match(await page.locator('#downloadsSummary').textContent(), /6\s*загрузок/);
        assert.match(await page.locator('#downloadsFolderPath').textContent(), /Фильмы и сериалы/);
        assert.match(await page.locator('#downloadsRetention').textContent(), /7 дней/);
        assert.match(await page.locator('.dl-card', { hasText: 'Planet.Earth' }).textContent(), /не связано с каталогом/);
        assert.equal(await page.locator('.dl-card', { hasText: 'Planet.Earth' }).locator('[data-action="play-blocked"]').getAttribute('aria-disabled'), 'true');
        assert.equal(await page.locator('.dl-card', { hasText: 'Бегущий' }).locator('.dl-live[data-state="error"]').count(), 1);
        await page.screenshot({ path: path.join(shots, 'dark-1280.png'), fullPage: true });

        // Polling keeps the focused control focused.
        const pause = page.locator(`[data-action="pause"][data-id="${uuid(1)}"]`);
        await pause.focus();
        await page.waitForTimeout(2900);
        assert.equal(await page.evaluate(() => document.activeElement?.dataset?.focusKey), `pause:${uuid(1)}`, 'polling does not steal focus');

        // Filter.
        await page.locator('[data-filter="active"]').click();
        assert.equal(await page.locator('#downloadsTitle').textContent(), 'Качаются');
        assert.equal(await page.locator('.dl-card').count(), 2);
        assert.equal(await page.locator('.dl-card--series .dl-episode').count(), 1, 'a filtered series shows only matching episodes');
        await page.locator('[data-filter="all"]').click();

        // Search by the original TMDB title.
        await page.locator('#downloadsSearch').fill('oppenheimer');
        assert.equal(await page.locator('.dl-card').count(), 1);
        await page.locator('#downloadsSearch').fill('');

        // Single pause.
        await page.locator(`[data-action="pause"][data-id="${uuid(1)}"]`).click();
        await page.waitForFunction((id) => document.querySelector(`.dl-live[data-id="${id}"]`)?.dataset.state === 'paused', uuid(1));
        assert.ok(state.requests.includes(`POST /api/downloads/${uuid(1)}/pause`));

        // Selection and bulk delete.
        await page.locator(`input[data-select="${uuid(4)}"]`).check();
        await page.locator(`input[data-select="${uuid(6)}"]`).check();
        assert.equal(await page.locator('#downloadsBulkBar').isVisible(), true);
        assert.match(await page.locator('#downloadsBulkCount').textContent(), /Выбрано: 2/);
        assert.equal(await page.locator('#downloadsSelectAll').evaluate(node => node.indeterminate), true);
        await page.screenshot({ path: path.join(shots, 'dark-selection.png') });
        await page.locator('#downloadsBulkDelete').click();
        await page.locator('.confirm-dialog').waitFor();
        assert.match(await page.locator('.confirm-dialog').textContent(), /Удалить 2 загрузки\?/);
        await page.screenshot({ path: path.join(shots, 'dark-confirm.png') });
        await page.locator('[data-confirm-dialog="confirm"]').click();
        await page.waitForFunction(() => document.querySelectorAll('.dl-card').length === 4);
        assert.ok(state.requests.includes(`DELETE /api/downloads/${uuid(4)}`));
        assert.ok(state.requests.includes(`DELETE /api/downloads/${uuid(6)}`));
        assert.equal(await page.locator('#downloadsBulkBar').isVisible(), false, 'the bar leaves with the selection');

        // Select all, then Escape clears.
        await page.locator('#downloadsSelectAll').check();
        assert.match(await page.locator('#downloadsBulkCount').textContent(), /Выбрано: 5/, 'all shown records, episodes included');
        await page.locator('body').press('Escape');
        assert.equal(await page.locator('#downloadsBulkBar').isVisible(), false);

        // «Смотреть» opens the film page on that copy.
        const navigation = page.waitForRequest(request => request.url().includes('movie-details.html'));
        await page.locator(`.dl-episode[data-id="${uuid(2)}"] [data-action="play"]`).click();
        const target = new URL((await navigation).url());
        assert.equal(target.searchParams.get('torrentDownload'), uuid(2));
        assert.equal(target.searchParams.get('resolveTmdbId'), '1396');
        assert.equal(target.searchParams.get('mediaType'), 'tv');
        assert.equal(target.searchParams.get('torrentSeason'), '1');
        assert.equal(target.searchParams.get('torrentEpisode'), '1');
        assert.equal(target.searchParams.get('originalTitle'), 'Breaking Bad');
        assert.deepEqual(state.errors, [], `no page errors: ${state.errors.join(' | ')}`);
        await page.close();

        // ---------- TMDB down, one film known in this browser ----------
        ({ page, state } = await mount(browser, { theme: 'dark', tmdbDown: true, storage: KNOWN_FILM_STORAGE }));
        await settle(page);
        const known = page.locator('.dl-card', { hasText: 'Интерстеллар' });
        await known.locator('.dl-poster img').waitFor({ timeout: 10000 });
        assert.ok(state.tmdbRequests > 0, 'TMDB is asked first');
        assert.equal(await known.locator('.dl-poster img').getAttribute('src'),
            KNOWN_FILM_STORAGE.local_movie_cache_258687.posterPreviewUrl, "the film's own card lends its poster");
        assert.match(await known.textContent(), /2014/, 'and its year');
        assert.equal(await page.locator('.dl-poster img').count(), 1, 'films unknown here keep the placeholder');
        const knownLink = new URL(await known.locator('.dl-card__title a').getAttribute('href'));
        assert.equal(knownLink.searchParams.get('movieId'), '258687', 'a known film opens by its Kinopoisk ID');
        assert.equal(knownLink.searchParams.has('resolveTmdbId'), false);
        const unknownLink = new URL(await page.locator('.dl-card', { hasText: 'Оппенгеймер' }).locator('.dl-card__title a').getAttribute('href'));
        assert.equal(unknownLink.searchParams.get('resolveTmdbId'), '872585', 'an unknown one is still looked up on its page');
        await page.waitForTimeout(600);
        assert.equal(await page.evaluate(() => Object.keys(window.__fixtureStorage.values.downloads_tmdb_meta_v1 || {}).length), 0,
            'a borrowed card is not kept, so TMDB is asked again next visit');
        assert.deepEqual(state.errors, [], `no page errors: ${state.errors.join(' | ')}`);
        await page.screenshot({ path: path.join(shots, 'dark-tmdb-down.png'), fullPage: true });
        const knownNavigation = page.waitForRequest(request => request.url().includes('movie-details.html'));
        await known.locator('[data-action="play"]').click();
        const knownTarget = new URL((await knownNavigation).url());
        assert.equal(knownTarget.searchParams.get('movieId'), '258687', '«Смотреть» opens the known film by its Kinopoisk ID');
        assert.equal(knownTarget.searchParams.get('torrentDownload'), uuid(6), 'on that copy');
        assert.equal(knownTarget.searchParams.has('resolveTmdbId'), false);
        await page.close();

        // ---------- Light theme, narrow ----------
        ({ page, state } = await mount(browser, { theme: 'light', width: 1280 }));
        await settle(page);
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(shots, 'light-1280.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll at 390px');
        await page.screenshot({ path: path.join(shots, 'light-390.png'), fullPage: true });
        assert.deepEqual(state.errors, []);
        await page.close();

        // ---------- Service down ----------
        ({ page, state } = await mount(browser, { theme: 'dark', serviceDown: true }));
        await settle(page);
        assert.equal(await page.locator('#downloadsBanner').isVisible(), true, 'says MediaPlayer does not answer');
        assert.match(await page.locator('#downloadsBanner').textContent(), /MediaPlayer не отвечает/);
        assert.equal(await page.locator('.dl-card').count(), 0);
        assert.equal(await page.locator('#navDownloadsBtn').isVisible(), true, 'a connected setup keeps its entry while the service is down');
        state.serviceDown = false;
        await page.locator('#downloadsRetryBtn').click();
        await page.waitForFunction(() => document.querySelectorAll('.dl-card').length === 6);
        state.serviceDown = true;
        await page.evaluate(() => window.downloadsPage.refreshNow());
        await page.waitForFunction(() => !document.getElementById('downloadsBanner').hidden);
        assert.equal(await page.locator('.dl-card').count(), 6, 'the last list stays');
        assert.equal(await page.locator(`[data-action="pause"][data-id="${uuid(1)}"]`).isDisabled(), true, 'actions wait for the service');
        assert.match(await page.locator('.dl-card').first().textContent(), /данные устарели/);
        await page.screenshot({ path: path.join(shots, 'dark-service-down.png') });
        await page.close();

        // ---------- Not connected ----------
        ({ page, state } = await mount(browser, { theme: 'dark', enabled: false }));
        await page.waitForFunction(() => !document.getElementById('downloadsEmpty').hidden);
        assert.match(await page.locator('#downloadsEmpty').textContent(), /MediaPlayer не подключён/);
        await page.waitForSelector('#navDownloadsBtn', { state: 'attached' });
        assert.equal(await page.locator('#navDownloadsBtn').isVisible(), false, 'no Downloads entry without MediaPlayer');
        assert.equal(state.requests.length, 0, 'nothing asks MediaPlayer when it is not connected');
        await page.screenshot({ path: path.join(shots, 'dark-not-connected.png') });
        // Connecting MediaPlayer in another tab brings the entry and the list.
        await page.evaluate(() => window.__fixtureStorage.set({
            mediaPlayerEnabled: true,
            mediaplayer_setup_v1: { enabled: true, status: 'ready', installPath: 'C:\\Fixture\\MediaPlayer', checks: [] }
        }));
        await page.waitForFunction(() => document.querySelectorAll('.dl-card').length === 6);
        assert.equal(await page.locator('#navDownloadsBtn').isVisible(), true);
        assert.deepEqual(state.errors, []);
        await page.close();

        console.log(`downloadsPageBrowser tests passed; screenshots in ${path.relative(root, shots)}`);
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
