const assert = require('node:assert/strict');
const { KodikStreamResolver } = require('../src/shared/services/parsers/KodikStreamResolver.js');

console.log('🧪 Running KodikStreamResolver tests...');

// Inverse of Kodik's obfuscation: base64, then shift letters back by 18.
function encodeSource(url) {
    return Buffer.from(url, 'binary').toString('base64').replace(/[a-zA-Z]/g, char => {
        const base = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(((char.charCodeAt(0) - base - 18 + 26) % 26) + base);
    });
}

const embed = 'https://kodikplayer.com/seria/476323/b7ceac/720p?translations=false&min_age=16&movieExtensionSite=animego.me';
const pageUrl = 'https://kodikplayer.com/seria/476323/b7ceac/720p?translations=false&min_age=16';
const page = `<html><script>
    var urlParams = '{"d":"kodikplayer.com","d_sign":"abc:1","pd":"kodikplayer.com","pd_sign":"def:1","ref":"","ref_sign":"ghi:1","translations":false,"min_age":16}';
    vInfo = {};
    vInfo.type = 'seria';
    vInfo.hash = 'b7ceac';
    vInfo.id = '476323';
</script></html>`;
const cdn = quality => `//cloud.solodcdn.com/useruploads/x/${quality}.mp4:hls:manifest.m3u8`;
const ftor = {
    links: {
        360: [{ src: encodeSource(cdn(360)), type: 'application/x-mpegURL' }],
        720: [{ src: encodeSource(cdn(720)), type: 'application/x-mpegURL' }],
        480: [{ src: encodeSource(cdn(480)), type: 'application/x-mpegURL' }]
    }
};

(async () => {
    // 1. Decoding and parsing helpers.
    assert.equal(KodikStreamResolver.decodeSource(encodeSource(cdn(720))), cdn(720));
    assert.equal(KodikStreamResolver.decodeSource('https://plain.example/a.m3u8'), 'https://plain.example/a.m3u8',
        'plain URLs pass through');

    assert.equal(KodikStreamResolver.toPageUrl(embed), pageUrl, 'the Referer-rule marker is stripped');
    assert.equal(KodikStreamResolver.toPageUrl('//kodikplayer.com/video/1/a/720p'), 'https://kodikplayer.com/video/1/a/720p');
    assert.equal(KodikStreamResolver.toPageUrl('https://evil.example/seria/1'), null);
    assert.equal(KodikStreamResolver.toPageUrl('not a url'), null);

    const info = KodikStreamResolver.parseEmbedPage(page);
    assert.deepEqual({ type: info.type, hash: info.hash, id: info.id }, { type: 'seria', hash: 'b7ceac', id: '476323' });
    assert.equal(info.params.d_sign, 'abc:1');
    assert.throws(() => KodikStreamResolver.parseEmbedPage('<html>Извините, но данной страницы не существует</html>'),
        /no player parameters/);

    const body = KodikStreamResolver.buildFtorBody(info);
    assert.equal(body.get('d_sign'), 'abc:1');
    assert.equal(body.get('translations'), 'false');
    assert.equal(body.get('hash'), 'b7ceac');
    assert.equal(body.get('id'), '476323');
    assert.equal(body.get('type'), 'seria');

    const streams = KodikStreamResolver.parseLinks(ftor);
    assert.deepEqual(streams.map(stream => stream.height), [720, 480, 360], 'best quality first');
    assert.equal(streams[0].url, `https:${cdn(720)}`);
    assert.deepEqual(KodikStreamResolver.parseLinks({
        links: {
            720: [{ src: encodeSource('http://insecure.example/a.m3u8') }],
            480: [{ src: '%%%' }],
            auto: [{ src: encodeSource(cdn(1080)) }]
        }
    }), [], 'insecure, undecodable and unnumbered entries are dropped');
    assert.deepEqual(KodikStreamResolver.parseLinks({}), []);

    // 2. resolve(): request shape, caching, refresh, failures.
    const calls = [];
    let ftorResponse = ftor;
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url, init });
        if (url === pageUrl) return { ok: true, status: 200, text: async () => page };
        if (url === 'https://kodikplayer.com/ftor') return { ok: true, status: 200, json: async () => ftorResponse };
        return { ok: false, status: 404 };
    };
    const resolver = new KodikStreamResolver({ fetch: fetchImpl });
    const resolved = await resolver.resolve(embed);
    assert.deepEqual(resolved.map(stream => stream.height), [720, 480, 360]);
    assert.equal(calls.length, 2);
    calls.forEach(call => {
        assert.equal(call.init.referrerPolicy, 'no-referrer', 'Kodik rejects a foreign Referer');
        assert.equal(call.init.credentials, 'omit');
    });
    assert.equal(calls[1].init.method, 'POST');
    assert.equal(calls[1].init.headers['X-Requested-With'], 'XMLHttpRequest');
    assert.match(calls[1].init.body, /hash=b7ceac/);

    await resolver.resolve(embed);
    assert.equal(calls.length, 2, 'resolved streams are cached');
    await Promise.all([resolver.resolve(embed, { forceRefresh: true }), resolver.resolve(embed)]);
    assert.equal(calls.length, 4, 'a forced refresh requests again; a parallel call reuses it');

    ftorResponse = { links: {} };
    resolver.clearCache();
    await assert.rejects(resolver.resolve(embed), /no streams/);
    await assert.rejects(resolver.resolve('https://evil.example/x'), /Not a Kodik/);
    const failing = new KodikStreamResolver({ fetch: async () => ({ ok: false, status: 500 }) });
    await assert.rejects(failing.resolve(embed), /Kodik page failed: 500/);

    console.log('✅ KodikStreamResolver tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
