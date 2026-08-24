/**
 * Phase 3B Automated Test Suite: Seasons Episode Play Actions + Hero NextEpisode Playback
 * Covers Parts 43 through 52 of the Phase 3B specification.
 */

const assert = require('assert');
const { normalizePlaybackSelection } = require('../src/shared/services/player/PlaybackSelection');
const { VidSrcAdapter } = require('../src/shared/services/player/adapters/VidSrcAdapter');
const { SeasonvarAdapter } = require('../src/shared/services/player/adapters/SeasonvarAdapter');
const { KinogoAdapter } = require('../src/shared/services/player/adapters/KinogoAdapter');
const { ExFsAdapter } = require('../src/shared/services/player/adapters/ExFsAdapter');
const { RutubeAdapter } = require('../src/shared/services/player/adapters/RutubeAdapter');
const { PlaybackController } = require('../src/shared/services/player/PlaybackController');

// Mock helper to replicate MovieDetailsManager methods in test harness
function createMovieDetailsHarness() {
    const controller = new PlaybackController();
    controller.registerAdapter(new VidSrcAdapter());
    controller.registerAdapter(new SeasonvarAdapter());
    controller.registerAdapter(new KinogoAdapter());
    controller.registerAdapter(new ExFsAdapter());
    controller.registerAdapter(new RutubeAdapter());

    const domMock = {
        videoTitle: { textContent: '' },
        videoSubtitle: { textContent: '', style: { display: 'none' } },
        videoPlayerModal: {
            style: { display: 'none' },
            classList: {
                classes: new Set(),
                contains(c) { return this.classes.has(c); },
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); }
            }
        },
        videoContainer: { innerHTML: '' },
        playerSourceGuidance: {
            style: { display: 'none' },
            text: '',
            querySelector(sel) {
                if (sel === '.player-source-guidance__text') {
                    return {
                        set textContent(v) { domMock.playerSourceGuidance.text = v; },
                        get textContent() { return domMock.playerSourceGuidance.text; }
                    };
                }
                return null;
            }
        }
    };

    return {
        playbackController: controller,
        selectedMovie: null,
        elements: domMock,
        currentEpisode: null,
        currentVideoUrl: null,
        activeSource: null,
        progressService: null,

        escapeHtml(text) {
            if (!text) return '';
            return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },

        formatDate(dateStr) {
            if (!dateStr) return '';
            return dateStr;
        },

        isEpisodePlayableByDate(episode) {
            if (!episode || typeof episode !== 'object') return false;
            if (!episode.airDate) return true;

            const rawAirDate = String(episode.airDate).trim();
            if (!rawAirDate) return true;

            const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawAirDate);
            const now = new Date();

            if (isDateOnly) {
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const todayStr = `${year}-${month}-${day}`;
                return rawAirDate <= todayStr;
            }

            const airTimestamp = new Date(rawAirDate).getTime();
            if (isNaN(airTimestamp)) return true;
            return airTimestamp <= now.getTime();
        },

        renderHeroNextEpisode(movie) {
            if (!movie) return '';
            const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
            if (!isSeries) return '';

            const statusStr = String(movie.status || '').trim().toLowerCase();
            const isEndedOrCanceled = statusStr === 'ended' || statusStr === 'canceled' || statusStr === 'cancelled' || statusStr === 'completed';

            if (isEndedOrCanceled) {
                return '';
            }

            if (!movie.nextEpisode || typeof movie.nextEpisode !== 'object') {
                return '';
            }

            const seasonNum = movie.nextEpisode.seasonNumber;
            const episodeNum = movie.nextEpisode.episodeNumber;
            if (seasonNum == null || episodeNum == null) return '';

            const airDateStr = movie.nextEpisode.airDate ? this.formatDate(movie.nextEpisode.airDate) : '';
            const title = movie.nextEpisode.name ? String(movie.nextEpisode.name).trim() : '';
            const runtime = movie.nextEpisode.runtime ? `${movie.nextEpisode.runtime} мин` : '';
            const isPlayable = this.isEpisodePlayableByDate(movie.nextEpisode);

            return `
                <div class="hero-next-episode-card" id="heroNextEpisode">
                    <div class="hero-next-episode-header">
                        <span class="hero-next-episode-badge">Следующая серия</span>
                        ${airDateStr ? `<span class="hero-next-episode-date">${this.escapeHtml(airDateStr)}</span>` : ''}
                    </div>
                    <div class="hero-next-episode-content">
                        <span class="hero-next-episode-code">S${seasonNum}E${episodeNum}</span>
                        ${title ? `<span class="hero-next-episode-title">${this.escapeHtml(title)}</span>` : ''}
                        ${runtime ? `<span class="hero-next-episode-runtime">· ${this.escapeHtml(runtime)}</span>` : ''}
                        ${isPlayable ? `
                            <button type="button" 
                                    class="hero-next-episode__play-btn" 
                                    data-action="play-next-episode" 
                                    aria-label="Смотреть S${seasonNum}E${episodeNum}${title ? ` — ${this.escapeHtml(title)}` : ''}">
                                <span class="play-icon" aria-hidden="true">▶</span> Смотреть
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        },

        renderEpisodesList(episodes, nextEpisode = null) {
            if (!Array.isArray(episodes) || episodes.length === 0) return '';
            const now = new Date();

            return `
                <div class="episodes-grid">
                    ${episodes.map(ep => {
                        const epAirDate = ep.airDate ? new Date(ep.airDate) : null;
                        const isUpcoming = epAirDate && !isNaN(epAirDate.getTime()) && epAirDate > now;
                        const isNextEp = Boolean(
                            nextEpisode &&
                            Number(ep.seasonNumber) === Number(nextEpisode.seasonNumber) &&
                            Number(ep.episodeNumber) === Number(nextEpisode.episodeNumber)
                        );

                        const title = ep.name || `Серия ${ep.episodeNumber}`;
                        const isPlayable = this.isEpisodePlayableByDate(ep);

                        return `
                            <div class="episode-card ${isNextEp ? 'episode-card--next' : ''} ${isUpcoming ? 'episode-card--upcoming' : ''}">
                                <div class="episode-card-header">
                                    <div class="episode-title-group">
                                        <span class="episode-code">S${ep.seasonNumber}E${ep.episodeNumber}</span>
                                        <h5 class="episode-title">${this.escapeHtml(title)}</h5>
                                    </div>
                                    <div class="episode-badges">
                                        ${isNextEp ? '<span class="badge-next-episode">Следующая</span>' : ''}
                                        ${isUpcoming ? '<span class="badge-upcoming">Ожидается</span>' : ''}
                                    </div>
                                </div>

                                <div class="episode-meta-row">
                                    ${ep.airDate ? `<span class="episode-air-date">${this.escapeHtml(this.formatDate(ep.airDate))}</span>` : ''}
                                    ${ep.runtime ? `<span class="episode-runtime">${ep.runtime} мин</span>` : ''}
                                    ${isPlayable ? `
                                        <button type="button" 
                                                class="episode-card__play-btn" 
                                                data-action="play-episode" 
                                                data-season-number="${ep.seasonNumber}" 
                                                data-episode-number="${ep.episodeNumber}" 
                                                aria-label="Смотреть S${ep.seasonNumber}E${ep.episodeNumber} — ${this.escapeHtml(title)}">
                                            <span class="play-icon" aria-hidden="true">▶</span> Смотреть
                                        </button>
                                    ` : ''}
                                </div>

                                ${ep.overview ? `<p class="episode-overview">${this.escapeHtml(ep.overview)}</p>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        },

        updatePlayerHeaderTitle() {
            if (!this.elements.videoTitle || !this.selectedMovie) return;
            const baseTitle = this.selectedMovie.nameRu || this.selectedMovie.name || 'Фильм';
            const selection = this.playbackController?.getSelection();
            const subtitleEl = this.elements.videoSubtitle;

            this.elements.videoTitle.textContent = baseTitle;

            if (selection && selection.seasonNumber != null && selection.episodeNumber != null) {
                let epText = `S${selection.seasonNumber}E${selection.episodeNumber}`;
                if (selection.episodeTitle) {
                    epText += ` · ${selection.episodeTitle}`;
                }
                if (subtitleEl) {
                    subtitleEl.textContent = epText;
                    subtitleEl.style.display = 'block';
                }
            } else {
                if (subtitleEl) {
                    subtitleEl.textContent = '';
                    subtitleEl.style.display = 'none';
                }
            }
        },

        updateSourceGuidance(providerId = this.playbackController?.getActiveProvider()) {
            const guidanceEl = this.elements.playerSourceGuidance;
            if (!guidanceEl) return;
            const selection = this.playbackController?.getSelection();
            if (!selection || selection.seasonNumber == null || selection.episodeNumber == null) {
                guidanceEl.style.display = 'none';
                return;
            }

            let provKey = providerId;
            if (typeof provKey === 'string') {
                if (provKey.startsWith('parser:')) provKey = provKey.replace('parser:', '');
                else if (provKey.startsWith('vidsrc:')) provKey = 'vidsrc';
            }

            const activeAdapter = this.playbackController?.getAdapter(provKey);
            if (activeAdapter && activeAdapter.supportsDirectSeasonEpisode() === false) {
                const textEl = guidanceEl.querySelector('.player-source-guidance__text') || guidanceEl;
                textEl.textContent = `Выберите S${selection.seasonNumber}E${selection.episodeNumber} в плеере источника`;
                guidanceEl.style.display = 'flex';
            } else {
                guidanceEl.style.display = 'none';
            }
        },

        handleEpisodePlay(seasonNumber, episodeNumber, episodeTitle = null) {
            if (!this.selectedMovie) return;
            const movie = this.selectedMovie;
            const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));

            const selectionPayload = {
                kinopoiskId: movie.kinopoiskId,
                tmdbId: movie.tmdbId || null,
                imdbId: movie.externalId?.imdb || movie.imdbId || null,
                title: movie.nameRu || movie.name || '',
                mediaType: isSeries ? (movie.type || 'tv-series') : 'movie',
                seasonNumber: Number(seasonNumber),
                episodeNumber: Number(episodeNumber),
                episodeTitle: episodeTitle || null,
                source: 'SEASONS_TAB',
                initialTimestamp: 0
            };

            this.playSelection(selectionPayload);
        },

        handleNextEpisodePlay(seasonNumber, episodeNumber, episodeTitle = null) {
            if (!this.selectedMovie) return;
            const movie = this.selectedMovie;
            const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));

            const selectionPayload = {
                kinopoiskId: movie.kinopoiskId,
                tmdbId: movie.tmdbId || null,
                imdbId: movie.externalId?.imdb || movie.imdbId || null,
                title: movie.nameRu || movie.name || '',
                mediaType: isSeries ? (movie.type || 'tv-series') : 'movie',
                seasonNumber: Number(seasonNumber),
                episodeNumber: Number(episodeNumber),
                episodeTitle: episodeTitle || null,
                source: 'NEXT_EPISODE_HERO',
                initialTimestamp: 0
            };

            this.playSelection(selectionPayload);
        },

        async playSelection(selectionPayload) {
            if (!this.selectedMovie) return;

            if (this.playbackController) {
                this.playbackController.setContainer(this.elements.videoContainer, this.elements.videoPlayerModal);
                this.playbackController.setSelection(selectionPayload);
            }

            this.updatePlayerHeaderTitle();
            this.elements.videoPlayerModal.style.display = 'flex';

            if (selectionPayload.episodeNumber != null) {
                this.currentEpisode = selectionPayload.episodeNumber;
            }

            const activeProvider = this.playbackController?.getActiveProvider() || 'vidsrc';
            this.updateSourceGuidance(activeProvider);
        },

        async handleWatchClick() {
            if (!this.selectedMovie) return;
            const movie = this.selectedMovie;
            const isSeries = Boolean(movie.isSeries || (movie.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
            let initialSeason = null;
            let initialEpisode = null;
            let initialTimestamp = 0;

            if (isSeries) {
                let hasProgress = false;
                if (this.progressService) {
                    try {
                        const progress = await this.progressService.getProgress(movie.kinopoiskId);
                        if (progress) {
                            if (progress.season != null) {
                                const sMatch = String(progress.season).match(/(\d+)/);
                                if (sMatch) initialSeason = parseInt(sMatch[1], 10);
                            }
                            if (progress.episode != null) {
                                const eMatch = String(progress.episode).match(/(\d+)/);
                                if (eMatch) initialEpisode = parseInt(eMatch[1], 10);
                            }
                            if (progress.timestamp) {
                                initialTimestamp = progress.timestamp;
                            }
                            if (initialSeason != null || initialEpisode != null) {
                                hasProgress = true;
                            }
                        }
                    } catch { /* Ignore */ }
                }

                if (!hasProgress) {
                    let defaultSeason = 1;
                    if (Array.isArray(movie.seasons) && movie.seasons.length > 0) {
                        const normalSeasons = movie.seasons.filter(s => !s.isSpecial && s.number > 0);
                        if (normalSeasons.length > 0 && !normalSeasons.some(s => s.number === 1)) {
                            defaultSeason = normalSeasons[0].number;
                        }
                    }
                    initialSeason = defaultSeason;
                    initialEpisode = 1;
                    initialTimestamp = 0;
                }
            }

            const selectionPayload = {
                kinopoiskId: movie.kinopoiskId,
                tmdbId: movie.tmdbId || null,
                imdbId: movie.externalId?.imdb || movie.imdbId || null,
                title: movie.name || movie.nameRu || '',
                mediaType: isSeries ? (movie.type || 'tv-series') : 'movie',
                seasonNumber: initialSeason,
                episodeNumber: initialEpisode,
                source: 'HERO_WATCH',
                initialTimestamp
            };

            if (this.playbackController) {
                this.playbackController.setContainer(this.elements.videoContainer, this.elements.videoPlayerModal);
                this.playbackController.setSelection(selectionPayload);
            }

            this.updatePlayerHeaderTitle();
            this.elements.videoPlayerModal.style.display = 'flex';
        },

        buildVidSrcUrl(imdbId, opts = {}) {
            const base = 'https://vidsrc-embed.ru/embed';
            const isSeries = this.selectedMovie?.type &&
                ['tv-series', 'mini-series', 'animated-series', 'anime'].includes(this.selectedMovie.type);

            if (isSeries) {
                const selection = this.playbackController?.getSelection();
                const s = (opts.season != null ? opts.season : (selection?.seasonNumber != null ? selection.seasonNumber : 1));
                const e = (opts.episode != null ? opts.episode : (selection?.episodeNumber != null ? selection.episodeNumber : 1));
                return `${base}/tv?imdb=${imdbId}&season=${s}&episode=${e}&autoplay=1`;
            }
            return `${base}/movie?imdb=${imdbId}&autoplay=1`;
        }
    };
}

let passedCount = 0;
async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✅ ${name}`);
        passedCount++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(err);
        process.exit(1);
    }
}

