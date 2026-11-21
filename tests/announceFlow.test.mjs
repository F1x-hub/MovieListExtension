import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runAnnounce } from '../src/pages/movie-details/announce-stamp/announceFlow.js';

const movie = { kinopoiskId: 1, name: 'Зелёная книга', year: 2018, posterUrl: 'https://image.tmdb.org/t/p/w500/x.jpg', description: 'Описание фильма' };
const base = { movie, date: '2026-11-21', time: '20:00', scheduledAt: Date.UTC(2026, 10, 21, 17), rawDateStr: '21.11.2026, 20:00' };

function spies() {
    const calls = { scene: [], send: [], encode: 0, hidden: [] };
    return {
        calls,
        sendMessage: async (message) => { calls.send.push(message); return { success: true }; },
        encodeImage: async () => { calls.encode++; return { data: '/9j/4A==', contentType: 'image/jpeg' }; },
        onHiddenResult: result => calls.hidden.push(result)
    };
}

// The scene's onSend sends SCHEDULE_ANNOUNCE with the stamped image.
{
    const s = spies();
    const outcome = await runAnnounce({
        ...base, ...s,
        playScene: async (options) => {
            assert.equal(options.posterUrl, movie.posterUrl);
            assert.equal(options.date, base.date);
            assert.equal(options.time, base.time);
            const result = await options.onSend(new Blob(['x'], { type: 'image/jpeg' }));
            assert.deepEqual(result, { ok: true, message: 'Анонс запланирован на 21.11.2026, 20:00' });
            return { status: 'sent', blob: null };
        }
    });
    assert.equal(outcome.status, 'sent');
    assert.equal(s.calls.send.length, 1);
    assert.deepEqual(s.calls.send[0], {
        type: 'SCHEDULE_ANNOUNCE', movie, scheduledAt: base.scheduledAt, rawDateStr: base.rawDateStr,
        stampImage: { data: '/9j/4A==', contentType: 'image/jpeg' }
    });
    assert.deepEqual(s.calls.hidden, []);
}

// A refused send comes back as an error the scene shows.
{
    const s = spies();
    s.sendMessage = async () => ({ success: false, error: 'Бот недоступен' });
    await runAnnounce({
        ...base, ...s,
        playScene: async (options) => {
            assert.deepEqual(await options.onSend(null), { ok: false, error: 'Бот недоступен' });
            return { status: 'failed', blob: null };
        }
    });
}

// A send that finishes after the scene closed is reported through onHiddenResult.
{
    const s = spies();
    let onSend;
    await runAnnounce({ ...base, ...s, playScene: async (options) => { onSend = options.onSend; return { status: 'sending', blob: null }; } });
    const result = await onSend(null);
    assert.equal(result.ok, true);
    assert.equal(s.calls.send[0].stampImage, undefined, 'no image, no stampImage');
    assert.equal(s.calls.hidden.length, 1);
}

// Page wiring: «Запланировать» is the only way into the scene; the temporary «Тест» button is gone.
const page = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');
assert.match(page, /'sendAnnounceBtn'\)\?\.addEventListener\('click', \(\) => this\.sendAnnounce\(\)\)/);
assert.doesNotMatch(page, /testAnnounceBtn|dryRun/);
assert.doesNotMatch(fs.readFileSync('src/pages/movie-details/movie-details.html', 'utf8'), /testAnnounceBtn/);

console.log('announceFlow tests passed');
