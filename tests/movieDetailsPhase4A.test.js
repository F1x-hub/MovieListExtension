/**
 * MovieDetails Phase 4A Test Suite:
 * Continue Watching + Current Episode Progress UX (Seasons Integration Without Fake Watch History)
 */

const assert = require('assert');

// Mock localStorage and window
global.localStorage = {
    _data: {},
    getItem(key) { return this._data[key] || null; },
    setItem(key, val) { this._data[key] = String(val); },
    removeItem(key) { delete this._data[key]; },
    clear() { this._data = {}; }
};

const {
    formatPlaybackTime,
    normalizeProgressRecord
} = require('../src/shared/services/player/PlaybackRuntime');

const {
    resolveWatchTarget,
    resolveAdjacentEpisode,
    normalizePlaybackSelection
} = require('../src/shared/services/player/PlaybackSelection');

// Minimal mock for MovieDetailsManager methods under test
class MockMovieDetailsManager {
    constructor() {
        this.selectedMovie = null;
        this.currentProgressRecord = null;
        this.currentWatchTarget = null;
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    formatDate(dateStr) {
        if (!dateStr) return '';
        return String(dateStr);
    }

    getPluralEpisodes(count) {
        const mod10 = count % 10;
        const mod100 = count % 100;
        if (mod10 === 1 && mod100 !== 11) return 'серия';
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'серии';
        return 'серий';
    }

    getPluralSeasons(count) {
        const mod10 = count % 10;
        const mod100 = count % 100;
        if (mod10 === 1 && mod100 !== 11) return 'сезон';
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сезона';
        return 'сезонов';
    }

    isEpisodePlayableByDate(ep) {
        if (!ep) return false;
        if (!ep.airDate && !ep.air_date) return true;
        const d = new Date(ep.airDate || ep.air_date);
        return isNaN(d.getTime()) || d <= new Date();
    }

    resolveWatchTarget(movie, progress) {
        return resolveWatchTarget(movie, progress);
    }

    renderSeasonsContinueBanner(movie, progress, watchTarget, seasons = []) {
        if (!progress || !watchTarget) return '';

        const isSeries = Boolean(movie?.isSeries || (movie?.type && ['tv-series', 'mini-series', 'animated-series', 'tv'].includes(movie.type)));
        if (!isSeries) return '';

        if (watchTarget.reason === 'RESUME_IN_PROGRESS' || (!progress.completed && progress.season != null && progress.episode != null)) {
            const seasonNum = progress.season;
            const episodeNum = progress.episode;
            
            let episodeTitle = null;
            if (Array.isArray(seasons)) {
                const sObj = seasons.find(s => (s.number ?? s.season_number) === seasonNum);
                if (sObj?.episodes) {
                    const epObj = sObj.episodes.find(e => (e.episodeNumber ?? e.episode_number ?? e.number) === episodeNum);
                    episodeTitle = epObj?.name || epObj?.title || epObj?.nameRu || null;
                }
            }
            if (!episodeTitle && progress.episodeLabel) {
                episodeTitle = progress.episodeLabel;
            }

            const timestamp = progress.timestamp || 0;
            const duration = progress.duration || null;
            const formattedTime = formatPlaybackTime(timestamp);
            
            let progressRowHtml = '';
            if (duration && duration > 0 && timestamp > 0) {
                const formattedDuration = formatPlaybackTime(duration);
                const percent = Math.min(100, Math.max(0, (timestamp / duration) * 100)).toFixed(1);
                progressRowHtml = `
                    <div class="seasons-continue-banner__progress-row">
                        <div class="seasons-continue-banner__progress-track">
                            <div class="seasons-continue-banner__progress-bar" style="width: ${percent}%;" role="progressbar" aria-valuenow="${timestamp}" aria-valuemin="0" aria-valuemax="${duration}" aria-label="Прогресс серии"></div>
                        </div>
                        <span class="seasons-continue-banner__time">${formattedTime} / ${formattedDuration}</span>
                    </div>
                `;
            } else if (timestamp > 0) {
                progressRowHtml = `
                    <div class="seasons-continue-banner__time-only">
                        <span class="seasons-continue-banner__time">${formattedTime}</span>
                    </div>
                `;
            }

            return `
                <div class="seasons-continue-banner seasons-continue-banner--resume" id="seasonsContinueBanner">
                    <div class="seasons-continue-banner__content">
                        <div class="seasons-continue-banner__header">
                            <span class="seasons-continue-banner__badge">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                <span>Продолжить просмотр</span>
                            </span>
                            <div class="seasons-continue-banner__target">
                                <span class="seasons-continue-banner__code">S${seasonNum}E${episodeNum}</span>
                                ${episodeTitle ? `<span class="seasons-continue-banner__title">${this.escapeHtml(episodeTitle)}</span>` : ''}
                            </div>
                        </div>
                        ${progressRowHtml}
                    </div>
                    <div class="seasons-continue-banner__actions">
                        <button type="button" 
                                class="btn btn-primary btn-sm seasons-continue-banner__btn" 
                                data-action="continue-watch-progress" 
                                data-season-number="${seasonNum}" 
                                data-episode-number="${episodeNum}" 
                                data-timestamp="${timestamp}"
                                aria-label="Продолжить просмотр S${seasonNum}E${episodeNum}">
                            <span class="play-icon" aria-hidden="true">▶</span> Продолжить
                        </button>
                    </div>
                </div>
            `;
        }

        if (watchTarget.reason === 'NEXT_AFTER_COMPLETED' && watchTarget.seasonNumber != null && watchTarget.episodeNumber != null) {
            const seasonNum = watchTarget.seasonNumber;
            const episodeNum = watchTarget.episodeNumber;
            const episodeTitle = watchTarget.episodeTitle || null;

            return `
                <div class="seasons-continue-banner seasons-continue-banner--next" id="seasonsContinueBanner">
                    <div class="seasons-continue-banner__content">
                        <div class="seasons-continue-banner__header">
                            <span class="seasons-continue-banner__badge seasons-continue-banner__badge--next">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                <span>Продолжить просмотр</span>
                            </span>
                            <div class="seasons-continue-banner__target">
                                <span class="seasons-continue-banner__subtitle">Следующая серия:</span>
                                <span class="seasons-continue-banner__code">S${seasonNum}E${episodeNum}</span>
                                ${episodeTitle ? `<span class="seasons-continue-banner__title">${this.escapeHtml(episodeTitle)}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="seasons-continue-banner__actions">
                        <button type="button" 
                                class="btn btn-primary btn-sm seasons-continue-banner__btn" 
                                data-action="continue-watch-progress" 
                                data-season-number="${seasonNum}" 
                                data-episode-number="${episodeNum}" 
                                data-timestamp="0"
                                aria-label="Смотреть следующую серию S${seasonNum}E${episodeNum}">
                            <span class="play-icon" aria-hidden="true">▶</span> Смотреть
                        </button>
                    </div>
                </div>
            `;
        }

        return '';
    }

    renderSeasonsTab(seasons, nextEpisode = null, lastEpisode = null, tmdbId = null, progress = this.currentProgressRecord, watchTarget = this.currentWatchTarget) {
        if (!Array.isArray(seasons) || seasons.length === 0) return '';

        const normalSeasons = seasons.filter(s => !s.isSpecial && s.number > 0);
        const specialSeasons = seasons.filter(s => s.isSpecial || s.number === 0);
        const hasMultipleSeasons = seasons.length > 1 || (normalSeasons.length === 1 && specialSeasons.length > 0);

        let targetSeasonNumber = null;
        if (watchTarget && watchTarget.seasonNumber != null) {
            targetSeasonNumber = watchTarget.seasonNumber;
        } else if (progress && progress.season != null) {
            targetSeasonNumber = progress.season;
        }

        const isTargetInSeasons = targetSeasonNumber != null && seasons.some(s => s.number === targetSeasonNumber);
        const initialActiveSeason = isTargetInSeasons
            ? targetSeasonNumber
            : (normalSeasons.length > 0 ? normalSeasons[0].number : seasons[0].number);
        const totalCount = normalSeasons.length > 0 ? normalSeasons.length : seasons.length;

        const continueBannerHtml = this.renderSeasonsContinueBanner(this.selectedMovie, progress, watchTarget, seasons);

        return `
            <div class="seasons-container">
                <div class="seasons-tab-header">
                    <h3 class="seasons-tab-title">Сезоны</h3>
                    <span class="seasons-tab-count">${totalCount} ${this.getPluralSeasons(totalCount)}</span>
                </div>

                ${continueBannerHtml}

                ${hasMultipleSeasons ? `
                <div class="seasons-nav-container">
                    <div class="seasons-nav-pills" role="tablist" aria-label="Выбор сезона">
                        ${normalSeasons.map(s => `
                            <button type="button" 
                                    class="season-pill-btn ${s.number === initialActiveSeason ? 'active' : ''}" 
                                    data-action="select-season-pill" 
                                    data-season-number="${s.number}" 
                                    role="tab" 
                                    aria-selected="${s.number === initialActiveSeason ? 'true' : 'false'}"
                                    aria-label="Сезон ${s.number}">
                                ${s.number}
                            </button>
                        `).join('')}
                    </div>
                </div>` : ''}

                <div class="seasons-grid">
                    ${seasons.map(s => {
                        const isCardActive = !hasMultipleSeasons || s.number === initialActiveSeason;
                        return `
                        <div class="season-card ${s.isSpecial ? 'season-card--special ' : ''}${isCardActive ? 'season-card--active' : 'season-card--hidden'}" 
                             data-season-number="${s.number}"
                             ${hasMultipleSeasons && !isCardActive ? 'style="display: none;"' : ''}>
                            <div class="season-title">${this.escapeHtml(s.name || `Сезон ${s.number}`)}</div>
                            <div id="season-episodes-${s.number}" class="season-episodes-panel">
                                ${Array.isArray(s.episodes) && s.episodes.length > 0 ? this.renderEpisodesList(s.episodes, nextEpisode, progress, watchTarget) : ''}
                            </div>
                        </div>
                    `;}).join('')}
                </div>
            </div>
        `;
    }

    renderEpisodesList(episodes, nextEpisode = null, progress = this.currentProgressRecord, watchTarget = this.currentWatchTarget) {
        if (!Array.isArray(episodes) || episodes.length === 0) return '';
        const now = new Date();

        return `
            <div class="episodes-grid">
                ${episodes.map(ep => {
                    const epSeason = Number(ep.seasonNumber || ep.season_number);
                    const epEpisode = Number(ep.episodeNumber || ep.episode_number);
                    const epAirDate = (ep.airDate || ep.air_date) ? new Date(ep.airDate || ep.air_date) : null;
                    const isUpcoming = epAirDate && !isNaN(epAirDate.getTime()) && epAirDate > now;
                    
                    const isScheduleNext = Boolean(
                        nextEpisode &&
                        epSeason === Number(nextEpisode.seasonNumber) &&
                        epEpisode === Number(nextEpisode.episodeNumber)
                    );

                    const isCurrentResume = Boolean(
                        progress &&
                        !progress.completed &&
                        progress.season != null &&
                        progress.episode != null &&
                        epSeason === Number(progress.season) &&
                        epEpisode === Number(progress.episode)
                    );

                    const isPersonalNext = Boolean(
                        watchTarget &&
                        watchTarget.reason === 'NEXT_AFTER_COMPLETED' &&
                        epSeason === Number(watchTarget.seasonNumber) &&
                        epEpisode === Number(watchTarget.episodeNumber)
                    );

                    const title = ep.name || `Серия ${epEpisode}`;
                    const isPlayable = this.isEpisodePlayableByDate(ep);

                    let cardClass = 'episode-card';
                    if (isCurrentResume) cardClass += ' episode-card--resume episode-card--current';
                    if (isPersonalNext) cardClass += ' episode-card--next-target';
                    if (isScheduleNext) cardClass += ' episode-card--next';
                    if (isUpcoming) cardClass += ' episode-card--upcoming';

                    let progressBarHtml = '';
                    if (isCurrentResume && progress.duration && progress.duration > 0 && progress.timestamp > 0) {
                        const percent = Math.min(100, Math.max(0, (progress.timestamp / progress.duration) * 100)).toFixed(1);
                        progressBarHtml = `
                            <div class="episode-card__progress-track">
                                <div class="episode-card__progress-bar" style="width: ${percent}%;" role="progressbar" aria-valuenow="${progress.timestamp}" aria-valuemin="0" aria-valuemax="${progress.duration}" aria-label="Прогресс серии"></div>
                            </div>
                        `;
                    }

                    return `
                        <div class="${cardClass}" data-season-number="${epSeason}" data-episode-number="${epEpisode}">
                            <div class="episode-title-group">
                                <span class="episode-code">S${epSeason}E${epEpisode}</span>
                                <h5 class="episode-title">${this.escapeHtml(title)}</h5>
                            </div>
                            <div class="episode-badges">
                                ${isCurrentResume ? '<span class="badge-resume-episode">Продолжить</span>' : ''}
                                ${isPersonalNext ? '<span class="badge-personal-next">Следующая для просмотра</span>' : ''}
                                ${isScheduleNext ? '<span class="badge-next-episode" title="Следующая по расписанию">Следующая по расписанию</span>' : ''}
                                ${isUpcoming ? '<span class="badge-upcoming">Ожидается</span>' : ''}
                            </div>

                            ${progressBarHtml}

                            <div class="episode-meta-row">
                                ${isPlayable ? `
                                    <button type="button" 
                                            class="episode-card__play-btn ${isCurrentResume ? 'episode-card__play-btn--resume' : ''}" 
                                            data-action="play-episode" 
                                            data-season-number="${epSeason}" 
                                            data-episode-number="${epEpisode}" 
                                            data-timestamp="${isCurrentResume ? (progress.timestamp || 0) : 0}"
                                            aria-label="${isCurrentResume ? 'Продолжить просмотр' : 'Смотреть'} S${epSeason}E${epEpisode} — ${this.escapeHtml(title)}">
                                        <span class="play-icon" aria-hidden="true">▶</span> ${isCurrentResume ? 'Продолжить' : 'Смотреть'}
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }
}

// Series Fixture
const sampleSeries = {
    kinopoiskId: 401,
    nameRu: 'Матрица',
    type: 'tv-series',
    isSeries: true,
    seasons: [
        {
            number: 1,
            name: 'Сезон 1',
            episodeCount: 3,
            episodes: [
                { seasonNumber: 1, episodeNumber: 1, name: 'Пилот', airDate: '2020-01-01' },
                { seasonNumber: 1, episodeNumber: 2, name: 'Эпизод 2', airDate: '2020-01-08' },
                { seasonNumber: 1, episodeNumber: 3, name: 'Финал 1 сезона', airDate: '2020-01-15' }
            ]
        },
        {
            number: 2,
            name: 'Сезон 2',
            episodeCount: 2,
            episodes: [
                { seasonNumber: 2, episodeNumber: 1, name: 'Премьера 2 сезона', airDate: '2021-02-01' },
                { seasonNumber: 2, episodeNumber: 2, name: 'Финал 2 сезона', airDate: '2021-02-08' }
            ]
        },
        {
            number: 3,
            name: 'Сезон 3',
            episodeCount: 7,
            episodes: [
                { seasonNumber: 3, episodeNumber: 1, name: 'Серия 1', airDate: '2022-01-01' },
                { seasonNumber: 3, episodeNumber: 2, name: 'Серия 2', airDate: '2022-01-08' },
                { seasonNumber: 3, episodeNumber: 7, name: 'Семерка', airDate: '2022-02-15' }
            ]
        }
    ]
};

async function runTests() {
    console.log('=== Starting MovieDetails Phase 4A Tests ===\n');
    const manager = new MockMovieDetailsManager();
    manager.selectedMovie = sampleSeries;

    // Test 1: formatPlaybackTime helper
    console.log('Test 1: formatPlaybackTime');
    assert.strictEqual(formatPlaybackTime(842), '14:02', '842 seconds should format to 14:02');
    assert.strictEqual(formatPlaybackTime(3705), '1:01:45', '3705 seconds should format to 1:01:45');
    assert.strictEqual(formatPlaybackTime(0), '00:00', '0 seconds should format to 00:00');
    assert.strictEqual(formatPlaybackTime(null), '00:00', 'null should format to 00:00');
    assert.strictEqual(formatPlaybackTime(-10), '00:00', 'Negative seconds should format to 00:00');
    console.log('  Passed formatPlaybackTime assertions.');

    // Test 2: normalizeProgressRecord schema
    console.log('Test 2: normalizeProgressRecord schema');
    const rec = normalizeProgressRecord({
        movieId: 401,
        season: 3,
        episode: 7,
        timestamp: 842,
        duration: 2538,
        completed: false,
        providerId: 'seasonvar',
        updatedAt: 1718800000000
    });
    assert.strictEqual(rec.movieId, 401);
    assert.strictEqual(rec.season, 3);
    assert.strictEqual(rec.episode, 7);
    assert.strictEqual(rec.timestamp, 842);
    assert.strictEqual(rec.duration, 2538);
    assert.strictEqual(rec.completed, false);
    assert.strictEqual(rec.providerId, 'seasonvar');
    assert.strictEqual(rec.updatedAt, 1718800000000);
    console.log('  Passed normalizeProgressRecord schema assertions.');

    // Test 3: Incomplete progress -> Continue Watching banner
    console.log('Test 3: Incomplete progress banner (RESUME_IN_PROGRESS)');
    const progressIncomplete = {
        movieId: 401,
        season: 3,
        episode: 7,
        timestamp: 842,
        duration: 2538,
        completed: false,
        providerId: 'seasonvar'
    };
    const targetIncomplete = resolveWatchTarget(sampleSeries, progressIncomplete);
    assert.strictEqual(targetIncomplete.reason, 'RESUME_IN_PROGRESS');
    assert.strictEqual(targetIncomplete.seasonNumber, 3);
    assert.strictEqual(targetIncomplete.episodeNumber, 7);
    assert.strictEqual(targetIncomplete.initialTimestamp, 842);

    const bannerHtml1 = manager.renderSeasonsContinueBanner(sampleSeries, progressIncomplete, targetIncomplete, sampleSeries.seasons);
    assert.ok(bannerHtml1.includes('seasons-continue-banner--resume'), 'Should have resume banner class');
    assert.ok(bannerHtml1.includes('S3E7'), 'Should display S3E7');
    assert.ok(bannerHtml1.includes('14:02 / 42:18'), 'Should display formatted timestamp / duration');
    assert.ok(bannerHtml1.includes('data-timestamp="842"'), 'Should embed resume timestamp 842');
    assert.ok(bannerHtml1.includes('Продолжить'), 'Button should say Продолжить');
    console.log('  Passed Incomplete progress banner assertions.');

    // Test 4: Completed progress -> Next episode banner
    console.log('Test 4: Completed progress banner (NEXT_AFTER_COMPLETED)');
    const progressCompletedS1E3 = {
        movieId: 401,
        season: 1,
        episode: 3,
        timestamp: 2500,
        duration: 2500,
        completed: true,
        providerId: 'seasonvar'
    };
    const targetCompletedS1E3 = resolveWatchTarget(sampleSeries, progressCompletedS1E3);
    assert.strictEqual(targetCompletedS1E3.reason, 'NEXT_AFTER_COMPLETED');
    assert.strictEqual(targetCompletedS1E3.seasonNumber, 2);
    assert.strictEqual(targetCompletedS1E3.episodeNumber, 1);
    assert.strictEqual(targetCompletedS1E3.initialTimestamp, 0);

    const bannerHtml2 = manager.renderSeasonsContinueBanner(sampleSeries, progressCompletedS1E3, targetCompletedS1E3, sampleSeries.seasons);
    assert.ok(bannerHtml2.includes('seasons-continue-banner--next'), 'Should have next banner class');
    assert.ok(bannerHtml2.includes('Следующая серия:'), 'Should display subtitle Следующая серия:');
    assert.ok(bannerHtml2.includes('S2E1'), 'Should display target S2E1');
    assert.ok(bannerHtml2.includes('Смотреть'), 'Button should say Смотреть');
    console.log('  Passed Completed progress banner assertions.');

    // Test 5: New series or finale completed -> No continue banner
    console.log('Test 5: New series / Series finale -> No banner');
    const targetNew = resolveWatchTarget(sampleSeries, null);
    assert.strictEqual(targetNew.reason, 'NEW_SERIES');
    assert.strictEqual(manager.renderSeasonsContinueBanner(sampleSeries, null, targetNew, sampleSeries.seasons), '');

    const progressFinale = {
        movieId: 401,
        season: 3,
        episode: 7,
        timestamp: 2500,
        duration: 2500,
        completed: true,
        providerId: 'seasonvar'
    };
    const targetFinale = resolveWatchTarget(sampleSeries, progressFinale);
    assert.strictEqual(targetFinale.reason, 'FINAL_EPISODE_COMPLETED');
    assert.strictEqual(manager.renderSeasonsContinueBanner(sampleSeries, progressFinale, targetFinale, sampleSeries.seasons), '');
    console.log('  Passed New series / finale banner omission assertions.');

    // Test 6: Season pill auto-focus
    console.log('Test 6: Season pill auto-focus to target season');
    const tabHtml = manager.renderSeasonsTab(sampleSeries.seasons, null, null, null, progressIncomplete, targetIncomplete);
    assert.ok(tabHtml.includes('data-season-number="3" \n                                    role="tab" \n                                    aria-selected="true"'), 'Season 3 pill should be active');
    console.log('  Passed Season pill auto-focus assertions.');

    // Test 7: Episode card progress styling & NO false history checkmarks
    console.log('Test 7: Episode card progress styling & NO false history');
    const s3Episodes = sampleSeries.seasons[2].episodes;
    const episodesListHtml = manager.renderEpisodesList(s3Episodes, null, progressIncomplete, targetIncomplete);

    // S3E7 should receive resume styling
    assert.ok(episodesListHtml.includes('episode-card--resume'), 'S3E7 card should have resume class');
    assert.ok(episodesListHtml.includes('badge-resume-episode'), 'S3E7 should have badge-resume-episode');
    assert.ok(episodesListHtml.includes('episode-card__progress-bar'), 'S3E7 should have progress bar');
    assert.ok(episodesListHtml.includes('data-timestamp="842"'), 'Play button should have timestamp 842');

    // S3E1 and S3E2 must NOT have watched checkmarks or fake watched state
    assert.ok(!episodesListHtml.includes('badge-watched'), 'Must NOT invent fake watched badge');
    assert.ok(!episodesListHtml.includes('episode-card--watched'), 'Must NOT invent fake watched card class');

    // Test 8: TMDB next episode vs personal next target distinct badges
    console.log('Test 8: Distinct TMDB next vs Personal next target badges');
    const tmdbNext = { seasonNumber: 3, episodeNumber: 2 };
    const mixedListHtml = manager.renderEpisodesList(s3Episodes, tmdbNext, progressCompletedS1E3, { reason: 'NEXT_AFTER_COMPLETED', seasonNumber: 3, episodeNumber: 1 });
    assert.ok(mixedListHtml.includes('badge-personal-next'), 'Personal target should have badge-personal-next (Следующая для просмотра)');
    assert.ok(mixedListHtml.includes('badge-next-episode'), 'TMDB schedule should have badge-next-episode (Следующая)');
    console.log('  Passed distinct badge assertions.');

    console.log('\n=== All MovieDetails Phase 4A Tests Passed Successfully! ===');
}

runTests().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});
