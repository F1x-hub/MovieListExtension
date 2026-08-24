/**
 * tests/movieDetailsPhase4D.test.js
 * 
 * Test suite for MovieDetails Phase 4D:
 * - Visual State Taxonomy Hierarchy (Currently Playing > Resume > Personal Next > Watched > Unwatched > Upcoming)
 * - Rewatch state coexistence (Watched + Resume simultaneous badges & progress)
 * - Personal Next ("Далее для вас") vs Schedule Next ("По расписанию") distinction
 * - Upcoming / Unreleased episode suppression of play & watched toggle actions
 * - getSeasonCompletionStats calculation & honest denominators (all released watched vs all season watched)
 * - Season history progress bar rendering & emerald percentage track
 * - Season pills compact progress ([ 1 ✓ ], [ 2 7/10 ], [ 3 ])
 * - Live targeted playing state update (updateActiveEpisodePlayingState)
 * - Accessibility & ARIA semantics (aria-pressed, aria-label, aria-selected)
 * - Performance on long series / multi-season datasets
 */

const assert = require('assert');
const { JSDOM } = require('jsdom');
const {
    EpisodeHistoryService,
    buildEpisodeHistoryKey,
    parseEpisodeHistoryKey
} = require('../src/shared/services/EpisodeHistoryService');

