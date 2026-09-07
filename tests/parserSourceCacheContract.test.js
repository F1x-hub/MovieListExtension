const assert = require('node:assert/strict');
const { BaseParserService } = require('../src/shared/services/parsers/BaseParserService');

class FlakyParser extends BaseParserService {
    constructor() {
        super({ id: 'flaky-test', name: 'Flaky test', baseUrl: 'https://provider.test' });
        this.calls = 0;
    }

    async getVideoSources() {
        this.calls += 1;
        return this.calls === 1
            ? []
            : [{ url: 'https://cdn.test/episode.m3u8', type: 'hls' }];
    }
}

(async () => {
    const parser = new FlakyParser();
    const resultUrl = 'https://provider.test/watch/series';

    assert.deepEqual(await parser.cachedVideoSources(resultUrl), [], 'first empty discovery is returned');
    assert.deepEqual(
        await parser.cachedVideoSources(resultUrl),
        [{ url: 'https://cdn.test/episode.m3u8', type: 'hls' }],
        'second call retries instead of reusing an empty source cache'
    );
    assert.equal(parser.calls, 2, 'empty results must not be cached as successful discovery');

    assert.deepEqual(
        await parser.cachedVideoSources(resultUrl),
        [{ url: 'https://cdn.test/episode.m3u8', type: 'hls' }],
        'successful source discovery remains cached'
    );
    assert.equal(parser.calls, 2, 'non-empty results remain deduplicated by the source cache');
    console.log('✅ parser source cache contract tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
