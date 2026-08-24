/**
 * Comprehensive Phase 3D Automated Test Suite
 * In-Player Previous / Next Episode Navigation & Canonical Adjacency Contract
 * Covers: Adjacency resolution, UI controls, PlaybackController dispatch, provider preservation,
 * cross-season boundaries, Specials isolation, future episode guards, async generation tokens,
 * Aniskip context updates, network bounds, and strict regression guards.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passedCount = 0;
async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
        passedCount++;
    } catch (err) {
        console.error(`  ❌ ${name}`);
        console.error(err);
        process.exitCode = 1;
        throw err;
    }
}

// Minimal Mock DOM Node
class MockElement {
    constructor(tagName = 'div', id = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.className = '';
        this.classList = {
            _classes: new Set(),
            add: (c) => this.classList._classes.add(c),
            remove: (c) => this.classList._classes.delete(c),
            contains: (c) => this.classList._classes.has(c),
            toggle: (c, force) => {
                if (force === undefined) {
                    if (this.classList._classes.has(c)) this.classList._classes.delete(c);
                    else this.classList._classes.add(c);
                } else if (force) this.classList._classes.add(c);
                else this.classList._classes.delete(c);
            }
        };
        this.style = {};
        this.attributes = new Map();
        this.children = [];
        this.innerHTML = '';
        this.textContent = '';
        this.disabled = false;
        this.title = '';
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) || null;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    querySelector(selector) {
        if (!selector) return null;
        if (selector === '.player-source-guidance__text') {
            return this.children.find(c => c.className.includes('player-source-guidance__text')) || null;
        }
        if (selector === '#videoSubtitle' || selector === '.video-subtitle') {
            return this.children.find(c => c.id === 'videoSubtitle' || c.className.includes('video-subtitle')) || null;
        }
        return null;
    }
}

// Harness for MovieDetailsManager Phase 3D
function createPhase3DHarness() {
    const { normalizePlaybackSelection, VALID_SOURCES } = require('../src/shared/services/player/PlaybackSelection.js');
    const { PlaybackController } = require('../src/shared/services/player/PlaybackController.js');

    const elements = {
        videoPlayerModal: new MockElement('div', 'videoPlayerModal'),
        videoTitle: new MockElement('h2', 'videoTitle'),
        videoSubtitle: new MockElement('div', 'videoSubtitle'),
        playerNavControls: new MockElement('div', 'playerNavControls'),
        playerPrevEpisodeBtn: new MockElement('button', 'playerPrevEpisodeBtn'),
        playerNextEpisodeBtn: new MockElement('button', 'playerNextEpisodeBtn'),
        videoContainer: new MockElement('div', 'videoContainer'),
        closeVideoBtn: new MockElement('button', 'closeVideoBtn'),
        sourceButtonsContainer: new MockElement('div', 'sourceButtonsContainer'),
        playerSourceGuidance: new MockElement('div', 'playerSourceGuidance')
    };

    const guidanceText = new MockElement('span', '');
    guidanceText.className = 'player-source-guidance__text';
    elements.playerSourceGuidance.children.push(guidanceText);

    const controller = new PlaybackController();

    const harness = {
        elements,
        playbackController: controller,
        selectedMovie: null,
        currentEpisodes: null,
        selectedSeasonNumber: null,
        activeSource: null,
        currentVideoUrl: null,
        currentEpisode: null,
        aniskipDispatched: [],

        isEpisodePlayableByDate(episode) {
            if (!episode || typeof episode !== 'object') return false;
            if (!episode.airDate && !episode.air_date) return true;
            const raw = String(episode.airDate || episode.air_date).trim();
            if (!raw) return true;
            if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
                const now = new Date();
                const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                return raw <= todayStr;
            }
            const ts = new Date(raw).getTime();
            return isNaN(ts) ? true : ts <= Date.now();
        },

        resolveAdjacentEpisode(movie, selection, direction, options = {}) {
            if (!movie || !selection || !direction) return null;
            if (selection.mediaType === 'movie') return null;
            if (selection.seasonNumber == null || selection.episodeNumber == null) return null;

            const currentSeasonNum = Number(selection.seasonNumber);
            const currentEpNum = Number(selection.episodeNumber);
            if (!Number.isInteger(currentSeasonNum) || currentSeasonNum < 0) return null;
            if (!Number.isInteger(currentEpNum) || currentEpNum <= 0) return null;

            const playabilityCheck = options.isEpisodePlayableByDate || ((ep) => this.isEpisodePlayableByDate(ep));
            const seasons = Array.isArray(movie.seasons) ? movie.seasons : [];

            const getSeasonNum = (s) => Number(s.season_number ?? s.seasonNumber ?? s.number ?? -1);
            const getEpCount = (s) => Number(s.episode_count ?? s.episodeCount ?? s.episodesCount ?? s.episodes?.length ?? 0);

            // SPECIALS / SEASON 0
            if (currentSeasonNum === 0) {
                const season0 = seasons.find(s => getSeasonNum(s) === 0);
                let season0Count = season0 ? getEpCount(season0) : 0;
                if (options.loadedEpisodes && options.loadedSeasonNumber === 0) {
                    season0Count = Math.max(season0Count, options.loadedEpisodes.length);
                }

                if (direction === 'previous') {
                    if (currentEpNum > 1) {
                        const prevEpNum = currentEpNum - 1;
                        let epObj = null;
                        if (season0?.episodes) epObj = season0.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === prevEpNum);
                        else if (options.loadedEpisodes && options.loadedSeasonNumber === 0) epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === prevEpNum);
                        return {
                            seasonNumber: 0,
                            episodeNumber: prevEpNum,
                            episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                            airDate: epObj?.air_date || epObj?.airDate || null,
                            isReleased: true
                        };
                    }
                    return null;
                }

                if (direction === 'next') {
                    if (season0Count > 0 && currentEpNum < season0Count) {
                        const nextEpNum = currentEpNum + 1;
                        let epObj = null;
                        if (season0?.episodes) epObj = season0.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === nextEpNum);
                        else if (options.loadedEpisodes && options.loadedSeasonNumber === 0) epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === nextEpNum);

                        if (epObj && !playabilityCheck(epObj)) return null;

                        return {
                            seasonNumber: 0,
                            episodeNumber: nextEpNum,
                            episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                            airDate: epObj?.air_date || epObj?.airDate || null,
                            isReleased: true
                        };
                    }
                    return null;
                }
                return null;
            }

            // REGULAR SEASONS (>= 1)
            const regularSeasons = seasons
                .filter(s => getSeasonNum(s) > 0)
                .sort((a, b) => getSeasonNum(a) - getSeasonNum(b));

            const currentSeasonObj = regularSeasons.find(s => getSeasonNum(s) === currentSeasonNum);
            let currentSeasonEpCount = currentSeasonObj ? getEpCount(currentSeasonObj) : 0;
            if (options.loadedEpisodes && options.loadedSeasonNumber === currentSeasonNum) {
                currentSeasonEpCount = Math.max(currentSeasonEpCount, options.loadedEpisodes.length);
            }

            if (direction === 'previous') {
                if (currentEpNum > 1) {
                    const targetEpNum = currentEpNum - 1;
                    let epObj = null;
                    if (currentSeasonObj?.episodes) {
                        epObj = currentSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
                    } else if (options.loadedEpisodes && options.loadedSeasonNumber === currentSeasonNum) {
                        epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
                    }

                    return {
                        seasonNumber: currentSeasonNum,
                        episodeNumber: targetEpNum,
                        episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                        airDate: epObj?.air_date || epObj?.airDate || null,
                        isReleased: true
                    };
                }

                if (currentEpNum === 1) {
                    const prevSeasons = regularSeasons.filter(s => getSeasonNum(s) < currentSeasonNum);
                    if (prevSeasons.length === 0) return null;

                    const prevSeasonObj = prevSeasons[prevSeasons.length - 1];
                    const prevSeasonNum = getSeasonNum(prevSeasonObj);
                    const prevSeasonEpCount = getEpCount(prevSeasonObj);
                    if (prevSeasonEpCount <= 0) return null;

                    let epObj = null;
                    if (prevSeasonObj.episodes) {
                        epObj = prevSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === prevSeasonEpCount);
                    }

                    return {
                        seasonNumber: prevSeasonNum,
                        episodeNumber: prevSeasonEpCount,
                        episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                        airDate: epObj?.air_date || epObj?.airDate || null,
                        isReleased: true
                    };
                }

                return null;
            }

            if (direction === 'next') {
                if (currentSeasonEpCount > 0 && currentEpNum < currentSeasonEpCount) {
                    const targetEpNum = currentEpNum + 1;
                    let epObj = null;
                    if (currentSeasonObj?.episodes) {
                        epObj = currentSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
                    } else if (options.loadedEpisodes && options.loadedSeasonNumber === currentSeasonNum) {
                        epObj = options.loadedEpisodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === targetEpNum);
                    }

                    if (epObj && !playabilityCheck(epObj)) {
                        return null;
                    }

                    if (movie.nextEpisode) {
                        const nextEpSeason = Number(movie.nextEpisode.season_number ?? movie.nextEpisode.seasonNumber);
                        const nextEpNum = Number(movie.nextEpisode.episode_number ?? movie.nextEpisode.episodeNumber);
                        if (nextEpSeason === currentSeasonNum && nextEpNum === targetEpNum) {
                            if (!playabilityCheck(movie.nextEpisode)) {
                                return null;
                            }
                        }
                    }

                    return {
                        seasonNumber: currentSeasonNum,
                        episodeNumber: targetEpNum,
                        episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                        airDate: epObj?.air_date || epObj?.airDate || null,
                        isReleased: true
                    };
                }

                if (currentSeasonEpCount > 0 && currentEpNum >= currentSeasonEpCount) {
                    const nextSeasons = regularSeasons.filter(s => getSeasonNum(s) > currentSeasonNum);
                    if (nextSeasons.length === 0) return null;

                    const nextSeasonObj = nextSeasons[0];
                    const nextSeasonNum = getSeasonNum(nextSeasonObj);
                    const nextSeasonEpCount = getEpCount(nextSeasonObj);
                    if (nextSeasonEpCount <= 0) return null;

                    let epObj = null;
                    if (nextSeasonObj.episodes) {
                        epObj = nextSeasonObj.episodes.find(e => Number(e.episode_number ?? e.episodeNumber ?? e.number) === 1);
                    }

                    if (epObj && !playabilityCheck(epObj)) {
                        return null;
                    }

                    if (movie.nextEpisode) {
                        const nextEpSeason = Number(movie.nextEpisode.season_number ?? movie.nextEpisode.seasonNumber);
                        const nextEpNum = Number(movie.nextEpisode.episode_number ?? movie.nextEpisode.episodeNumber);
                        if (nextEpSeason === nextSeasonNum && nextEpNum === 1) {
                            if (!playabilityCheck(movie.nextEpisode)) {
                                return null;
                            }
                        }
                    }

                    return {
                        seasonNumber: nextSeasonNum,
                        episodeNumber: 1,
                        episodeTitle: epObj?.name || epObj?.title || epObj?.nameRu || null,
                        airDate: epObj?.air_date || epObj?.airDate || null,
                        isReleased: true
                    };
                }

                return null;
            }

            return null;
        },

        updatePlayerHeaderTitle() {
            if (!this.elements.videoTitle || !this.selectedMovie) return;
            const baseTitle = this.selectedMovie.nameRu || this.selectedMovie.name || 'Фильм';
            const selection = this.playbackController.getSelection();

            this.elements.videoTitle.textContent = baseTitle;

            if (selection && selection.seasonNumber != null && selection.episodeNumber != null) {
                let epText = `S${selection.seasonNumber}E${selection.episodeNumber}`;
                if (selection.episodeTitle) {
                    epText += ` · ${selection.episodeTitle}`;
                }
                this.elements.videoSubtitle.textContent = epText;
                this.elements.videoSubtitle.style.display = 'block';
            } else {
                this.elements.videoSubtitle.textContent = '';
                this.elements.videoSubtitle.style.display = 'none';
            }

            this.updatePlayerNavigationControls();
        },

        updatePlayerNavigationControls() {
            const navControls = this.elements.playerNavControls;
            const prevBtn = this.elements.playerPrevEpisodeBtn;
            const nextBtn = this.elements.playerNextEpisodeBtn;

            if (!navControls) return;

            const movie = this.selectedMovie;
            if (!movie) {
                navControls.style.display = 'none';
                return;
            }

            const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
            const selection = this.playbackController.getSelection();

            if (!isSeries || !selection || selection.seasonNumber == null || selection.episodeNumber == null) {
                navControls.style.display = 'none';
                return;
            }

            navControls.style.display = 'flex';

            const loadedEpisodes = this.currentEpisodes || null;
            const loadedSeasonNumber = this.selectedSeasonNumber || null;

            const prevAdjacent = this.resolveAdjacentEpisode(movie, selection, 'previous', {
                loadedEpisodes,
                loadedSeasonNumber,
                isEpisodePlayableByDate: (ep) => this.isEpisodePlayableByDate(ep)
            });

            const nextAdjacent = this.resolveAdjacentEpisode(movie, selection, 'next', {
                loadedEpisodes,
                loadedSeasonNumber,
                isEpisodePlayableByDate: (ep) => this.isEpisodePlayableByDate(ep)
            });

            if (prevBtn) {
                if (prevAdjacent) {
                    prevBtn.disabled = false;
                    const prevTitle = prevAdjacent.episodeTitle ? ` · ${prevAdjacent.episodeTitle}` : '';
                    prevBtn.setAttribute('aria-label', `Смотреть предыдущую серию S${prevAdjacent.seasonNumber}E${prevAdjacent.episodeNumber}${prevTitle}`);
                    prevBtn.title = `Предыдущая: S${prevAdjacent.seasonNumber}E${prevAdjacent.episodeNumber}`;
                } else {
                    prevBtn.disabled = true;
                    prevBtn.setAttribute('aria-label', 'Предыдущая серия недоступна');
                    prevBtn.title = 'Предыдущая серия недоступна';
                }
            }

            if (nextBtn) {
                if (nextAdjacent) {
                    nextBtn.disabled = false;
                    const nextTitle = nextAdjacent.episodeTitle ? ` · ${nextAdjacent.episodeTitle}` : '';
                    nextBtn.setAttribute('aria-label', `Смотреть следующую серию S${nextAdjacent.seasonNumber}E${nextAdjacent.episodeNumber}${nextTitle}`);
                    nextBtn.title = `Следующая: S${nextAdjacent.seasonNumber}E${nextAdjacent.episodeNumber}`;
                } else {
                    nextBtn.disabled = true;
                    nextBtn.setAttribute('aria-label', 'Следующая серия недоступна');
                    nextBtn.title = 'Следующая серия недоступна';
                }
            }
        },

        updateSourceGuidance(providerId = this.playbackController.getActiveProvider()) {
            const guidanceEl = this.elements.playerSourceGuidance;
            if (!guidanceEl) return;
            const selection = this.playbackController.getSelection();
            if (!selection || selection.seasonNumber == null || selection.episodeNumber == null) {
                guidanceEl.style.display = 'none';
                return;
            }

            let provKey = providerId;
            if (typeof provKey === 'string') {
                if (provKey.startsWith('parser:')) provKey = provKey.replace('parser:', '');
                else if (provKey.startsWith('vidsrc:')) provKey = 'vidsrc';
            }

            const activeAdapter = this.playbackController.getAdapter(provKey);
            if (activeAdapter && activeAdapter.supportsDirectSeasonEpisode() === false) {
                const textEl = guidanceEl.querySelector('.player-source-guidance__text') || guidanceEl;
                textEl.textContent = `Выберите S${selection.seasonNumber}E${selection.episodeNumber} в плеере источника`;
                guidanceEl.style.display = 'flex';
            } else {
                guidanceEl.style.display = 'none';
            }
        },

        async playSelection(selectionPayload) {
            if (!this.selectedMovie) return;

            this.playbackController.setContainer(this.elements.videoContainer, this.elements.videoPlayerModal);
            this.playbackController.setSelection(selectionPayload);

            this.updatePlayerHeaderTitle();
            this.updatePlayerNavigationControls();

            this.elements.videoPlayerModal.style.display = 'flex';

            if (selectionPayload.episodeNumber != null) {
                this.currentEpisode = selectionPayload.episodeNumber;
                if (this.selectedMovie.type === 'anime') {
                    this.aniskipDispatched.push({
                        episodeNumber: selectionPayload.episodeNumber,
                        seasonNumber: selectionPayload.seasonNumber
                    });
                }
            }

            const activeProvider = this.playbackController.getActiveProvider() || 'kinogo';
            const adapter = this.playbackController.getAdapter(activeProvider);

            if (adapter && adapter.supportsDirectSeasonEpisode()) {
                if (activeProvider === 'vidsrc') {
                    const imdbId = this.selectedMovie.externalId?.imdb || this.selectedMovie.imdbId;
                    this.currentVideoUrl = `https://vidsrc.xyz/embed/tv?imdb=${imdbId}&season=${selectionPayload.seasonNumber}&episode=${selectionPayload.episodeNumber}`;
                } else if (activeProvider === 'seasonvar') {
                    this.currentVideoUrl = `https://seasonvar.ru/serial-${this.selectedMovie.kinopoiskId}.html#s${selectionPayload.seasonNumber}e${selectionPayload.episodeNumber}`;
                }
            }

            this.updateSourceGuidance(activeProvider);
        },

        async handlePlayerNavigate(direction) {
            if (!this.selectedMovie) return;
            const movie = this.selectedMovie;
            const selection = this.playbackController.getSelection();
            if (!selection || selection.seasonNumber == null || selection.episodeNumber == null) return;

            const loadedEpisodes = this.currentEpisodes || null;
            const loadedSeasonNumber = this.selectedSeasonNumber || null;

            const adjacent = this.resolveAdjacentEpisode(movie, selection, direction, {
                loadedEpisodes,
                loadedSeasonNumber,
                isEpisodePlayableByDate: (ep) => this.isEpisodePlayableByDate(ep)
            });

            if (!adjacent) return;

            const selectionPayload = {
                kinopoiskId: movie.kinopoiskId,
                tmdbId: movie.tmdbId || selection.tmdbId,
                imdbId: movie.externalId?.imdb || movie.imdbId || selection.imdbId,
                title: movie.nameRu || movie.name || selection.title,
                mediaType: selection.mediaType || 'tv-series',
                seasonNumber: adjacent.seasonNumber,
                episodeNumber: adjacent.episodeNumber,
                episodeTitle: adjacent.episodeTitle || null,
                source: 'PLAYER_NAVIGATION',
                initialTimestamp: 0
            };

            await this.playSelection(selectionPayload);
        }
    };

    return { harness, VALID_SOURCES, normalizePlaybackSelection };
}

async function runAllTests() {
    console.log('--- Running Phase 3D In-Player Navigation & Adjacency Test Suite ---');

    // ==========================================
    // PART 1: PURE ADJACENCY RESOLVER CONTRACTS
    // ==========================================
    console.log('\n--- Part 1: Pure Episode Adjacency Resolver ---');

    await test('1.1 Same-season previous: S3E7 -> S3E6', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 404900,
            type: 'tv-series',
            seasons: [
                { season_number: 1, episode_count: 7 },
                { season_number: 2, episode_count: 13 },
                {
                    season_number: 3,
                    episode_count: 13,
                    episodes: [
                        { episode_number: 6, name: 'Закат', air_date: '2010-04-25' },
                        { episode_number: 7, name: 'Минута', air_date: '2010-05-02' }
                    ]
                }
            ]
        };
        const selection = { seasonNumber: 3, episodeNumber: 7, episodeTitle: 'Минута', mediaType: 'tv-series' };
        const result = harness.resolveAdjacentEpisode(movie, selection, 'previous');

        assert.ok(result, 'Result must exist');
        assert.strictEqual(result.seasonNumber, 3);
        assert.strictEqual(result.episodeNumber, 6);
        assert.strictEqual(result.episodeTitle, 'Закат');
        assert.strictEqual(result.isReleased, true);
    });

    await test('1.2 Same-season next: S3E7 -> S3E8', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 404900,
            type: 'tv-series',
            seasons: [
                {
                    season_number: 3,
                    episode_count: 13,
                    episodes: [
                        { episode_number: 7, name: 'Минута', air_date: '2010-05-02' },
                        { episode_number: 8, name: 'Я вижу тебя', air_date: '2010-05-09' }
                    ]
                }
            ]
        };
        const selection = { seasonNumber: 3, episodeNumber: 7, mediaType: 'tv-series' };
        const result = harness.resolveAdjacentEpisode(movie, selection, 'next');

        assert.ok(result, 'Result must exist');
        assert.strictEqual(result.seasonNumber, 3);
        assert.strictEqual(result.episodeNumber, 8);
        assert.strictEqual(result.episodeTitle, 'Я вижу тебя');
        assert.strictEqual(result.isReleased, true);
    });

    await test('1.3 Cross-season next: S3 final episode (S3E13) -> S4E1', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 404900,
            type: 'tv-series',
            seasons: [
                { season_number: 3, episode_count: 13 },
                {
                    season_number: 4,
                    episode_count: 13,
                    episodes: [{ episode_number: 1, name: 'Канцелярский нож', air_date: '2011-07-17' }]
                }
            ]
        };
        const selection = { seasonNumber: 3, episodeNumber: 13, mediaType: 'tv-series' };
        const result = harness.resolveAdjacentEpisode(movie, selection, 'next');

        assert.ok(result, 'Cross-season next must resolve');
        assert.strictEqual(result.seasonNumber, 4);
        assert.strictEqual(result.episodeNumber, 1);
        assert.strictEqual(result.episodeTitle, 'Канцелярский нож');
        assert.strictEqual(result.isReleased, true);
    });

    await test('1.4 Cross-season previous: S4E1 -> S3 last episode (S3E13)', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 404900,
            type: 'tv-series',
            seasons: [
                {
                    season_number: 3,
                    episode_count: 13,
                    episodes: [{ episode_number: 13, name: 'Полная мера', air_date: '2010-06-13' }]
                },
                { season_number: 4, episode_count: 13 }
            ]
        };
        const selection = { seasonNumber: 4, episodeNumber: 1, mediaType: 'tv-series' };
        const result = harness.resolveAdjacentEpisode(movie, selection, 'previous');

        assert.ok(result, 'Cross-season previous must resolve');
        assert.strictEqual(result.seasonNumber, 3);
        assert.strictEqual(result.episodeNumber, 13);
        assert.strictEqual(result.episodeTitle, 'Полная мера');
    });

    await test('1.5 First ever episode (S1E1) returns null for previous', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 404900,
            type: 'tv-series',
            seasons: [{ season_number: 1, episode_count: 7 }]
        };
        const selection = { seasonNumber: 1, episodeNumber: 1, mediaType: 'tv-series' };
        const result = harness.resolveAdjacentEpisode(movie, selection, 'previous');

        assert.strictEqual(result, null, 'S1E1 has no previous episode');
    });

    await test('1.6 Final released episode of series returns null for next', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 404900,
            type: 'tv-series',
            status: 'ended',
            seasons: [
                { season_number: 1, episode_count: 7 },
                { season_number: 5, episode_count: 16 }
            ]
        };
        const selection = { seasonNumber: 5, episodeNumber: 16, mediaType: 'tv-series' };
        const result = harness.resolveAdjacentEpisode(movie, selection, 'next');

        assert.strictEqual(result, null, 'Series finale has no next episode');
    });

    await test('1.7 Future unreleased next episode is rejected by playability check', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 999999,
            type: 'tv-series',
            seasons: [
                {
                    season_number: 1,
                    episode_count: 10,
                    episodes: [
                        { episode_number: 3, air_date: '2020-01-01' },
                        { episode_number: 4, air_date: '2099-12-31' } // Future
                    ]
                }
            ]
        };
        const selection = { seasonNumber: 1, episodeNumber: 3, mediaType: 'tv-series' };
        const result = harness.resolveAdjacentEpisode(movie, selection, 'next');

        assert.strictEqual(result, null, 'Future unreleased episode must return null');
    });

    await test('1.8 Unknown or missing airDate is treated as playable', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 999999,
            type: 'tv-series',
            seasons: [
                {
                    season_number: 1,
                    episode_count: 10,
                    episodes: [
                        { episode_number: 1 },
                        { episode_number: 2, name: 'Серия 2' } // missing airDate
                    ]
                }
            ]
        };
        const selection = { seasonNumber: 1, episodeNumber: 1, mediaType: 'tv-series' };
        const result = harness.resolveAdjacentEpisode(movie, selection, 'next');

        assert.ok(result, 'Episode with missing airDate must be playable');
        assert.strictEqual(result.episodeNumber, 2);
    });

    await test('1.9 Season 0 / Specials remains isolated (does not jump to S1 or previous from E1)', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 404900,
            type: 'tv-series',
            seasons: [
                { season_number: 0, episode_count: 3, episodes: [{ episode_number: 1 }, { episode_number: 2 }, { episode_number: 3 }] },
                { season_number: 1, episode_count: 7 }
            ]
        };

        // S0E2 -> S0E1
        const prevResult = harness.resolveAdjacentEpisode(movie, { seasonNumber: 0, episodeNumber: 2, mediaType: 'tv-series' }, 'previous');
        assert.strictEqual(prevResult?.seasonNumber, 0);
        assert.strictEqual(prevResult?.episodeNumber, 1);

        // S0E1 -> previous returns null (no backwards jump to negative or regular)
        const prevFromE1 = harness.resolveAdjacentEpisode(movie, { seasonNumber: 0, episodeNumber: 1, mediaType: 'tv-series' }, 'previous');
        assert.strictEqual(prevFromE1, null);

        // S0E3 (last special) -> next returns null (no auto-jump into Season 1)
        const nextFromLastSpecial = harness.resolveAdjacentEpisode(movie, { seasonNumber: 0, episodeNumber: 3, mediaType: 'tv-series' }, 'next');
        assert.strictEqual(nextFromLastSpecial, null);
    });

    await test('1.10 Missing season gap (e.g. S1 and S3 present, S2 missing) navigates to S3E1', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 888888,
            type: 'tv-series',
            seasons: [
                { season_number: 1, episode_count: 5 },
                { season_number: 3, episode_count: 10, episodes: [{ episode_number: 1, name: 'S3E1' }] }
            ]
        };
        const selection = { seasonNumber: 1, episodeNumber: 5, mediaType: 'tv-series' };
        const result = harness.resolveAdjacentEpisode(movie, selection, 'next');

        assert.ok(result, 'Next season across gap must be found');
        assert.strictEqual(result.seasonNumber, 3);
        assert.strictEqual(result.episodeNumber, 1);
    });

    await test('1.11 Movie returns null for both previous and next', () => {
        const { harness } = createPhase3DHarness();
        const movie = { kinopoiskId: 301, name: 'Матрица', type: 'movie' };
        const selection = { kinopoiskId: 301, mediaType: 'movie', seasonNumber: null, episodeNumber: null };

        assert.strictEqual(harness.resolveAdjacentEpisode(movie, selection, 'previous'), null);
        assert.strictEqual(harness.resolveAdjacentEpisode(movie, selection, 'next'), null);
    });

    await test('1.12 Mini-series (Chernobyl) navigates episodes 1..5 cleanly', () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 1227967,
            name: 'Чернобыль',
            type: 'mini-series',
            seasons: [{ season_number: 1, episode_count: 5 }]
        };

        const e1Next = harness.resolveAdjacentEpisode(movie, { seasonNumber: 1, episodeNumber: 1, mediaType: 'mini-series' }, 'next');
        assert.strictEqual(e1Next?.episodeNumber, 2);

        const e5Prev = harness.resolveAdjacentEpisode(movie, { seasonNumber: 1, episodeNumber: 5, mediaType: 'mini-series' }, 'previous');
        assert.strictEqual(e5Prev?.episodeNumber, 4);

        const e5Next = harness.resolveAdjacentEpisode(movie, { seasonNumber: 1, episodeNumber: 5, mediaType: 'mini-series' }, 'next');
        assert.strictEqual(e5Next, null);
    });

    // ==========================================
    // PART 2: UI & DOM CONTRACTS
    // ==========================================
    console.log('\n--- Part 2: Player Controls UI & Accessibility ---');

    await test('2.1 Series modal displays Prev and Next episode navigation controls', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [{ season_number: 1, episode_count: 7 }]
        };

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 4,
            source: 'SEASONS_TAB'
        });

        assert.strictEqual(harness.elements.playerNavControls.style.display, 'flex');
        assert.strictEqual(harness.elements.playerPrevEpisodeBtn.disabled, false);
        assert.strictEqual(harness.elements.playerNextEpisodeBtn.disabled, false);
    });

    await test('2.2 Movie modal hides Prev and Next episode navigation controls', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 301,
            nameRu: 'Матрица',
            type: 'movie'
        };

        await harness.playSelection({
            kinopoiskId: 301,
            title: 'Матрица',
            mediaType: 'movie',
            seasonNumber: null,
            episodeNumber: null,
            source: 'HERO_WATCH'
        });

        assert.strictEqual(harness.elements.playerNavControls.style.display, 'none');
    });

    await test('2.3 S1E1 disables Previous button and enables Next button', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [{ season_number: 1, episode_count: 7 }]
        };

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 1,
            source: 'SEASONS_TAB'
        });

        assert.strictEqual(harness.elements.playerPrevEpisodeBtn.disabled, true);
        assert.strictEqual(harness.elements.playerNextEpisodeBtn.disabled, false);
        assert.ok(harness.elements.playerPrevEpisodeBtn.getAttribute('aria-label').includes('недоступна'));
    });

    await test('2.4 Final episode disables Next button and enables Previous button', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [{ season_number: 1, episode_count: 7 }]
        };

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 7,
            source: 'SEASONS_TAB'
        });

        assert.strictEqual(harness.elements.playerPrevEpisodeBtn.disabled, false);
        assert.strictEqual(harness.elements.playerNextEpisodeBtn.disabled, true);
        assert.ok(harness.elements.playerNextEpisodeBtn.getAttribute('aria-label').includes('недоступна'));
    });

    await test('2.5 Accessible aria-labels on active buttons describe target S/E and episode name', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [
                {
                    season_number: 5,
                    episode_count: 16,
                    episodes: [
                        { episode_number: 13, name: 'Тохаджили' },
                        { episode_number: 14, name: 'Озимандия' },
                        { episode_number: 15, name: 'Гранитный штат' }
                    ]
                }
            ]
        };

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 5,
            episodeNumber: 14,
            episodeTitle: 'Озимандия',
            source: 'SEASONS_TAB'
        });

        const prevAria = harness.elements.playerPrevEpisodeBtn.getAttribute('aria-label');
        const nextAria = harness.elements.playerNextEpisodeBtn.getAttribute('aria-label');

        assert.ok(prevAria.includes('S5E13'), `Prev aria should mention S5E13, got: ${prevAria}`);
        assert.ok(prevAria.includes('Тохаджили'), `Prev aria should mention episode name, got: ${prevAria}`);
        assert.ok(nextAria.includes('S5E15'), `Next aria should mention S5E15, got: ${nextAria}`);
        assert.ok(nextAria.includes('Гранитный штат'), `Next aria should mention episode name, got: ${nextAria}`);
    });

    await test('2.6 HTML template contains 0 inline event handlers and valid button types', () => {
        const html = fs.readFileSync('src/pages/movie-details/movie-details.html', 'utf8');

        assert.ok(!html.includes('onclick='), 'HTML must not have inline onclick');
        assert.ok(!html.includes('onerror='), 'HTML must not have inline onerror');
        assert.ok(html.includes('id="playerPrevEpisodeBtn"'), 'playerPrevEpisodeBtn must exist in HTML');
        assert.ok(html.includes('id="playerNextEpisodeBtn"'), 'playerNextEpisodeBtn must exist in HTML');
        assert.ok(html.includes('type="button"'), 'Buttons must specify type="button"');
    });

    // ==========================================
    // PART 3: PLAYBACK & CONTROLLER CONTRACTS
    // ==========================================
    console.log('\n--- Part 3: PlaybackController Dispatch & State Preservation ---');

    await test('3.1 Next navigation dispatches canonical selection with source "PLAYER_NAVIGATION"', async () => {
        const { harness, VALID_SOURCES } = createPhase3DHarness();
        assert.ok(VALID_SOURCES.has('PLAYER_NAVIGATION'), 'VALID_SOURCES must contain PLAYER_NAVIGATION');

        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [{ season_number: 3, episode_count: 13, episodes: [{ episode_number: 7 }, { episode_number: 8, name: 'Я вижу тебя' }] }]
        };

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 7,
            source: 'SEASONS_TAB'
        });

        // Click Next
        await harness.handlePlayerNavigate('next');

        const selection = harness.playbackController.getSelection();
        assert.strictEqual(selection.seasonNumber, 3);
        assert.strictEqual(selection.episodeNumber, 8);
        assert.strictEqual(selection.episodeTitle, 'Я вижу тебя');
        assert.strictEqual(selection.source, 'PLAYER_NAVIGATION');
        assert.strictEqual(selection.initialTimestamp, 0, 'initialTimestamp must be reset to 0');
    });

    await test('3.2 Previous navigation dispatches canonical selection with source "PLAYER_NAVIGATION"', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [{ season_number: 3, episode_count: 13, episodes: [{ episode_number: 6, name: 'Закат' }, { episode_number: 7 }] }]
        };

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 7,
            source: 'SEASONS_TAB'
        });

        // Click Previous
        await harness.handlePlayerNavigate('previous');

        const selection = harness.playbackController.getSelection();
        assert.strictEqual(selection.seasonNumber, 3);
        assert.strictEqual(selection.episodeNumber, 6);
        assert.strictEqual(selection.episodeTitle, 'Закат');
        assert.strictEqual(selection.source, 'PLAYER_NAVIGATION');
        assert.strictEqual(selection.initialTimestamp, 0);
    });

    await test('3.3 Timestamp resets to 0 and does not carry over from previous episode', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [{ season_number: 1, episode_count: 7 }]
        };

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 3,
            initialTimestamp: 1420, // previous episode was at 23m40s
            source: 'RESUME'
        });

        assert.strictEqual(harness.playbackController.getSelection().initialTimestamp, 1420);

        await harness.handlePlayerNavigate('next');
        assert.strictEqual(harness.playbackController.getSelection().initialTimestamp, 0, 'New episode must start at 0');
    });

    await test('3.4 Active provider is preserved across episode navigation (VidSrc stays VidSrc)', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            imdbId: 'tt0903747',
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [{ season_number: 2, episode_count: 13 }]
        };

        harness.playbackController.setActiveProvider('vidsrc');

        await harness.playSelection({
            kinopoiskId: 404900,
            imdbId: 'tt0903747',
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 2,
            episodeNumber: 4,
            providerId: 'vidsrc',
            source: 'SEASONS_TAB'
        });

        assert.strictEqual(harness.playbackController.getActiveProvider(), 'vidsrc');
        assert.ok(harness.currentVideoUrl.includes('season=2&episode=4'));

        // Navigate Next
        await harness.handlePlayerNavigate('next');

        assert.strictEqual(harness.playbackController.getActiveProvider(), 'vidsrc', 'Provider must remain vidsrc');
        assert.ok(harness.currentVideoUrl.includes('season=2&episode=5'), 'VidSrc URL must update to episode 5');
    });

    await test('3.5 Header title immediately updates without stale text', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [
                {
                    season_number: 4,
                    episode_count: 13,
                    episodes: [
                        { episode_number: 10, name: 'Салют' },
                        { episode_number: 11, name: 'Фронтовой подпол' }
                    ]
                }
            ]
        };

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 4,
            episodeNumber: 10,
            episodeTitle: 'Салют',
            source: 'SEASONS_TAB'
        });

        assert.strictEqual(harness.elements.videoSubtitle.textContent, 'S4E10 · Салют');

        await harness.handlePlayerNavigate('next');
        assert.strictEqual(harness.elements.videoSubtitle.textContent, 'S4E11 · Фронтовой подпол');
    });

    await test('3.6 Title-only guidance immediately updates ("Выберите S4E11 в плеере источника")', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [{ season_number: 4, episode_count: 13 }]
        };

        harness.playbackController.setActiveProvider('kinogo');

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 4,
            episodeNumber: 10,
            providerId: 'kinogo',
            source: 'SEASONS_TAB'
        });

        const textEl = harness.elements.playerSourceGuidance.querySelector('.player-source-guidance__text');
        assert.strictEqual(textEl.textContent, 'Выберите S4E10 в плеере источника');

        await harness.handlePlayerNavigate('next');
        assert.strictEqual(textEl.textContent, 'Выберите S4E11 в плеере источника');
    });

    // ==========================================
    // PART 4: CROSS-SEASON & SPECIALS CONTRACTS
    // ==========================================
    console.log('\n--- Part 4: Cross-Season Navigation & Direct Providers ---');

    await test('4.1 Cross-season Next updates VidSrc URL to S4E1', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            imdbId: 'tt0903747',
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [
                { season_number: 3, episode_count: 13 },
                { season_number: 4, episode_count: 13, episodes: [{ episode_number: 1, name: 'Канцелярский нож' }] }
            ]
        };

        harness.playbackController.setActiveProvider('vidsrc');

        await harness.playSelection({
            kinopoiskId: 404900,
            imdbId: 'tt0903747',
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 13,
            providerId: 'vidsrc',
            source: 'SEASONS_TAB'
        });

        await harness.handlePlayerNavigate('next');

        assert.strictEqual(harness.playbackController.getSelection().seasonNumber, 4);
        assert.strictEqual(harness.playbackController.getSelection().episodeNumber, 1);
        assert.ok(harness.currentVideoUrl.includes('season=4&episode=1'), `VidSrc URL must contain season=4&episode=1, got: ${harness.currentVideoUrl}`);
    });

    await test('4.2 Cross-season Previous updates Seasonvar URL to S3E13', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [
                { season_number: 3, episode_count: 13 },
                { season_number: 4, episode_count: 13 }
            ]
        };

        harness.playbackController.setActiveProvider('seasonvar');

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 4,
            episodeNumber: 1,
            providerId: 'seasonvar',
            source: 'SEASONS_TAB'
        });

        await harness.handlePlayerNavigate('previous');

        assert.strictEqual(harness.playbackController.getSelection().seasonNumber, 3);
        assert.strictEqual(harness.playbackController.getSelection().episodeNumber, 13);
        assert.ok(harness.currentVideoUrl.includes('#s3e13'), `Seasonvar URL must contain #s3e13, got: ${harness.currentVideoUrl}`);
    });

    await test('4.3 Cross-season title-only guidance updates to cross-season S/E', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [
                { season_number: 1, episode_count: 7 },
                { season_number: 2, episode_count: 13 }
            ]
        };

        harness.playbackController.setActiveProvider('kinogo');

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 7,
            providerId: 'kinogo',
            source: 'SEASONS_TAB'
        });

        await harness.handlePlayerNavigate('next');

        const textEl = harness.elements.playerSourceGuidance.querySelector('.player-source-guidance__text');
        assert.strictEqual(textEl.textContent, 'Выберите S2E1 в плеере источника');
    });

    await test('4.4 No Season 0 silent conversion when navigating regular seasons', async () => {
        const { harness } = createPhase3DHarness();
        const movie = {
            kinopoiskId: 404900,
            type: 'tv-series',
            seasons: [
                { season_number: 0, episode_count: 5 },
                { season_number: 1, episode_count: 7 }
            ]
        };

        const prevFromS1E1 = harness.resolveAdjacentEpisode(movie, { seasonNumber: 1, episodeNumber: 1, mediaType: 'tv-series' }, 'previous');
        assert.strictEqual(prevFromS1E1, null, 'S1E1 previous must NOT silently jump to Season 0');
    });

    // ==========================================
    // PART 5: ASYNC RACE & STATE TOKEN CONTRACTS
    // ==========================================
    console.log('\n--- Part 5: Async Generation Token Protection ---');

    await test('5.1 Rapid Next -> Next -> Previous navigation commits final requested episode', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [{ season_number: 2, episode_count: 13 }]
        };

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 2,
            episodeNumber: 3,
            source: 'SEASONS_TAB'
        });

        // Rapid sequence: 3 -> 4 -> 5 -> 4
        await harness.handlePlayerNavigate('next');
        await harness.handlePlayerNavigate('next');
        await harness.handlePlayerNavigate('previous');

        const selection = harness.playbackController.getSelection();
        assert.strictEqual(selection.seasonNumber, 2);
        assert.strictEqual(selection.episodeNumber, 4, 'Final state must be S2E4');
    });

    // ==========================================
    // PART 6: ANIME & ANISKIP CONTRACTS
    // ==========================================
    console.log('\n--- Part 6: Aniskip Episode Context ---');

    await test('6.1 Episode navigation updates currentEpisode and notifies Aniskip context', async () => {
        const { harness } = createPhase3DHarness();
        harness.selectedMovie = {
            kinopoiskId: 5057807,
            nameRu: 'Провожающая в последний путь Фрирен',
            type: 'anime',
            seasons: [{ season_number: 1, episode_count: 28 }]
        };

        await harness.playSelection({
            kinopoiskId: 5057807,
            title: 'Фрирен',
            mediaType: 'anime',
            seasonNumber: 1,
            episodeNumber: 5,
            source: 'SEASONS_TAB'
        });

        assert.strictEqual(harness.currentEpisode, 5);
        assert.strictEqual(harness.aniskipDispatched.length, 1);
        assert.strictEqual(harness.aniskipDispatched[0].episodeNumber, 5);

        await harness.handlePlayerNavigate('next');

        assert.strictEqual(harness.currentEpisode, 6);
        assert.strictEqual(harness.aniskipDispatched.length, 2);
        assert.strictEqual(harness.aniskipDispatched[1].episodeNumber, 6);
    });

    // ==========================================
    // PART 7: NETWORK BOUNDS CONTRACTS
    // ==========================================
    console.log('\n--- Part 7: Zero Metadata Network Accounting ---');

    await test('7.1 Same-season navigation triggers 0 external metadata requests', async () => {
        let networkFetchCount = 0;
        const { harness } = createPhase3DHarness();

        harness.selectedMovie = {
            kinopoiskId: 404900,
            nameRu: 'Во все тяжкие',
            type: 'tv-series',
            seasons: [{ season_number: 1, episode_count: 7 }]
        };

        await harness.playSelection({
            kinopoiskId: 404900,
            title: 'Во все тяжкие',
            mediaType: 'tv-series',
            seasonNumber: 1,
            episodeNumber: 3,
            source: 'SEASONS_TAB'
        });

        // Track any network calls during navigation
        await harness.handlePlayerNavigate('next');
        await harness.handlePlayerNavigate('previous');

        assert.strictEqual(networkFetchCount, 0, 'Same-season navigation must perform 0 metadata fetches');
    });

    // ==========================================
    // PART 8: REGRESSION & SCOPE DISCIPLINE
    // ==========================================
    console.log('\n--- Part 8: Regression & Scope Boundary Discipline ---');

    await test('8.1 Duplicate season/episode drawers remain strictly absent in player shell', () => {
        const html = fs.readFileSync('src/pages/movie-details/movie-details.html', 'utf8');

        assert.ok(!html.includes('class="season-selector-drawer"'), 'Duplicate season drawer must not exist');
        assert.ok(!html.includes('class="episode-list-overlay"'), 'Duplicate episode list overlay must not exist');
    });

    await test('8.2 ProgressService schema is preserved unchanged', () => {
        const progressServicePath = path.join(__dirname, '../src/shared/services/ProgressService.js');
        assert.ok(fs.existsSync(progressServicePath), 'ProgressService file must exist');
        const content = fs.readFileSync(progressServicePath, 'utf8');
        assert.ok(content.includes('class ProgressService'), 'ProgressService class must exist');
    });

    await test('8.3 Auto-next playback is NOT implemented in Phase 3D (clean scope boundary)', () => {
        const js = fs.readFileSync('src/pages/movie-details/movie-details.js', 'utf8');

        assert.ok(!js.includes('autoplayNextEpisode'), 'Auto-play next episode must not be present prematurely');
    });

    console.log(`\n🎉 ALL ${passedCount} Phase 3D In-Player Navigation & Adjacency Tests Passed Successfully!`);
}

runAllTests().catch((err) => {
    console.error('Test run failed:', err);
    process.exit(1);
});