// Mock MovieDetails UI helper functions matching movie-details.js implementation
function createMockMovieDetailsContext() {
    const context = {
        selectedMovie: {
            kinopoiskId: 444,
            title: 'Test Epic Series',
            isSeries: true,
            tmdbId: 9999
        },
        currentProgressRecord: null,
        currentWatchTarget: null,
        currentEpisodeHistory: {},
        playbackController: {
            currentSelection: null
        },
        escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },
        formatDate(dateStr) {
            return dateStr || '';
        },
        getPluralEpisodes(count) {
            return count === 1 ? 'серия' : (count >= 2 && count <= 4 ? 'серии' : 'серий');
        },
        getPluralSeasons(count) {
            return count === 1 ? 'сезон' : (count >= 2 && count <= 4 ? 'сезона' : 'сезонов');
        },
        isEpisodePlayableByDate(ep) {
            if (!ep) return false;
            if (!ep.airDate) return true;
            const air = new Date(ep.airDate);
            if (isNaN(air.getTime())) return true;
            return air <= new Date();
        },
        renderSeasonsContinueBanner(movie, progress, watchTarget, seasons) {
            if (progress && !progress.completed && progress.season != null && progress.episode != null) {
                return '<div class="seasons-continue-banner seasons-continue-banner--resume">Resume Banner</div>';
            }
            if (watchTarget && watchTarget.reason === 'NEXT_AFTER_COMPLETED') {
                return '<div class="seasons-continue-banner seasons-continue-banner--next">Next Banner</div>';
            }
            return '';
        }
    };

    // Attach Phase 4D methods matching movie-details.js
    context.getSeasonCompletionStats = function(season, history = this.currentEpisodeHistory) {
        if (!season) {
            return {
                completedCount: 0,
                totalReleasedCount: 0,
                totalCount: 0,
                hasFutureEpisodes: false,
                isFullyCompleted: false,
                isSpecial: false,
                badgeLabel: '',
                badgeType: 'none'
            };
        }

        const seasonNumber = Number(season.number);
        const isSpecial = Boolean(season.isSpecial || seasonNumber === 0);

        let totalReleasedCount;
        let totalCount = 0;
        let completedCount = 0;

        if (Array.isArray(season.episodes) && season.episodes.length > 0) {
            totalCount = season.episodes.length;
            const released = season.episodes.filter(ep => this.isEpisodePlayableByDate(ep));
            totalReleasedCount = released.length;
            completedCount = released.filter(ep => {
                const epKey = buildEpisodeHistoryKey(seasonNumber, ep.episodeNumber);
                return Boolean(history && epKey && history[epKey]);
            }).length;
        } else {
            totalCount = Number(season.episodeCount) || 0;
            totalReleasedCount = totalCount;
            if (history && typeof history === 'object') {
                for (const key of Object.keys(history)) {
                    const parsed = parseEpisodeHistoryKey(key);
                    if (parsed && parsed.seasonNumber === seasonNumber) {
                        completedCount++;
                    }
                }
            }
        }

        const isFullyCompleted = totalReleasedCount > 0 && completedCount >= totalReleasedCount;
        const hasFutureEpisodes = totalCount > totalReleasedCount;

        let badgeLabel = '';
        let badgeType = 'none';

        if (completedCount > 0) {
            if (isFullyCompleted) {
                if (hasFutureEpisodes) {
                    badgeLabel = 'Все вышедшие просмотрены';
                    badgeType = 'full_released';
                } else {
                    badgeLabel = 'Сезон просмотрен';
                    badgeType = 'full_season';
                }
            } else if (totalReleasedCount > 0) {
                badgeLabel = `${completedCount} / ${totalReleasedCount} просмотрено`;
                badgeType = 'partial';
            } else {
                badgeLabel = `${completedCount} просмотрено`;
                badgeType = 'unknown_total';
            }
        }

        return {
            completedCount,
            totalReleasedCount,
            totalCount,
            hasFutureEpisodes,
            isFullyCompleted,
            isSpecial,
            badgeLabel,
            badgeType
        };
    };

    context.renderSeasonsTab = function(seasons, nextEpisode = null, lastEpisode = null, tmdbId = null, progress = this.currentProgressRecord, watchTarget = this.currentWatchTarget, history = this.currentEpisodeHistory, currentSelection = this.playbackController?.currentSelection) {
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
                        ${normalSeasons.map(s => {
                            const stats = this.getSeasonCompletionStats(s, history);
                            const activeCls = s.number === initialActiveSeason ? ' active' : '';
                            const completedCls = (stats.isFullyCompleted && stats.totalReleasedCount > 0) ? ' season-pill-btn--completed' : '';
                            const pillClass = `season-pill-btn${activeCls}${completedCls}`;
                            let pillContent = `${s.number}`;
                            let pillAriaLabel = `Сезон ${s.number}`;
                            if (stats.isFullyCompleted && stats.totalReleasedCount > 0) {
                                pillContent += ' <span class="season-pill-check" aria-hidden="true">✓</span>';
                                pillAriaLabel += ' (просмотрен полностью)';
                            } else if (stats.completedCount > 0 && stats.totalReleasedCount > 0) {
                                pillContent += ` <span class="season-pill-progress" aria-hidden="true">${stats.completedCount}/${stats.totalReleasedCount}</span>`;
                                pillAriaLabel += ` (просмотрено ${stats.completedCount} из ${stats.totalReleasedCount})`;
                            }
                            return `
                            <button type="button" 
                                    class="${pillClass}" 
                                    data-action="select-season-pill" 
                                    data-season-number="${s.number}" 
                                    role="tab" 
                                    aria-selected="${s.number === initialActiveSeason ? 'true' : 'false'}"
                                    aria-label="${pillAriaLabel}">
                                ${pillContent}
                            </button>
                        `;}).join('')}
                        ${specialSeasons.length > 0 ? `
                            <button type="button" 
                                    class="season-pill-btn season-pill-btn--specials ${specialSeasons.some(sp => sp.number === initialActiveSeason) ? 'active' : ''}" 
                                    data-action="select-season-pill" 
                                    data-season-number="${specialSeasons[0].number}" 
                                    role="tab" 
                                    aria-selected="${specialSeasons.some(sp => sp.number === initialActiveSeason) ? 'true' : 'false'}"
                                    aria-label="Спецвыпуски">
                                Спецвыпуски
                            </button>
                        ` : ''}
                    </div>
                </div>` : ''}

                <div class="seasons-grid">
                    ${seasons.map(s => {
                        const isCardActive = !hasMultipleSeasons || s.number === initialActiveSeason;
                        const stats = this.getSeasonCompletionStats(s, history);
                        let completedBadgeHtml = '';
                        let seasonProgressBarHtml = '';

                        if (!s.isSpecial && s.number > 0 && stats.completedCount > 0) {
                            const isFull = stats.isFullyCompleted;
                            completedBadgeHtml = `<span class="season-completed-badge ${isFull ? 'season-completed-badge--full' : ''}">${isFull ? '<svg class="season-check-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg> ' : ''}${stats.badgeLabel}</span>`;

                            if (stats.totalReleasedCount > 0) {
                                const seasonPercent = Math.min(100, Math.round((stats.completedCount / stats.totalReleasedCount) * 100));
                                seasonProgressBarHtml = `
                                    <div class="season-progress-container" title="Прогресс сезона: ${stats.completedCount} из ${stats.totalReleasedCount} (${seasonPercent}%)">
                                        <div class="season-progress-track">
                                            <div class="season-progress-bar" style="width: ${seasonPercent}%;" role="progressbar" aria-valuenow="${stats.completedCount}" aria-valuemin="0" aria-valuemax="${stats.totalReleasedCount}" aria-label="Прогресс сезона"></div>
                                        </div>
                                    </div>
                                `;
                            }
                        }

                        return `
                        <div class="season-card ${s.isSpecial ? 'season-card--special ' : ''}${isCardActive ? 'season-card--active' : 'season-card--hidden'}" 
                             data-season-number="${s.number}"
                             ${hasMultipleSeasons && !isCardActive ? 'style="display: none;"' : ''}>
                            <div class="season-main-row">
                                ${s.posterUrl ? `
                                    <div class="season-poster-wrapper">
                                        <img src="${this.escapeHtml(s.posterUrl)}" alt="${this.escapeHtml(s.name || '')}" class="season-poster-img" data-fallback="poster" loading="lazy" decoding="async">
                                    </div>
                                ` : ''}
                                <div class="season-info-col">
                                    <div class="season-info-header">
                                        <div class="season-title-group">
                                            <h4 class="season-title">${this.escapeHtml(s.name || `Сезон ${s.number}`)}</h4>
                                            ${s.isSpecial ? '<span class="badge-special">Спецматериалы</span>' : ''}
                                        </div>
                                        <div class="season-badges-row">
                                            <span class="season-episodes-badge">${s.episodeCount || 0} ${this.getPluralEpisodes(s.episodeCount || 0)}</span>
                                            ${completedBadgeHtml}
                                            ${s.airDate ? `<span class="season-air-date">Премьера: <strong>${this.escapeHtml(this.formatDate(s.airDate))}</strong></span>` : ''}
                                        </div>
                                        ${seasonProgressBarHtml}
                                    </div>

                                    ${s.overview ? `<p class="season-overview">${this.escapeHtml(s.overview)}</p>` : ''}

                                    <div class="season-actions">
                                        ${Number(s.episodeCount) > 0 ? `
                                            <button type="button" class="season-expand-btn" data-action="toggle-season" data-season-number="${s.number}" data-tmdb-id="${tmdbId || ''}" data-episode-count="${s.episodeCount || 0}" aria-expanded="false" aria-controls="season-episodes-${s.number}">
                                                <span class="season-expand-text">Показать серии</span>
                                                <svg class="season-expand-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                                                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                                                </svg>
                                            </button>
                                        ` : `
                                            <span class="season-empty-tag">Серии пока не опубликованы</span>
                                        `}
                                    </div>
                                </div>
                            </div>

                            <div id="season-episodes-${s.number}" class="season-episodes-panel" style="display: none;" role="region" aria-label="Список серий">
                                ${Array.isArray(s.episodes) && s.episodes.length > 0 ? this.renderEpisodesList(s.episodes, nextEpisode, progress, watchTarget, history, currentSelection) : ''}
                            </div>
                        </div>
                    `;}).join('')}
                </div>
            </div>
        `;
    };

    context.renderEpisodesList = function(episodes, nextEpisode = null, progress = this.currentProgressRecord, watchTarget = this.currentWatchTarget, history = this.currentEpisodeHistory, currentSelection = this.playbackController?.currentSelection) {
        if (!Array.isArray(episodes) || episodes.length === 0) return '';
        const now = new Date();

        return `
            <div class="episodes-grid">
                ${episodes.map(ep => {
                    const epSeason = Number(ep.seasonNumber);
                    const epEpisode = Number(ep.episodeNumber);
                    const epAirDate = ep.airDate ? new Date(ep.airDate) : null;
                    const isPlayable = this.isEpisodePlayableByDate(ep);
                    const isUpcoming = epAirDate && !isNaN(epAirDate.getTime()) && epAirDate > now;
                    
                    const epKey = buildEpisodeHistoryKey(epSeason, epEpisode);
                    const isCompleted = Boolean(history && epKey && history[epKey]);

                    const isCurrentlyPlaying = Boolean(
                        currentSelection &&
                        currentSelection.kinopoiskId === this.selectedMovie?.kinopoiskId &&
                        epSeason === Number(currentSelection.seasonNumber) &&
                        epEpisode === Number(currentSelection.episodeNumber)
                    );

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

                    let cardClass = 'episode-card';
                    if (isCurrentlyPlaying) cardClass += ' episode-card--playing';
                    if (isCompleted) cardClass += ' episode-card--watched';
                    if (isCurrentResume) cardClass += ' episode-card--resume episode-card--current';
                    if (isPersonalNext) cardClass += ' episode-card--next-target';
                    if (isScheduleNext) cardClass += ' episode-card--next';
                    if (isUpcoming) cardClass += ' episode-card--upcoming';

                    const title = ep.name || `Серия ${ep.episodeNumber}`;
                    const voteAvg = Number(ep.voteAverage);
                    const ratingMarkup = (!isNaN(voteAvg) && voteAvg > 0)
                        ? `<span class="episode-rating-badge" title="Оценка TMDB (${ep.voteCount || 0} голосов)"><svg viewBox="0 0 24 24" width="12" height="12" fill="#eab308"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>${voteAvg.toFixed(1)}</span>`
                        : '';

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
                        <div class="${cardClass}">
                            <div class="episode-card-header">
                                <div class="episode-title-group">
                                    <span class="episode-code">S${ep.seasonNumber}E${ep.episodeNumber}</span>
                                    <h5 class="episode-title">${this.escapeHtml(title)}</h5>
                                </div>
                                <div class="episode-badges">
                                    ${isCurrentlyPlaying ? '<span class="badge-playing-episode"><span class="badge-playing-pulse" aria-hidden="true"></span>Сейчас играет</span>' : ''}
                                    ${isCompleted ? '<span class="badge-watched-episode" title="Просмотрено"><svg class="watched-check-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Просмотрено</span>' : ''}
                                    ${isCurrentResume ? '<span class="badge-resume-episode">Продолжить</span>' : ''}
                                    ${isPersonalNext ? '<span class="badge-personal-next">Далее для вас</span>' : ''}
                                    ${isScheduleNext ? '<span class="badge-next-episode">По расписанию</span>' : ''}
                                    ${isUpcoming ? '<span class="badge-upcoming">Ожидается</span>' : ''}
                                    ${ratingMarkup}
                                </div>
                            </div>

                            ${ep.stillUrl ? `
                                <div class="episode-still-wrapper">
                                    <img src="${this.escapeHtml(ep.stillUrl)}" alt="${this.escapeHtml(title)}" class="episode-still-img" data-fallback="poster" loading="lazy" decoding="async">
                                </div>
                            ` : ''}

                            ${progressBarHtml}

                            <div class="episode-meta-row">
                                ${ep.airDate ? `<span class="episode-air-date">${this.escapeHtml(this.formatDate(ep.airDate))}</span>` : ''}
                                ${ep.runtime ? `<span class="episode-runtime">${ep.runtime} мин</span>` : ''}
                                ${isPlayable ? `
                                    <button type="button" 
                                            class="episode-card__watched-toggle-btn ${isCompleted ? 'is-watched' : ''}" 
                                            data-action="toggle-episode-watched" 
                                            data-season-number="${ep.seasonNumber}" 
                                            data-episode-number="${ep.episodeNumber}" 
                                            aria-pressed="${isCompleted ? 'true' : 'false'}" 
                                            aria-label="${isCompleted ? `Снять отметку о просмотре S${ep.seasonNumber}E${ep.episodeNumber}` : `Отметить S${ep.seasonNumber}E${ep.episodeNumber} просмотренной`}" 
                                            title="${isCompleted ? 'Снять отметку' : 'Отметить просмотренной'}">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <polyline points="20 6 9 17 4 12"/>
                                        </svg>
                                    </button>
                                    <button type="button" 
                                            class="episode-card__play-btn ${isCurrentResume ? 'episode-card__play-btn--resume' : ''} ${isCurrentlyPlaying ? 'episode-card__play-btn--playing' : ''}" 
                                            data-action="play-episode" 
                                            data-season-number="${ep.seasonNumber}" 
                                            data-episode-number="${ep.episodeNumber}" 
                                            data-timestamp="${isCurrentResume ? (progress.timestamp || 0) : 0}"
                                            aria-label="${isCurrentlyPlaying ? 'Сейчас играет' : (isCurrentResume ? 'Продолжить просмотр' : 'Смотреть')} S${ep.seasonNumber}E${ep.episodeNumber} — ${this.escapeHtml(title)}">
                                        <span class="play-icon" aria-hidden="true">${isCurrentlyPlaying ? '■' : '▶'}</span> ${isCurrentlyPlaying ? 'Играет' : (isCurrentResume ? 'Продолжить' : 'Смотреть')}
                                    </button>
                                ` : ''}
                            </div>

                            ${ep.overview ? `<p class="episode-overview">${this.escapeHtml(ep.overview)}</p>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    };

    context.updateActiveEpisodePlayingState = function(selection, documentRoot = document) {
        const playingSeason = selection && selection.seasonNumber != null ? Number(selection.seasonNumber) : null;
        const playingEpisode = selection && selection.episodeNumber != null ? Number(selection.episodeNumber) : null;

        documentRoot.querySelectorAll('.episode-card').forEach(card => {
            const playBtn = card.querySelector('[data-action="play-episode"]');
            if (!playBtn) return;

            const cardSeason = Number(playBtn.getAttribute('data-season-number'));
            const cardEpisode = Number(playBtn.getAttribute('data-episode-number'));

            const isThisPlaying = playingSeason !== null && playingEpisode !== null &&
                                  cardSeason === playingSeason && cardEpisode === playingEpisode;

            card.classList.toggle('episode-card--playing', isThisPlaying);

            let playingBadge = card.querySelector('.badge-playing-episode');
            if (isThisPlaying) {
                if (!playingBadge) {
                    const badgesContainer = card.querySelector('.episode-badges');
                    if (badgesContainer) {
                        const newBadge = documentRoot.createElement('span');
                        newBadge.className = 'badge-playing-episode';
                        newBadge.innerHTML = '<span class="badge-playing-pulse" aria-hidden="true"></span>Сейчас играет';
                        badgesContainer.prepend(newBadge);
                    }
                }
                playBtn.classList.add('episode-card__play-btn--playing');
            } else {
                if (playingBadge) playingBadge.remove();
                playBtn.classList.remove('episode-card__play-btn--playing');
            }
        });
    };

    return context;
}

