const assert = require('assert');
const { BasePlaybackAdapter } = require('../src/shared/services/player/adapters/BasePlaybackAdapter');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter');
const { VidSrcAdapter } = require('../src/shared/services/player/adapters/VidSrcAdapter');
const { KinogoAdapter } = require('../src/shared/services/player/adapters/KinogoAdapter');
const { ExFsAdapter } = require('../src/shared/services/player/adapters/ExFsAdapter');
const { RutubeAdapter } = require('../src/shared/services/player/adapters/RutubeAdapter');
const { SeasonvarParser } = require('../src/shared/services/parsers/SeasonvarParser');

console.log('🧪 Running Player Episode Picker Provider Unification Tests...\n');

// Mock DOM container
function createMockElement(tagName = 'div') {
    const children = [];
    return {
        tagName: tagName.toUpperCase(),
        style: {},
        dataset: {},
        classList: {
            add() {},
            remove() {},
            contains() { return false; }
        },
        attributes: {},
        children,
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k] || null; },
        appendChild(child) {
            child.parentNode = this;
            children.push(child);
            return child;
        },
        removeChild(child) {
            const idx = children.indexOf(child);
            if (idx >= 0) children.splice(idx, 1);
            return child;
        },
        querySelector(sel) {
            if (sel === 'video') return children.find(c => c.tagName === 'VIDEO') || null;
            if (sel === 'iframe') return children.find(c => c.tagName === 'IFRAME') || null;
            return null;
        },
        querySelectorAll() { return []; },
        addEventListener() {},
        removeEventListener() {}
    };
}

// -------------------------------------------------------------
// Test Suite 1: Provider Capability Matrix (Parts 8-15)
// -------------------------------------------------------------
console.log('--- Test Suite 1: Provider Capability Matrix ---');
{
    const seasonvar = new SeasonvarAdapter();
    const vidsrc = new VidSrcAdapter();
    const kinogo = new KinogoAdapter();
    const exfs = new ExFsAdapter();
    const rutube = new RutubeAdapter();

    // 1. Seasonvar capabilities
    assert.equal(seasonvar.supportsDirectSeasonEpisode(), true, 'Seasonvar must support direct S/E');
    assert.equal(seasonvar.supportsEpisodePicker(), true, 'Seasonvar must support episode picker');
    assert.equal(seasonvar.supportsSeasonDiscovery(), true, 'Seasonvar must support season discovery');
    assert.equal(seasonvar.supportsEpisodeDiscovery(), true, 'Seasonvar must support episode discovery');
    assert.equal(seasonvar.supportsTitleOnlyPlayback(), false, 'Seasonvar must NOT be title-only');

    // 2. VidSrc capabilities
    assert.equal(vidsrc.supportsDirectSeasonEpisode(), true, 'VidSrc must support direct S/E');
    assert.equal(vidsrc.supportsEpisodePicker(), true, 'VidSrc must support episode picker via host metadata');
    assert.equal(vidsrc.supportsSeasonDiscovery(), false, 'VidSrc does not self-discover seasons');
    assert.equal(vidsrc.supportsEpisodeDiscovery(), false, 'VidSrc does not self-discover episodes');
    assert.equal(vidsrc.supportsTitleOnlyPlayback(), false, 'VidSrc is not title-only');

    // 3. KinoGo capabilities
    assert.equal(kinogo.supportsDirectSeasonEpisode(), false, 'KinoGo is title balancer');
    assert.equal(kinogo.supportsEpisodePicker(), true, 'KinoGo must show the canonical episode picker');
    assert.equal(kinogo.supportsTitleOnlyPlayback(), true, 'KinoGo is title-only');
    assert.equal(kinogo.supportsProviderInternalSelection(), true, 'KinoGo selects internally');

    // 4. Ex-FS capabilities
    assert.equal(exfs.supportsDirectSeasonEpisode(), false, 'Ex-FS is title balancer');
    assert.equal(exfs.supportsEpisodePicker(), true, 'Ex-FS must show the canonical episode picker');
    assert.equal(exfs.supportsTitleOnlyPlayback(), true, 'Ex-FS is title-only');

    // 5. Rutube capabilities
    assert.equal(rutube.supportsDirectSeasonEpisode(), false, 'Rutube is title search');
    assert.equal(rutube.supportsEpisodePicker(), false, 'Rutube must NOT show episode picker');
    assert.equal(rutube.supportsTitleOnlyPlayback(), true, 'Rutube is title-only');

    console.log('  ✅ Capabilities Matrix verified for Seasonvar, VidSrc, KinoGo, Ex-FS, Rutube');
}

