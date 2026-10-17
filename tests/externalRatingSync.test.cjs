const assert = require('node:assert/strict');
const { ExternalRatingSync, ImdbRatingSync, KinopoiskRatingSync } = require('../src/shared/services/ExternalRatingSync.js');

function createChrome({ signedIn = true } = {}) {
    const store = {};
    const openedTabs = [];
    const createdAlarms = [];
    return {
        store,
        openedTabs,
        createdAlarms,
        storage: {
            local: {
                get: async (key) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
                set: async (patch) => { Object.assign(store, structuredClone(patch)); },
                remove: async (key) => { delete store[key]; }
            }
        },
        cookies: {
            get: async ({ name }) => (signedIn && name === 'at-main' ? { name } : null)
        },
        tabs: { create: async (tab) => { openedTabs.push(tab); } },
        alarms: { create: (name, info) => { createdAlarms.push({ name, info }); } }
    };
}

function createFetch(responder) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        const body = JSON.parse(init.body);
        calls.push({ url, init, body });
        return responder(body);
    };
    return { calls, fetchImpl };
}

const ok = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
const rated = (body) => ok({ rateTitle: { rating: { value: body.variables.rating } } });

(async () => {
    // --- ID and rating normalization -------------------------------------------
    assert.equal(ImdbRatingSync.extractImdbId({ externalId: { imdb: 'tt0111161' } }), 'tt0111161');
    assert.equal(ImdbRatingSync.extractImdbId({ imdbId: ' tt1375666 ' }), 'tt1375666');
    assert.equal(ImdbRatingSync.extractImdbId({ externalId: { imdb: 'nm0000001' } }), null, 'only title IDs');
    assert.equal(ImdbRatingSync.normalizeRating('7'), 7);
    assert.equal(ImdbRatingSync.normalizeRating(7.6), 8);
    assert.equal(ImdbRatingSync.normalizeRating(0), null);
    assert.equal(ImdbRatingSync.normalizeRating(11), null);

    // --- Disabled integration never touches the network -------------------------
    {
        const chrome = createChrome();
        const { calls, fetchImpl } = createFetch(rated);
        const sync = new ImdbRatingSync({ chromeApi: chrome, fetchImpl });
        assert.deepEqual(await sync.sync({ kinopoiskId: '326', imdbId: 'tt0111161', rating: 8 }), { status: 'skipped', reason: 'disabled' });
        assert.equal(calls.length, 0);
    }

    // --- Connect: signed in enables immediately; signed out opens sign-in --------
    {
        const chrome = createChrome({ signedIn: false });
        const sync = new ImdbRatingSync({ chromeApi: chrome, fetchImpl: async () => ok({}) });
        const status = await sync.connect();
        assert.equal(status.enabled, false);
        assert.equal(status.pendingConnect, true);
        assert.equal(chrome.openedTabs[0].url, ImdbRatingSync.SIGN_IN_URL);

        // The session cookie appears after sign-in.
        chrome.cookies.get = async ({ name }) => (name === 'at-main' ? { name } : null);
        await sync.handleCookieChange({ removed: false, cookie: { name: 'at-main', domain: '.imdb.com' } });
        const after = await sync.getStatus();
        assert.equal(after.connected, true, 'sign-in completes the toggle');
        assert.equal(after.pendingConnect, false);

        await sync.disconnect();
        assert.equal((await sync.getStatus()).enabled, false, 'disconnect turns sync off');
    }

    // --- Rate, update and delete use the captured IMDb mutations ------------------
    {
        const chrome = createChrome();
        const { calls, fetchImpl } = createFetch((body) => (body.operationName === 'UpdateTitleRating'
            ? rated(body)
            : ok({ deleteTitleRating: { date: '2026-10-18' } })));
        const sync = new ImdbRatingSync({ chromeApi: chrome, fetchImpl });
        await sync.connect();

        assert.deepEqual(await sync.sync({ kinopoiskId: '326', imdbId: 'tt0111161', rating: 8 }), { status: 'synced' });
        const [call] = calls;
        assert.equal(call.url, 'https://api.graphql.imdb.com/');
        assert.equal(call.init.method, 'POST');
        assert.equal(call.init.credentials, 'include', 'the browser IMDb session authenticates');
        assert.equal(call.init.headers['x-imdb-client-name'], 'imdb-web-next-localized');
        assert.match(call.body.query, /rateTitle\(input: \{rating: \$rating, titleId: \$titleId\}\)/);
        assert.deepEqual(call.body.variables, { rating: 8, titleId: 'tt0111161' });

        // Deletion without an IMDb ID uses the remembered Kinopoisk -> IMDb mapping.
        assert.deepEqual(await sync.sync({ kinopoiskId: '326', imdbId: null, rating: null }), { status: 'synced' });
        assert.equal(calls[1].body.operationName, 'DeleteTitleRating');
        assert.deepEqual(calls[1].body.variables, { titleId: 'tt0111161' });

        assert.deepEqual(await sync.sync({ kinopoiskId: '999', imdbId: null, rating: 5 }), { status: 'skipped', reason: 'no_title_id' });
    }

    // --- Network failures queue the latest value and retry ------------------------
    {
        const chrome = createChrome();
        let failing = true;
        const { calls, fetchImpl } = createFetch((body) => (failing
            ? { ok: false, status: 503, json: async () => ({}) }
            : rated(body)));
        const sync = new ImdbRatingSync({ chromeApi: chrome, fetchImpl });
        await sync.connect();

        assert.equal((await sync.sync({ imdbId: 'tt0111161', rating: 6 })).status, 'queued');
        assert.equal((await sync.sync({ imdbId: 'tt0111161', rating: 9 })).status, 'queued');
        let queue = await sync.readQueue();
        assert.equal(queue.length, 1, 'one job per title');
        assert.equal(queue[0].rating, 9, 'the newest rating wins');
        assert.equal(chrome.createdAlarms[0].name, ImdbRatingSync.RETRY_ALARM);

        failing = false;
        await sync.flushQueue();
        queue = await sync.readQueue();
        assert.equal(queue.length, 0, 'retry drains the queue');
        assert.deepEqual(calls.at(-1).body.variables, { rating: 9, titleId: 'tt0111161' });
    }

    // --- A signed-out session turns the integration off ---------------------------
    {
        const chrome = createChrome();
        const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'Unauthorized: sign in required' }] }) });
        const sync = new ImdbRatingSync({ chromeApi: chrome, fetchImpl });
        await sync.connect();
        assert.deepEqual(await sync.sync({ imdbId: 'tt0111161', rating: 7 }), { status: 'failed', reason: 'signed_out' });
        assert.equal((await sync.getSettings()).enabled, false);
        assert.equal((await sync.readQueue()).length, 0, 'auth failures are not retried');
    }

    // --- Kinopoisk: Kinopoisk ID is the title, votes use the captured mutations ---
    {
        const chrome = createChrome();
        let profile = { userProfile: { id: { kpId: 42 } } };
        const { calls, fetchImpl } = createFetch((body) => {
            if (body.operationName === 'UserProfileModerator') return ok(profile);
            if (body.operationName === 'MovieSetVote') return ok({ movie: { vote: { set: { error: null, status: 'SUCCESS' } } } });
            return ok({ movie: { vote: { remove: { error: null, status: 'SUCCESS' } } } });
        });
        const kp = new KinopoiskRatingSync({ chromeApi: chrome, fetchImpl });
        assert.equal(KinopoiskRatingSync.SETTINGS_KEY, 'integrations_kinopoisk', 'providers keep separate settings');
        assert.equal((await kp.connect()).connected, true, 'a signed-in Kinopoisk profile connects at once');

        assert.deepEqual(await kp.sync({ kinopoiskId: '6601550', rating: 8 }), { status: 'synced' });
        const vote = calls.find(call => call.body.operationName === 'MovieSetVote');
        assert.equal(vote.url, 'https://graphql.kinopoisk.ru/graphql/?operationName=MovieSetVote');
        assert.equal(vote.init.credentials, 'include');
        assert.equal(vote.init.headers['service-id'], '25');
        assert.equal(vote.init.headers['source-id'], '1');
        assert.deepEqual(vote.body.variables, { movieId: 6601550, rate: 8 });

        assert.deepEqual(await kp.sync({ kinopoiskId: '6601550', rating: null }), { status: 'synced' });
        assert.deepEqual(calls.at(-1).body.variables, { movieId: 6601550 });
        assert.equal(calls.at(-1).body.operationName, 'MovieRemoveVote');

        // A vote error from Kinopoisk is reported, not retried.
        const failing = new KinopoiskRatingSync({ chromeApi: chrome, fetchImpl: async (url, init) => {
            const body = JSON.parse(init.body);
            return ok(body.operationName === 'UserProfileModerator' ? profile : { movie: { vote: { set: { error: { message: 'Movie not found' }, status: 'FAIL' } } } });
        } });
        assert.deepEqual(await failing.sync({ kinopoiskId: '1', rating: 5 }), { status: 'failed', reason: 'Movie not found' });

        // Signed out: connect opens the Yandex sign-in; status completes it after sign-in.
        const chrome2 = createChrome();
        profile = { userProfile: null };
        const kp2 = new KinopoiskRatingSync({ chromeApi: chrome2, fetchImpl });
        assert.equal((await kp2.connect()).pendingConnect, true);
        assert.match(chrome2.openedTabs[0].url, /^https:\/\/passport\.yandex\.ru\/auth/);
        profile = { userProfile: { id: { kpId: 42 } } };
        assert.equal((await kp2.getStatus()).connected, true);
    }

    // --- Kinopoisk requests get the site's Origin, only for this extension ---------
    {
        let update = null;
        await KinopoiskRatingSync.installRequestRules({
            runtime: { id: 'ext-id' },
            declarativeNetRequest: { updateSessionRules: async (arg) => { update = arg; } }
        });
        const [rule] = update.addRules;
        assert.deepEqual(update.removeRuleIds, [rule.id], 'the rule is replaced, not duplicated');
        assert.deepEqual(rule.condition.initiatorDomains, ['ext-id']);
        assert.equal(rule.condition.urlFilter, '||graphql.kinopoisk.ru/graphql/');
        assert.deepEqual(rule.action.requestHeaders.map(h => [h.header, h.value]),
            [['origin', 'https://www.kinopoisk.ru'], ['referer', 'https://www.kinopoisk.ru/']]);
    }

    // --- Pages send one message for every provider -----------------------------------
    {
        const sent = [];
        global.chrome = { runtime: { sendMessage: async (message) => { sent.push(message); return null; } } };
        await ExternalRatingSync.requestSync({ kinopoiskId: 326, movie: { externalId: { imdb: 'tt0111161' } }, rating: 9 });
        assert.deepEqual(sent[0], { type: 'EXTERNAL_SYNC_RATING', kinopoiskId: '326', imdbId: 'tt0111161', rating: 9 });
        delete global.chrome;
    }

    console.log('External rating sync tests passed');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