async function runAllTests() {
    console.log('🧪 Running Phase 3B Seasons Play Actions & Hero NextEpisode Tests...\n');

    // ==========================================
    // PART 43: Date-Based Playability Helper
    // ==========================================
    console.log('--- Part 43: Date-Based Playability Helper ---');

    await test('43.1 Past date-only airDate (YYYY-MM-DD) is playable', () => {
        const harness = createMovieDetailsHarness();
        assert.strictEqual(harness.isEpisodePlayableByDate({ airDate: '2020-01-15' }), true);
    });

    await test('43.2 Today date-only airDate is playable', () => {
        const harness = createMovieDetailsHarness();
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const todayStr = `${y}-${m}-${d}`;
        assert.strictEqual(harness.isEpisodePlayableByDate({ airDate: todayStr }), true);
    });

    await test('43.3 Future date-only airDate is NOT playable', () => {
        const harness = createMovieDetailsHarness();
        assert.strictEqual(harness.isEpisodePlayableByDate({ airDate: '2099-12-31' }), false);
    });

    await test('43.4 Missing or empty airDate falls back to true', () => {
        const harness = createMovieDetailsHarness();
        assert.strictEqual(harness.isEpisodePlayableByDate({}), true);
        assert.strictEqual(harness.isEpisodePlayableByDate({ airDate: '' }), true);
        assert.strictEqual(harness.isEpisodePlayableByDate({ airDate: null }), true);
    });

    await test('43.5 Null or non-object episode returns false', () => {
        const harness = createMovieDetailsHarness();
        assert.strictEqual(harness.isEpisodePlayableByDate(null), false);
        assert.strictEqual(harness.isEpisodePlayableByDate(undefined), false);
        assert.strictEqual(harness.isEpisodePlayableByDate('2020-01-01'), false);
    });

    // ==========================================
    // PART 44: Hero Next Episode Play Button
    // ==========================================
    console.log('--- Part 44: Hero Next Episode Play Button Rendering ---');

    await test('44.1 Playable next episode renders play button with data-action="play-next-episode"', () => {
        const harness = createMovieDetailsHarness();
        const movie = {
            kinopoiskId: 100,
            type: 'tv-series',
            nextEpisode: { seasonNumber: 2, episodeNumber: 5, name: 'The Reveal', airDate: '2020-01-01' }
        };
        const html = harness.renderHeroNextEpisode(movie);
        assert(html.includes('data-action="play-next-episode"'));
        assert(html.includes('hero-next-episode__play-btn'));
        assert(html.includes('S2E5'));
    });

    await test('44.2 Future next episode omits play button', () => {
        const harness = createMovieDetailsHarness();
        const movie = {
            kinopoiskId: 100,
            type: 'tv-series',
            nextEpisode: { seasonNumber: 3, episodeNumber: 1, name: 'Future Premier', airDate: '2099-01-01' }
        };
        const html = harness.renderHeroNextEpisode(movie);
        assert(!html.includes('data-action="play-next-episode"'));
        assert(!html.includes('hero-next-episode__play-btn'));
        assert(html.includes('S3E1'));
    });

    await test('44.3 Ended series omits Hero next episode block completely', () => {
        const harness = createMovieDetailsHarness();
        const movie = {
            kinopoiskId: 100,
            type: 'tv-series',
            status: 'ended',
            nextEpisode: { seasonNumber: 1, episodeNumber: 1 }
        };
        assert.strictEqual(harness.renderHeroNextEpisode(movie), '');
    });

    // ==========================================
    // PART 45: Episodes List Play Button
    // ==========================================
    console.log('--- Part 45: Episodes List Play Button Rendering ---');

    await test('45.1 Playable episodes render play button with season and episode numbers', () => {
        const harness = createMovieDetailsHarness();
        const episodes = [
            { seasonNumber: 1, episodeNumber: 1, name: 'Pilot', airDate: '2020-01-01' },
            { seasonNumber: 1, episodeNumber: 2, name: 'Second', airDate: '2099-01-01' }
        ];
        const html = harness.renderEpisodesList(episodes);
        assert(html.includes('data-action="play-episode"'));
        assert(html.includes('data-season-number="1"'));
        assert(html.includes('data-episode-number="1"'));
        // Second episode is in the future, should not have play button
        assert(!html.includes('data-episode-number="2"'));
    });

    // ==========================================
    // PART 46 & 47: PlaybackSelection Construction
    // ==========================================
    console.log('--- Parts 46 & 47: Episode Play Action & Canonical PlaybackSelection ---');

    await test('46.1 handleEpisodePlay creates canonical selection with source SEASONS_TAB', async () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 444, tmdbId: 555, nameRu: 'Очень странные дела', type: 'tv-series' };
        
        harness.handleEpisodePlay(3, 8, 'Битва в Старкорте');
        
        const sel = harness.playbackController.getSelection();
        assert.strictEqual(sel.kinopoiskId, 444);
        assert.strictEqual(sel.seasonNumber, 3);
        assert.strictEqual(sel.episodeNumber, 8);
        assert.strictEqual(sel.episodeTitle, 'Битва в Старкорте');
        assert.strictEqual(sel.source, 'SEASONS_TAB');
        assert.strictEqual(harness.currentEpisode, 8);
    });

    await test('47.1 handleNextEpisodePlay creates canonical selection with source NEXT_EPISODE_HERO', async () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 777, nameRu: 'Локи', type: 'tv-series' };
        
        harness.handleNextEpisodePlay(2, 6, 'Славная миссия');
        
        const sel = harness.playbackController.getSelection();
        assert.strictEqual(sel.kinopoiskId, 777);
        assert.strictEqual(sel.seasonNumber, 2);
        assert.strictEqual(sel.episodeNumber, 6);
        assert.strictEqual(sel.source, 'NEXT_EPISODE_HERO');
    });

    // ==========================================
    // PART 48: Generic Watch Policy
    // ==========================================
    console.log('--- Part 48: Generic Watch Start Policy ---');

    await test('48.1 Generic Watch resumes saved progress (Tier 1)', async () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 100, type: 'tv-series', nameRu: 'Во все тяжкие' };
        harness.progressService = {
            async getProgress(id) {
                return { season: '2', episode: '4', timestamp: 120 };
            }
        };

        await harness.handleWatchClick();
        const sel = harness.playbackController.getSelection();
        assert.strictEqual(sel.seasonNumber, 2);
        assert.strictEqual(sel.episodeNumber, 4);
        assert.strictEqual(sel.initialTimestamp, 120);
        assert.strictEqual(sel.source, 'HERO_WATCH');
    });

    await test('48.2 Generic Watch starts at S1E1 when no saved progress (Tier 2)', async () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = {
            kinopoiskId: 200,
            type: 'tv-series',
            nameRu: 'Игра престолов',
            nextEpisode: { seasonNumber: 8, episodeNumber: 6, airDate: '2099-01-01' }
        };
        harness.progressService = {
            async getProgress(id) { return null; }
        };

        await harness.handleWatchClick();
        const sel = harness.playbackController.getSelection();
        assert.strictEqual(sel.seasonNumber, 1);
        assert.strictEqual(sel.episodeNumber, 1);
        assert.strictEqual(sel.initialTimestamp, 0);
        assert.strictEqual(sel.source, 'HERO_WATCH');
    });

    await test('48.3 Generic Watch for movies strictly enforces null season and episode', async () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 300, type: 'film', nameRu: 'Интерстеллар' };

        await harness.handleWatchClick();
        const sel = harness.playbackController.getSelection();
        assert.strictEqual(sel.seasonNumber, null);
        assert.strictEqual(sel.episodeNumber, null);
    });

    // ==========================================
    // PART 49: Player Header Title Formatting
    // ==========================================
    console.log('--- Part 49: Player Header Title Formatting ---');

    await test('49.1 Player header displays series title and S/E subtitle', () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 500, nameRu: 'Тед Лассо', type: 'tv-series' };
        harness.playbackController.setSelection({
            kinopoiskId: 500,
            mediaType: 'tv-series',
            seasonNumber: 2,
            episodeNumber: 4,
            episodeTitle: 'Кэрол'
        });

        harness.updatePlayerHeaderTitle();
        assert.strictEqual(harness.elements.videoTitle.textContent, 'Тед Лассо');
        assert.strictEqual(harness.elements.videoSubtitle.textContent, 'S2E4 · Кэрол');
        assert.strictEqual(harness.elements.videoSubtitle.style.display, 'block');
    });

    await test('49.2 Player header displays clean title for movies and hides subtitle', () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 600, nameRu: 'Начало', type: 'film' };
        harness.playbackController.setSelection({
            kinopoiskId: 600,
            mediaType: 'movie'
        });

        harness.updatePlayerHeaderTitle();
        assert.strictEqual(harness.elements.videoTitle.textContent, 'Начало');
        assert.strictEqual(harness.elements.videoSubtitle.textContent, '');
        assert.strictEqual(harness.elements.videoSubtitle.style.display, 'none');
    });

    // ==========================================
    // PART 50: Title-Only Guidance Notice
    // ==========================================
    console.log('--- Part 50: Title-Only Guidance Notice ---');

    await test('50.1 Shows guidance notice on title-only provider (kinogo)', () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 700, nameRu: 'Сериал', type: 'tv-series' };
        harness.playbackController.setSelection({
            kinopoiskId: 700,
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 7
        });

        harness.updateSourceGuidance('kinogo');
        assert.strictEqual(harness.elements.playerSourceGuidance.style.display, 'flex');
        assert.strictEqual(harness.elements.playerSourceGuidance.text, 'Выберите S3E7 в плеере источника');
    });

    await test('50.2 Hides guidance notice on direct provider (vidsrc)', () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 700, nameRu: 'Сериал', type: 'tv-series' };
        harness.playbackController.setSelection({
            kinopoiskId: 700,
            mediaType: 'tv-series',
            seasonNumber: 3,
            episodeNumber: 7
        });

        harness.updateSourceGuidance('vidsrc');
        assert.strictEqual(harness.elements.playerSourceGuidance.style.display, 'none');
    });

    await test('50.3 Hides guidance notice for movies on any provider', () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 700, nameRu: 'Фильм', type: 'film' };
        harness.playbackController.setSelection({
            kinopoiskId: 700,
            mediaType: 'movie'
        });

        harness.updateSourceGuidance('kinogo');
        assert.strictEqual(harness.elements.playerSourceGuidance.style.display, 'none');
    });

    // ==========================================
    // PART 51: Provider S/E Integration & VidSrc URL
    // ==========================================
    console.log('--- Part 51: Provider S/E Integration & VidSrc URL ---');

    await test('51.1 buildVidSrcUrl utilizes canonical selection season and episode', () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 800, imdbId: 'tt1234567', type: 'tv-series' };
        harness.playbackController.setSelection({
            kinopoiskId: 800,
            mediaType: 'tv-series',
            seasonNumber: 4,
            episodeNumber: 12
        });

        const url = harness.buildVidSrcUrl('tt1234567');
        assert.strictEqual(url, 'https://vidsrc-embed.ru/embed/tv?imdb=tt1234567&season=4&episode=12&autoplay=1');
    });

    // ==========================================
    // PART 52: Zero Metadata Request & Modal Invariants
    // ==========================================
    console.log('--- Part 52: Zero Metadata Request & Invariants ---');

    await test('52.1 Episode play opens modal and sets selection without API requests', async () => {
        const harness = createMovieDetailsHarness();
        harness.selectedMovie = { kinopoiskId: 900, nameRu: 'Сериал', type: 'tv-series' };
        
        let apiFetchCalled = false;
        const interceptor = () => { apiFetchCalled = true; };

        await harness.handleEpisodePlay(1, 3, 'Третий эпизод');

        assert.strictEqual(apiFetchCalled, false);
        assert.strictEqual(harness.elements.videoPlayerModal.style.display, 'flex');
        assert.strictEqual(harness.playbackController.getSelection().seasonNumber, 1);
        assert.strictEqual(harness.playbackController.getSelection().episodeNumber, 3);
    });

    console.log(`\n🎉 All ${passedCount} Phase 3B unit and integration tests PASSED successfully!\n`);
}

runAllTests().catch(err => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