// -------------------------------------------------------------
// Test Suite 2: Seasonvar getVideoSources URL Validation (Parts 5, 21, 22)
// -------------------------------------------------------------
console.log('\n--- Test Suite 2: Seasonvar getVideoSources URL Validation ---');
(async () => {
    const parser = new SeasonvarParser();

    // 6. Passing title instead of URL throws structured error immediately
    let threwTitleError = false;
    try {
        await parser.getVideoSources('Джек Ричер');
    } catch (err) {
        threwTitleError = true;
        assert.match(err.message, /requires an absolute http\/https URL/, 'Must reject human title');
    }
    assert.equal(threwTitleError, true, 'getVideoSources must throw when given a title');

    // 7. Relative path throws structured error immediately
    let threwRelativeError = false;
    try {
        await parser.getVideoSources('src/pages/movie-details/1209839');
    } catch (err) {
        threwRelativeError = true;
        assert.match(err.message, /requires an absolute http\/https URL/, 'Must reject relative path');
    }
    assert.equal(threwRelativeError, true, 'getVideoSources must throw when given a relative path');

    console.log('  ✅ getVideoSources strictly rejects titles and relative URLs without network attempts');

    // -------------------------------------------------------------
    // Test Suite 3: SeasonvarAdapter Safe Mount & In-Place Selection (Parts 6, 20, 23, 24, 25)
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 3: SeasonvarAdapter Mount & In-Place Selection ---');
    {
        const adapter = new SeasonvarAdapter();

        let searchCalledWith = null;
        let getVideoSourcesCalledWith = null;

        const mockParser = {
            search: async (title, kpId) => {
                searchCalledWith = title;
                return [{ title: 'Джек Ричер (3 сезон)', url: 'http://seasonvar.ru/serial-31500-Reacher.html' }];
            },
            getVideoSources: async (url) => {
                getVideoSourcesCalledWith = url;
                return [
                    { name: '1 серия', url: 'http://cdn.seasonvar.ru/s3e1.mp4' },
                    { name: '2 серия', url: 'http://cdn.seasonvar.ru/s3e2.mp4' }
                ];
            },
            renderPlayer: async (container, sources, options) => {
                container.__seasonvarPlaybackState = {
                    activeSeasonNumber: 3,
                    activeEpisodeNumber: 2,
                    episodes: [
                        { episodeNumber: 1, url: 'http://cdn.seasonvar.ru/s3e1.mp4' },
                        { episodeNumber: 2, url: 'http://cdn.seasonvar.ru/s3e2.mp4' }
                    ]
                };
                return true;
            }
        };

        const container = createMockElement('div');
        const selection = {
            kinopoiskId: '1209839',
            title: 'Джек Ричер',
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 2,
            source: 'PLAYER_PROVIDER_PICKER'
        };

        // 8. Mount when sources are not provided calls parser.search to get valid absolute URL
        await adapter.mount(container, selection, { parser: mockParser });
        assert.equal(searchCalledWith, 'Джек Ричер', 'Must search by title');
        assert.equal(getVideoSourcesCalledWith, 'http://seasonvar.ru/serial-31500-Reacher.html', 'Must pass absolute URL to getVideoSources');

        // 9. In-place applySelection for current season episode change
        let videoLoaded = false;
        let videoSrc = 'http://cdn.seasonvar.ru/s3e1.mp4';
        const mockVideo = {
            tagName: 'VIDEO',
            get src() { return videoSrc; },
            set src(v) { videoSrc = v; },
            load: () => { videoLoaded = true; },
            play: async () => {},
            pause: () => {}
        };
        container.querySelector = (sel) => (sel === 'video' ? mockVideo : null);

        const appliedInPlace = await adapter.applySelection({
            seasonNumber: 3,
            episodeNumber: 2
        }, { parser: mockParser });

        assert.equal(appliedInPlace, true, 'applySelection must return true for in-place switch');
        assert.equal(videoSrc, 'http://cdn.seasonvar.ru/s3e2.mp4', 'Video src must update directly to Episode 2');
        assert.equal(videoLoaded, true, 'Video load() must be called');

        console.log('  ✅ SeasonvarAdapter safely resolves sources and supports in-place episode selection');
    }

    // -------------------------------------------------------------
    // Test Suite 4: VidSrc Direct S/E URL Generation & applySelection (Part 12, 35)
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 4: VidSrc URL Generation & applySelection ---');
    {
        const vidsrc = new VidSrcAdapter();

        const selection = {
            imdbId: 'tt9288030',
            mediaType: 'tv-series',
            seasonNumber: 2,
            episodeNumber: 5
        };

        // 10. VidSrc builds correct S/E URL
        const url = vidsrc.buildUrl(selection);
        assert.equal(url, 'https://vidsrc-embed.ru/embed/tv?imdb=tt9288030&season=2&episode=5&autoplay=1', 'VidSrc TV URL must include exact season and episode');

        // 11. VidSrc applySelection updates iframe.src directly
        const mockIframe = { src: 'about:blank' };
        vidsrc.activeIframe = mockIframe;

        const applied = await vidsrc.applySelection(selection);
        assert.equal(applied, true, 'VidSrc applySelection must return true');
        assert.equal(mockIframe.src, url, 'VidSrc active iframe src must be updated');

        console.log('  ✅ VidSrc builds exact S/E embed URLs and applies in-place updates');
    }

    // -------------------------------------------------------------
    // Test Suite 5: KinoGo / ExFS / Rutube Safe Mount (Parts 13, 14, 15)
    // -------------------------------------------------------------
    console.log('\n--- Test Suite 5: KinoGo / ExFS / Rutube Safe Mount ---');
    {
        const kinogo = new KinogoAdapter();
        const exfs = new ExFsAdapter();
        const rutube = new RutubeAdapter();

        for (const [name, adapter] of [['KinoGo', kinogo], ['Ex-FS', exfs], ['Rutube', rutube]]) {
            let searchTitle = null;
            let sourcesUrl = null;

            const mockParser = {
                search: async (title) => {
                    searchTitle = title;
                    return [{ url: `http://${name.toLowerCase()}.com/watch/123` }];
                },
                getVideoSources: async (url) => {
                    sourcesUrl = url;
                    return [{ url: `http://${name.toLowerCase()}.com/embed/123`, type: 'iframe' }];
                },
                renderPlayer: async () => true
            };

            const container = createMockElement('div');
            await adapter.mount(container, {
                kinopoiskId: '1209839',
                title: 'Джек Ричер',
                mediaType: 'tv-series'
            }, { parser: mockParser });

            assert.equal(searchTitle, 'Джек Ричер', `${name} must search by title first`);
            assert.equal(sourcesUrl, `http://${name.toLowerCase()}.com/watch/123`, `${name} must pass absolute search URL to getVideoSources`);
        }

        console.log('  ✅ KinoGo, Ex-FS, and Rutube adapters safely search by title before fetching sources');
    }

    console.log('\n🎉 ALL Player Episode Picker Provider Unification Tests Passed Successfully!');
})();