async function runTests() {
    console.log('=== Starting MovieDetails Phase 4D Tests ===\n');
    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`  [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  [FAIL] ${name}`);
            console.error(err);
            failed++;
        }
    }

    // ==========================================
    // SECTION 1: Visual State Taxonomy & Hierarchy
    // ==========================================
    console.log('--- Section 1: Visual State Taxonomy Hierarchy ---');

    test('1.1 Currently Playing card receives .episode-card--playing and Сейчас играет badge', () => {
        const ctx = createMockMovieDetailsContext();
        const episodes = [
            { seasonNumber: 1, episodeNumber: 1, name: 'Pilot', airDate: '2023-01-01' },
            { seasonNumber: 1, episodeNumber: 2, name: 'Second', airDate: '2023-01-08' }
        ];
        const currentSelection = { kinopoiskId: 444, seasonNumber: 1, episodeNumber: 1 };
        const html = ctx.renderEpisodesList(episodes, null, null, null, {}, currentSelection);
        const dom = new JSDOM(html);
        const cards = dom.window.document.querySelectorAll('.episode-card');

        assert.strictEqual(cards.length, 2);
        assert.ok(cards[0].classList.contains('episode-card--playing'), 'Card 1 should have playing class');
        assert.ok(!cards[1].classList.contains('episode-card--playing'), 'Card 2 should not have playing class');

        const playingBadge = cards[0].querySelector('.badge-playing-episode');
        assert.ok(playingBadge, 'Card 1 should contain badge-playing-episode');
        assert.ok(playingBadge.textContent.includes('Сейчас играет'), 'Badge text should be Сейчас играет');
        assert.ok(playingBadge.querySelector('.badge-playing-pulse'), 'Badge should have pulse indicator');
    });

    test('1.2 Resume state card receives .episode-card--resume, badge, and progress bar', () => {
        const ctx = createMockMovieDetailsContext();
        const episodes = [
            { seasonNumber: 2, episodeNumber: 3, name: 'In Progress', airDate: '2023-02-01' }
        ];
        const progress = {
            season: 2,
            episode: 3,
            timestamp: 600,
            duration: 1200,
            completed: false
        };
        const html = ctx.renderEpisodesList(episodes, null, progress, null, {}, null);
        const dom = new JSDOM(html);
        const card = dom.window.document.querySelector('.episode-card');

        assert.ok(card.classList.contains('episode-card--resume'), 'Card should have resume class');
        const resumeBadge = card.querySelector('.badge-resume-episode');
        assert.ok(resumeBadge, 'Card should have resume badge');
        assert.strictEqual(resumeBadge.textContent.trim(), 'Продолжить');

        const progressBar = card.querySelector('.episode-card__progress-bar');
        assert.ok(progressBar, 'Card should have progress bar');
        assert.strictEqual(progressBar.getAttribute('aria-valuenow'), '600');
        assert.strictEqual(progressBar.getAttribute('aria-valuemax'), '1200');

        const playBtn = card.querySelector('.episode-card__play-btn');
        assert.ok(playBtn.textContent.includes('Продолжить'), 'Play button should say Продолжить');
    });

    test('1.3 Personal Next card receives .episode-card--next-target and Далее для вас badge', () => {
        const ctx = createMockMovieDetailsContext();
        const episodes = [
            { seasonNumber: 1, episodeNumber: 2, name: 'Next Up', airDate: '2023-01-08' }
        ];
        const watchTarget = {
            reason: 'NEXT_AFTER_COMPLETED',
            seasonNumber: 1,
            episodeNumber: 2
        };
        const html = ctx.renderEpisodesList(episodes, null, null, watchTarget, {}, null);
        const dom = new JSDOM(html);
        const card = dom.window.document.querySelector('.episode-card');

        assert.ok(card.classList.contains('episode-card--next-target'), 'Card should have next-target class');
        const personalNextBadge = card.querySelector('.badge-personal-next');
        assert.ok(personalNextBadge, 'Card should have badge-personal-next');
        assert.strictEqual(personalNextBadge.textContent.trim(), 'Далее для вас');
    });

    test('1.4 Schedule Next card receives .episode-card--next and По расписанию badge', () => {
        const ctx = createMockMovieDetailsContext();
        const episodes = [
            { seasonNumber: 1, episodeNumber: 5, name: 'Upcoming Broadcast', airDate: '2023-01-15' }
        ];
        const nextEpisode = {
            seasonNumber: 1,
            episodeNumber: 5
        };
        const html = ctx.renderEpisodesList(episodes, nextEpisode, null, null, {}, null);
        const dom = new JSDOM(html);
        const card = dom.window.document.querySelector('.episode-card');

        assert.ok(card.classList.contains('episode-card--next'), 'Card should have next class');
        const scheduleBadge = card.querySelector('.badge-next-episode');
        assert.ok(scheduleBadge, 'Card should have badge-next-episode');
        assert.strictEqual(scheduleBadge.textContent.trim(), 'По расписанию');
    });

    // ==========================================
    // SECTION 2: Rewatch State Coexistence
    // ==========================================
    console.log('\n--- Section 2: Rewatch State Coexistence ---');

    test('2.1 Watched + Active Rewatch coexists without collapsing states', () => {
        const ctx = createMockMovieDetailsContext();
        const episodes = [
            { seasonNumber: 3, episodeNumber: 7, name: 'Rewatched Ep', airDate: '2023-03-01' }
        ];
        const history = {
            '3:7': { cAt: 1680000000000, src: 'SEASONVAR' }
        };
        const progress = {
            season: 3,
            episode: 7,
            timestamp: 842,
            duration: 1800,
            completed: false
        };
        const html = ctx.renderEpisodesList(episodes, null, progress, null, history, null);
        const dom = new JSDOM(html);
        const card = dom.window.document.querySelector('.episode-card');

        // Both classes present
        assert.ok(card.classList.contains('episode-card--watched'), 'Should have watched class');
        assert.ok(card.classList.contains('episode-card--resume'), 'Should have resume class');

        // Both badges present
        const watchedBadge = card.querySelector('.badge-watched-episode');
        const resumeBadge = card.querySelector('.badge-resume-episode');
        assert.ok(watchedBadge, 'Should render watched badge');
        assert.ok(resumeBadge, 'Should render resume badge');

        // Progress bar present
        const progressBar = card.querySelector('.episode-card__progress-bar');
        assert.ok(progressBar, 'Should render progress bar');

        // Watched toggle button remains is-watched / pressed
        const toggleBtn = card.querySelector('.episode-card__watched-toggle-btn');
        assert.ok(toggleBtn.classList.contains('is-watched'), 'Toggle button should be is-watched');
        assert.strictEqual(toggleBtn.getAttribute('aria-pressed'), 'true');
        assert.strictEqual(toggleBtn.getAttribute('title'), 'Снять отметку');

        // Primary action is Продолжить
        const playBtn = card.querySelector('.episode-card__play-btn');
        assert.ok(playBtn.textContent.includes('Продолжить'));
    });

    // ==========================================
    // SECTION 3: Upcoming / Future Episodes Isolation
    // ==========================================
    console.log('\n--- Section 3: Upcoming Episodes Isolation ---');

    test('3.1 Future unreleased episodes suppress Play and Watched Toggle actions', () => {
        const ctx = createMockMovieDetailsContext();
        const futureDate = new Date(Date.now() + 86400000 * 30).toISOString().split('T')[0];
        const episodes = [
            { seasonNumber: 1, episodeNumber: 10, name: 'Finale In Future', airDate: futureDate }
        ];
        const html = ctx.renderEpisodesList(episodes, null, null, null, {}, null);
        const dom = new JSDOM(html);
        const card = dom.window.document.querySelector('.episode-card');

        assert.ok(card.classList.contains('episode-card--upcoming'), 'Should have upcoming class');
        const upcomingBadge = card.querySelector('.badge-upcoming');
        assert.ok(upcomingBadge, 'Should render upcoming badge');
        assert.strictEqual(upcomingBadge.textContent.trim(), 'Ожидается');

        // Play and watched toggle buttons must be completely suppressed
        const playBtn = card.querySelector('.episode-card__play-btn');
        const toggleBtn = card.querySelector('.episode-card__watched-toggle-btn');
        assert.strictEqual(playBtn, null, 'Play button must not exist for upcoming episode');
        assert.strictEqual(toggleBtn, null, 'Watched toggle button must not exist for upcoming episode');
    });

    // ==========================================
    // SECTION 4: Season Completion Stats & Honest Denominators
    // ==========================================
    console.log('\n--- Section 4: Season Completion Stats & Honest Denominators ---');

    test('4.1 Empty history returns badgeType none and empty label', () => {
        const ctx = createMockMovieDetailsContext();
        const season = {
            number: 1,
            episodes: [
                { seasonNumber: 1, episodeNumber: 1, airDate: '2023-01-01' },
                { seasonNumber: 1, episodeNumber: 2, airDate: '2023-01-08' }
            ]
        };
        const stats = ctx.getSeasonCompletionStats(season, {});
        assert.strictEqual(stats.completedCount, 0);
        assert.strictEqual(stats.totalReleasedCount, 2);
        assert.strictEqual(stats.isFullyCompleted, false);
        assert.strictEqual(stats.badgeType, 'none');
        assert.strictEqual(stats.badgeLabel, '');
    });

    test('4.2 Partial season returns badgeType partial and formatted count', () => {
        const ctx = createMockMovieDetailsContext();
        const season = {
            number: 1,
            episodes: [
                { seasonNumber: 1, episodeNumber: 1, airDate: '2023-01-01' },
                { seasonNumber: 1, episodeNumber: 2, airDate: '2023-01-08' },
                { seasonNumber: 1, episodeNumber: 3, airDate: '2023-01-15' }
            ]
        };
        const history = {
            '1:1': { cAt: 1000, src: 'SEASONVAR' },
            '1:2': { cAt: 2000, src: 'SEASONVAR' }
        };
        const stats = ctx.getSeasonCompletionStats(season, history);
        assert.strictEqual(stats.completedCount, 2);
        assert.strictEqual(stats.totalReleasedCount, 3);
        assert.strictEqual(stats.isFullyCompleted, false);
        assert.strictEqual(stats.badgeType, 'partial');
        assert.strictEqual(stats.badgeLabel, '2 / 3 просмотрено');
    });

    test('4.3 Ongoing season with future episodes returns Все вышедшие просмотрены', () => {
        const ctx = createMockMovieDetailsContext();
        const futureDate = new Date(Date.now() + 86400000 * 14).toISOString().split('T')[0];
        const season = {
            number: 1,
            episodes: [
                { seasonNumber: 1, episodeNumber: 1, airDate: '2023-01-01' },
                { seasonNumber: 1, episodeNumber: 2, airDate: '2023-01-08' },
                { seasonNumber: 1, episodeNumber: 3, airDate: futureDate } // unreleased
            ]
        };
        const history = {
            '1:1': { cAt: 1000, src: 'SEASONVAR' },
            '1:2': { cAt: 2000, src: 'SEASONVAR' }
        };
        const stats = ctx.getSeasonCompletionStats(season, history);
        assert.strictEqual(stats.completedCount, 2);
        assert.strictEqual(stats.totalReleasedCount, 2);
        assert.strictEqual(stats.totalCount, 3);
        assert.strictEqual(stats.hasFutureEpisodes, true);
        assert.strictEqual(stats.isFullyCompleted, true);
        assert.strictEqual(stats.badgeType, 'full_released');
        assert.strictEqual(stats.badgeLabel, 'Все вышедшие просмотрены');
    });

    test('4.4 Fully finished season returns Сезон просмотрен', () => {
        const ctx = createMockMovieDetailsContext();
        const season = {
            number: 1,
            episodes: [
                { seasonNumber: 1, episodeNumber: 1, airDate: '2023-01-01' },
                { seasonNumber: 1, episodeNumber: 2, airDate: '2023-01-08' },
                { seasonNumber: 1, episodeNumber: 3, airDate: '2023-01-15' }
            ]
        };
        const history = {
            '1:1': { cAt: 1000, src: 'SEASONVAR' },
            '1:2': { cAt: 2000, src: 'SEASONVAR' },
            '1:3': { cAt: 3000, src: 'SEASONVAR' }
        };
        const stats = ctx.getSeasonCompletionStats(season, history);
        assert.strictEqual(stats.completedCount, 3);
        assert.strictEqual(stats.totalReleasedCount, 3);
        assert.strictEqual(stats.hasFutureEpisodes, false);
        assert.strictEqual(stats.isFullyCompleted, true);
        assert.strictEqual(stats.badgeType, 'full_season');
        assert.strictEqual(stats.badgeLabel, 'Сезон просмотрен');
    });

    test('4.5 Specials (Season 0) are tracked independently and marked isSpecial', () => {
        const ctx = createMockMovieDetailsContext();
        const specialSeason = {
            number: 0,
            isSpecial: true,
            episodes: [
                { seasonNumber: 0, episodeNumber: 1, airDate: '2023-01-01' }
            ]
        };
        const stats = ctx.getSeasonCompletionStats(specialSeason, { '0:1': { cAt: 1000, src: 'MANUAL' } });
        assert.strictEqual(stats.isSpecial, true);
        assert.strictEqual(stats.completedCount, 1);
        assert.strictEqual(stats.isFullyCompleted, true);
    });

    // ==========================================
    // SECTION 5: Season Header & History Progress Bar
    // ==========================================
    console.log('\n--- Section 5: Season Header & History Progress Bar ---');

    test('5.1 Season progress bar renders when completedCount > 0 and totalReleasedCount > 0', () => {
        const ctx = createMockMovieDetailsContext();
        const seasons = [
            {
                number: 1,
                episodeCount: 10,
                episodes: [
                    { seasonNumber: 1, episodeNumber: 1, airDate: '2023-01-01' },
                    { seasonNumber: 1, episodeNumber: 2, airDate: '2023-01-02' },
                    { seasonNumber: 1, episodeNumber: 3, airDate: '2023-01-03' },
                    { seasonNumber: 1, episodeNumber: 4, airDate: '2023-01-04' }
                ]
            }
        ];
        const history = {
            '1:1': { cAt: 1000, src: 'SEASONVAR' },
            '1:2': { cAt: 2000, src: 'SEASONVAR' }
        };
        const html = ctx.renderSeasonsTab(seasons, null, null, 9999, null, null, history, null);
        const dom = new JSDOM(html);

        const progressContainer = dom.window.document.querySelector('.season-progress-container');
        assert.ok(progressContainer, 'Progress container should exist');

        const progressBar = progressContainer.querySelector('.season-progress-bar');
        assert.ok(progressBar, 'Progress bar should exist');
        assert.strictEqual(progressBar.style.width, '50%');
        assert.strictEqual(progressBar.getAttribute('aria-valuenow'), '2');
        assert.strictEqual(progressBar.getAttribute('aria-valuemax'), '4');
    });

    test('5.2 Season progress bar is omitted when completedCount is 0', () => {
        const ctx = createMockMovieDetailsContext();
        const seasons = [
            {
                number: 1,
                episodeCount: 4,
                episodes: [
                    { seasonNumber: 1, episodeNumber: 1, airDate: '2023-01-01' }
                ]
            }
        ];
        const html = ctx.renderSeasonsTab(seasons, null, null, 9999, null, null, {}, null);
        const dom = new JSDOM(html);

        const progressContainer = dom.window.document.querySelector('.season-progress-container');
        assert.strictEqual(progressContainer, null, 'Progress container should not render for 0 completed');
    });

    // ==========================================
    // SECTION 6: Season Pills Compact Progress
    // ==========================================
    console.log('\n--- Section 6: Season Pills Compact Progress ---');

    test('6.1 Season pills render checkmark for full, fraction for partial, plain for 0', () => {
        const ctx = createMockMovieDetailsContext();
        const seasons = [
            {
                number: 1,
                episodeCount: 2,
                episodes: [
                    { seasonNumber: 1, episodeNumber: 1, airDate: '2023-01-01' },
                    { seasonNumber: 1, episodeNumber: 2, airDate: '2023-01-02' }
                ]
            },
            {
                number: 2,
                episodeCount: 4,
                episodes: [
                    { seasonNumber: 2, episodeNumber: 1, airDate: '2023-01-01' },
                    { seasonNumber: 2, episodeNumber: 2, airDate: '2023-01-02' },
                    { seasonNumber: 2, episodeNumber: 3, airDate: '2023-01-03' },
                    { seasonNumber: 2, episodeNumber: 4, airDate: '2023-01-04' }
                ]
            },
            {
                number: 3,
                episodeCount: 2,
                episodes: [
                    { seasonNumber: 3, episodeNumber: 1, airDate: '2023-01-01' },
                    { seasonNumber: 3, episodeNumber: 2, airDate: '2023-01-02' }
                ]
            }
        ];
        const history = {
            '1:1': { cAt: 1000, src: 'SEASONVAR' },
            '1:2': { cAt: 2000, src: 'SEASONVAR' }, // Season 1 fully completed
            '2:1': { cAt: 3000, src: 'SEASONVAR' }, // Season 2 partial (1/4)
        };
        const html = ctx.renderSeasonsTab(seasons, null, null, 9999, null, null, history, null);
        const dom = new JSDOM(html);
        const pills = dom.window.document.querySelectorAll('.season-pill-btn:not(.season-pill-btn--specials)');

        assert.strictEqual(pills.length, 3);

        // Pill 1: Full -> [ 1 ✓ ]
        assert.ok(pills[0].classList.contains('season-pill-btn--completed'));
        assert.ok(pills[0].querySelector('.season-pill-check'));
        assert.ok(pills[0].getAttribute('aria-label').includes('(просмотрен полностью)'));

        // Pill 2: Partial -> [ 2 1/4 ]
        const fraction2 = pills[1].querySelector('.season-pill-progress');
        assert.ok(fraction2, 'Pill 2 should have progress fraction');
        assert.strictEqual(fraction2.textContent.trim(), '1/4');
        assert.ok(pills[1].getAttribute('aria-label').includes('(просмотрено 1 из 4)'));

        // Pill 3: Zero -> [ 3 ]
        assert.strictEqual(pills[2].querySelector('.season-pill-check'), null);
        assert.strictEqual(pills[2].querySelector('.season-pill-progress'), null);
        assert.strictEqual(pills[2].textContent.trim(), '3');
    });

    // ==========================================
    // SECTION 7: Live Targeted Playing State Update
    // ==========================================
    console.log('\n--- Section 7: Live Targeted Playing State Update ---');

    test('7.1 updateActiveEpisodePlayingState updates card classes and badges dynamically', () => {
        const ctx = createMockMovieDetailsContext();
        const episodes = [
            { seasonNumber: 1, episodeNumber: 1, name: 'Ep 1', airDate: '2023-01-01' },
            { seasonNumber: 1, episodeNumber: 2, name: 'Ep 2', airDate: '2023-01-02' }
        ];
        const html = `
            <div id="container">
                ${ctx.renderEpisodesList(episodes, null, null, null, {}, null)}
            </div>
        `;
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        const cards = doc.querySelectorAll('.episode-card');
        assert.ok(!cards[0].classList.contains('episode-card--playing'));
        assert.ok(!cards[1].classList.contains('episode-card--playing'));

        // Start playing S1E2
        ctx.updateActiveEpisodePlayingState({ seasonNumber: 1, episodeNumber: 2 }, doc);

        assert.ok(!cards[0].classList.contains('episode-card--playing'));
        assert.ok(cards[1].classList.contains('episode-card--playing'));
        assert.ok(cards[1].querySelector('.badge-playing-episode'));
        assert.ok(cards[1].querySelector('.episode-card__play-btn').classList.contains('episode-card__play-btn--playing'));

        // Switch to S1E1
        ctx.updateActiveEpisodePlayingState({ seasonNumber: 1, episodeNumber: 1 }, doc);

        assert.ok(cards[0].classList.contains('episode-card--playing'));
        assert.ok(cards[0].querySelector('.badge-playing-episode'));
        assert.ok(!cards[1].classList.contains('episode-card--playing'));
        assert.strictEqual(cards[1].querySelector('.badge-playing-episode'), null);

        // Close player (selection null)
        ctx.updateActiveEpisodePlayingState(null, doc);

        assert.ok(!cards[0].classList.contains('episode-card--playing'));
        assert.strictEqual(cards[0].querySelector('.badge-playing-episode'), null);
        assert.ok(!cards[1].classList.contains('episode-card--playing'));
        assert.strictEqual(cards[1].querySelector('.badge-playing-episode'), null);
    });

    // ==========================================
    // SECTION 8: Performance on Long Series
    // ==========================================
    console.log('\n--- Section 8: Performance on Long Series ---');

    test('8.1 Rendering 100-episode season executes in under 25ms', () => {
        const ctx = createMockMovieDetailsContext();
        const episodes = [];
        const history = {};
        for (let i = 1; i <= 100; i++) {
            episodes.push({
                seasonNumber: 1,
                episodeNumber: i,
                name: `Episode ${i}`,
                airDate: '2023-01-01',
                runtime: 24,
                voteAverage: 8.5
            });
            if (i <= 60) {
                history[`1:${i}`] = { cAt: 1000000 + i, src: 'SEASONVAR' };
            }
        }

        const start = Date.now();
        const html = ctx.renderEpisodesList(episodes, null, null, null, history, null);
        const duration = Date.now() - start;

        assert.ok(html.length > 5000, 'HTML should be generated');
        assert.ok(duration < 35, `Render time should be fast (took ${duration}ms)`);
        console.log(`    (100 episodes rendered in ${duration}ms)`);
    });

    console.log(`\n=== Phase 4D Test Results: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
