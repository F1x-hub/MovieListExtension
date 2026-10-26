/**
 * Admin «Эфир» editor: publishes what the shared live page shows.
 * Writes are rejected by Firestore rules for anyone who is not an admin.
 */
(function () {
    'use strict';

    const $ = id => document.getElementById(id);

    function waitForFirebase(timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const check = () => {
                if (window.firebaseManager?.db) return resolve(window.firebaseManager);
                if (Date.now() - started > timeoutMs) return reject(new Error('FIREBASE_UNAVAILABLE'));
                setTimeout(check, 150);
            };
            check();
        });
    }

    function debounce(fn, ms) {
        let timer = null;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    }

    async function init() {
        const form = $('liveChannelForm');
        if (!form || !window.CinemaChannelService) return;
        let DatePicker;
        try { DatePicker = window.CustomDatePicker || (await import('../../shared/components/CustomDateTimePicker.js')).CustomDatePicker; }
        catch (error) {
            console.warn('[AdminLive] Calendar unavailable:', error);
            $('liveChannelStatus').textContent = 'Не удалось загрузить календарь. Обновите страницу.';
            return;
        }
        const { computePosition, formatClock, coverUrl, resolveChannel } = window.CinemaChannel;

        const ui = {
            nowCard: $('liveNowCard'), nowMedia: $('liveNowMedia'), nowState: $('liveNowState'),
            nowTitle: $('liveNowTitle'), nowMeta: $('liveNowMeta'), stop: $('liveStopBtn'),
            start: $('liveStartBtn'), status: $('liveChannelStatus'), title: $('liveTitleInput'),
            ytInput: $('liveYoutubeInput'), ytPreview: $('liveYoutubePreview'), ytThumb: $('liveYoutubeThumb'),
            ytName: $('liveYoutubeName'), ytLive: $('liveYoutubeLive'),
            movieSearch: $('liveMovieSearch'), movieResults: $('liveMovieResults'), moviePreview: $('liveMoviePreview'),
            moviePoster: $('liveMoviePoster'), movieName: $('liveMovieName'), movieMeta: $('liveMovieMeta'),
            duration: $('liveMovieDurationInput'),
            ytDuration: $('liveYoutubeDurationInput'), durationLabel: $('liveMovieDurationLabel'),
            seriesTiming: $('liveSeriesTiming'), findFree: $('liveFindFreeSlotBtn')
        };
        const groups = form.querySelectorAll('[data-live-mode]');
        const draft = { youtube: null, movie: null };
        let titleTouched = false;
        let service = null;
        let current = null;
        let busy = false;
        let searchSeq = 0;
        let planner = null;
        let series = null;
        let continuationStartMs = null;
        const isSeries = movie => movie?.isSeries === true || movie?.mediaType === 'tv-series'
            || ['tv-series', 'mini-series', 'animated-series', 'tv', 'series'].includes(String(movie?.type || '').toLowerCase().replace(/_/g, '-'));
        const episodeCode = episode => `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;
        const seriesActive = () => mode() === 'movie' && isSeries(draft.movie);

        const mode = () => form.querySelector('input[name="liveMode"]:checked')?.value || 'movie';
        let manual = null;
        let scheduleItems = [];
        let scheduleReady = false;
        let sweptOnce = false;
        const setStatus = (text, tone = '') => { ui.status.textContent = text; ui.status.dataset.tone = tone; };
        const ready = () => {
            if (!planner || (!planner.selected && !(mode() === 'youtube' ? draft.youtube : draft.movie))) return false;
            if (!planner.selected && seriesActive() && (!series?.ready || series.existing)) return false;
            if (!planner.selected && !(planner.source?.durationSec > 0)) return false;
            try {
                const range = planner.range;
                return range.end > range.start && (!seriesActive() || planner.selected || !slotConflict(range));
            } catch { return false; }
        };
        function slotConflict(range) {
            return planner.items.find(item => {
                const bounds = window.CinemaChannel.getScheduleBounds(item);
                return range.start.getTime() < bounds.endMs && range.end.getTime() > bounds.startMs;
            });
        }
        function refreshSeriesTiming(saving) {
            if (!ui.seriesTiming || !ui.findFree) return;
            ui.seriesTiming.hidden = true; ui.findFree.hidden = true;
            if (!seriesActive() || planner?.selected || !series?.ready) return;
            if (series.existing) {
                ui.seriesTiming.hidden = false;
                ui.seriesTiming.textContent = `${episodeCode(series.selection)} уже в программе на этот день. Выберите существующий показ ниже.`;
                return;
            }
            if (!(planner.source?.durationSec > 0)) return;
            try {
                const range = planner.range;
                const conflict = slotConflict(range);
                if (!conflict) return;
                ui.seriesTiming.hidden = false;
                ui.seriesTiming.textContent = `Место занято: «${conflict.title}». Выберите другое начало или свободное время; другие показы не переместятся.`;
                const next = planner.nearestFreeStart(range.start.getTime(), planner.source.durationSec);
                if (!Number.isFinite(next)) return;
                const date = new Date(next);
                ui.findFree.hidden = false; ui.findFree.disabled = Boolean(saving);
                ui.findFree.textContent = `Свободное время: ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
            } catch { /* The standard timing note already describes invalid input. */ }
        }
        const refreshStart = () => {
            const saving = busy || planner?.busy;
            for (const input of form.querySelectorAll('input, button')) input.disabled = Boolean(saving);
            ui.duration.readOnly = Boolean(planner?.selected || (seriesActive() ? series?.selection?.durationSec > 0 : draft.movie?.duration > 0));
            ui.ytDuration.readOnly = Boolean(planner?.selected || draft.youtube?.durationSec > 0 && !ui.ytLive.checked);
            ui.stop.disabled = Boolean(saving);
            ui.start.disabled = saving || !service || !ready();
            ui.start.textContent = planner?.selected ? 'Применить время'
                : seriesActive() ? series?.continuation && series.selection
                    ? `Добавить следующую · ${episodeCode(series.selection)}` : 'Добавить серию в эфир'
                    : 'Добавить на дорожку';
            ui.title.readOnly = Boolean(planner?.selected);
            if (ui.durationLabel) ui.durationLabel.textContent = seriesActive() ? 'Длительность этой серии, мин' : 'Длительность фильма, мин';
            // The generic form loop must not enable unreleased episodes or loading controls.
            series?.setBusy(saving);
            refreshSeriesTiming(saving);
        };
        const suggestTitle = value => { if (!titleTouched && value) ui.title.value = value; };

        // ---- «Сейчас в эфире» card -------------------------------------------------
        function renderNow() {
            const channel = current;
            const position = computePosition(channel);
            const on = channel && ['live', 'paused'].includes(position.state);
            ui.nowCard.dataset.state = !channel || channel.mode === 'off' ? 'off' : position.state;
            // A finished show has nothing left to stop.
            ui.stop.hidden = !on;

            const cover = channel?.mode !== 'off' ? coverUrl(channel) : '';
            if (ui.nowMedia.dataset.src !== cover) {
                ui.nowMedia.dataset.src = cover;
                ui.nowMedia.style.backgroundImage = cover ? `url("${cover.replace(/"/g, '%22')}")` : '';
                ui.nowMedia.classList.toggle('is-poster', channel?.mode === 'movie');
            }

            if (!channel || channel.mode === 'off') {
                ui.nowState.textContent = 'Эфир выключен';
                ui.nowTitle.textContent = 'Сейчас ничего не идёт';
                ui.nowMeta.textContent = 'Добавьте передачу в программу ниже.';
                return;
            }
            const live = channel.mode === 'youtube' && channel.youtube.live;
            ui.nowTitle.textContent = channel.title || (channel.mode === 'youtube' ? 'Видео YouTube' : `Фильм #${channel.movie.kinopoiskId}`);
            ui.nowState.textContent = position.state === 'upcoming' ? 'Следующий показ' : position.state === 'ended' ? 'Показ завершён' : position.state === 'paused' ? 'Пауза' : 'В эфире';
            const source = channel.mode === 'youtube' ? (live ? 'YouTube · прямая трансляция' : 'YouTube')
                : channel.movie.mediaType === 'tv-series' ? `Сериал · ${episodeCode(channel.movie)}` : 'Фильм';
            const total = channel[channel.mode]?.durationSec;
            const clock = live || position.state === 'ended' ? ''
                : position.state === 'upcoming' ? ` · начало через ${formatClock(position.offsetSec)}`
                : position.state === 'paused'
                    ? ` · пауза на ${formatClock(position.offsetSec)}`
                    : ` · идёт ${formatClock(position.offsetSec)}${total ? ` из ${formatClock(total)}` : ''}`;
            ui.nowMeta.textContent = source + clock;
        }

        // ---- Source picker ---------------------------------------------------------
        const syncGroups = () => {
            groups.forEach(group => { group.hidden = group.dataset.liveMode !== mode(); });
            refreshStart();
        };
        form.addEventListener('change', event => {
            if (event.target.name === 'liveMode') {
                searchSeq++; continuationStartMs = null;
                if (mode() !== 'movie') series?.hide();
                else if (isSeries(draft.movie)) series?.open(draft.movie);
                syncGroups(); syncPlannerSource();
            }
        });

        function renderSchedule() {
            planner?.setItems(scheduleItems, current);
            series?.render(); refreshStart();
        }

        function resolveCurrent() {
            if (!manual) return;
            if (scheduleReady && !sweptOnce) {
                sweptOnce = true;
                service.sweepFinished(scheduleItems, window.CinemaChannel.now(), manual).catch(() => {});
            }
            current = resolveChannel(manual, scheduleItems);
            renderNow();
            renderSchedule();
            fillMissingLengths();
        }
        ui.title.addEventListener('input', () => { titleTouched = ui.title.value.trim().length > 0; });

        // ---- YouTube: length / live / availability from a hidden player --------------
        // The wrapper loads the video cued and muted and reports getDuration() and
        // whether it is a live stream; the length fills the field so the broadcast
        // ends by itself, like a movie. The live page still learns it as a fallback.
        let autoDuration = '';
        let probeSeq = 0;

        /** Loads the video in a hidden wrapper; resolves { duration, isLive } or { error }. */
        function probeLength(videoId) {
            const wrapper = window.PlayerConfig?.YOUTUBE_WRAPPER_URL;
            if (!wrapper) return Promise.resolve({});
            const origin = new URL(wrapper).origin;
            return new Promise(resolve => {
                const frame = document.createElement('iframe');
                frame.hidden = true;
                frame.setAttribute('aria-hidden', 'true');
                frame.tabIndex = -1;
                frame.allow = 'autoplay; encrypted-media';
                frame.src = `${wrapper}?v=${encodeURIComponent(videoId)}&autoplay=0&mute=1&controls=0&probe=1`;
                let timer = null;
                const finish = result => {
                    window.removeEventListener('message', onMessage);
                    clearTimeout(timer);
                    frame.remove();
                    resolve(result);
                };
                const onMessage = event => {
                    if (event.origin !== origin || event.source !== frame.contentWindow) return;
                    const data = event.data;
                    if (!data || data.source !== 'STARTTAB_PLAYER_WRAPPER') return;
                    const payload = data.payload || {};
                    if (data.event === 'PROBE') finish({ duration: Number(payload.duration) || 0, isLive: payload.isLive === true });
                    else if (data.event === 'ERROR') finish({ error: payload.errorCode || 5 });
                };
                timer = setTimeout(() => finish({}), 15000);
                window.addEventListener('message', onMessage);
                document.body.append(frame);
            });
        }

        function stopProbe() {
            probeSeq += 1;
        }

        async function probeYoutube(videoId) {
            const seq = ++probeSeq;
            const result = await probeLength(videoId);
            if (seq !== probeSeq || draft.youtube?.id !== videoId) return;
            if (result.error) {
                const code = Number(result.error);
                setStatus(code === 101 || code === 150
                    ? 'YouTube не показывает это видео на сторонних сайтах: ограничение по возрасту, региону или от автора, либо видео недоступно. Зрители увидят ссылку на YouTube.'
                    : code === 100 || code === 2
                        ? 'Видео не найдено: оно удалено, скрыто или ссылка неверна.'
                        : 'Не удалось проверить видео. Укажите длительность перед добавлением.', 'error');
                return;
            }
            if (result.isLive) {
                ui.ytLive.checked = true;
                if (ui.ytDuration.value === autoDuration) ui.ytDuration.value = autoDuration = '';
                draft.youtube.durationSec = 0;
                setStatus('Прямая трансляция. Укажите длительность показа перед добавлением.');
                syncPlannerSource();
                return;
            }
            if (result.duration > 0) {
                ui.ytLive.checked = false;
                draft.youtube.durationSec = Math.round(result.duration);
                ui.ytDuration.value = autoDuration = String(draft.youtube.durationSec / 60);
                setStatus(`Длительность видео: ${formatClock(result.duration)}. Блок можно только перемещать.`, 'success');
                syncPlannerSource();
                return;
            }
            setStatus('Длительность не определилась. Укажите её перед добавлением показа.');
        }

        // A YouTube show published without a length (older shows, a failed probe)
        // would stay «В эфире» here after the video ended: learn and store it.
        const lengthChecked = new Set();
        function fillMissingLengths() {
            if (!service) return;
            [manual, ...scheduleItems].forEach(item => {
                if (item?.mode !== 'youtube' || item.youtube.live || item.youtube.durationSec) return;
                const key = `${item.docPath}:${item.youtube.videoId}`;
                if (lengthChecked.has(key)) return;
                lengthChecked.add(key);
                probeLength(item.youtube.videoId).then(result => {
                    if (result.isLive || !(result.duration > 0) || result.duration > 12 * 3600) return;
                    return service.setYoutubeDuration(item, Math.ceil(result.duration));
                }).catch(error => console.warn('[AdminLive] Could not store the video length:', error));
            });
        }

        // ---- YouTube: instant preview + title from oEmbed --------------------------
        let lastYoutubeId = '';
        const updateYoutube = debounce(async () => {
            const raw = ui.ytInput.value.trim();
            const info = raw && typeof Utils !== 'undefined' ? Utils.extractYouTubeVideoInfo(raw) : null;
            draft.youtube = info ? { id: info.id, durationSec: draft.youtube?.id === info.id ? draft.youtube.durationSec : 0 } : null;
            syncPlannerSource();
            ui.ytPreview.hidden = !info;
            ui.ytInput.setAttribute('aria-invalid', String(Boolean(raw) && !info));
            refreshStart();
            if (!info) {
                lastYoutubeId = '';
                stopProbe();
                if (raw) setStatus('Это не похоже на ссылку YouTube.', 'error');
                return;
            }
            setStatus('');
            ui.ytThumb.src = `https://i.ytimg.com/vi/${encodeURIComponent(info.id)}/hqdefault.jpg`;
            if (info.id !== lastYoutubeId) {
                lastYoutubeId = info.id;
                if (ui.ytDuration.value === autoDuration) ui.ytDuration.value = autoDuration = '';
                setStatus('Определяем длительность видео…');
                probeYoutube(info.id);
                ui.ytLive.checked = /youtube\.com\/live\//i.test(raw);
            } else if (/youtube\.com\/live\//i.test(raw)) {
                ui.ytLive.checked = true;
            }
            ui.ytName.textContent = 'Видео YouTube';
            syncPlannerSource();
            try {
                const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${info.id}`)}`);
                if (!response.ok || draft.youtube?.id !== info.id) return;
                const meta = await response.json();
                if (meta?.title) {
                    ui.ytName.textContent = meta.title;
                    suggestTitle(meta.title);
                    syncPlannerSource();
                }
            } catch { /* oEmbed is a nicety; the id alone is enough to broadcast */ }
        }, 250);
        ui.ytInput.addEventListener('input', updateYoutube);

        // ---- Movie: search by title or id ------------------------------------------
        function selectMovie(movie) {
            searchSeq++; continuationStartMs = null;
            draft.movie = movie;
            ui.movieResults.replaceChildren();
            ui.moviePreview.hidden = false;
            ui.moviePoster.src = movie.posterUrl || '';
            ui.moviePoster.hidden = !movie.posterUrl;
            ui.movieName.textContent = movie.name;
            ui.movieMeta.textContent = [movie.year || '', `KP ${movie.kinopoiskId}`].filter(Boolean).join(' · ');
            ui.duration.value = !isSeries(movie) && movie.duration > 0 ? String(movie.duration) : '';
            suggestTitle(movie.name);
            if (isSeries(movie)) {
                if (series) series.open(movie);
                else setStatus('Редактор серий недоступен. Обновите страницу.', 'error');
            } else series?.hide();
            syncPlannerSource();
            refreshStart();
        }

        function renderResults(movies) {
            ui.movieResults.replaceChildren(...movies.slice(0, 6).map(movie => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'live-result';
                item.setAttribute('role', 'option');
                const img = document.createElement('img');
                img.alt = '';
                img.loading = 'lazy';
                if (movie.posterUrl) img.src = movie.posterUrl;
                const text = document.createElement('span');
                const name = document.createElement('strong');
                name.textContent = movie.name;
                const meta = document.createElement('small');
                meta.textContent = [movie.year || '', isSeries(movie) ? 'Сериал · выбор серии' : movie.duration ? `${movie.duration} мин` : ''].filter(Boolean).join(' · ');
                text.append(name, meta);
                item.append(img, text);
                item.addEventListener('click', () => selectMovie(movie));
                return item;
            }));
        }

        const searchMovies = debounce(async () => {
            const query = ui.movieSearch.value.trim();
            const seq = searchSeq;
            if (mode() !== 'movie') return;
            draft.movie = null;
            ui.moviePreview.hidden = true;
            syncPlannerSource();
            refreshStart();
            if (query.length < 2) { ui.movieResults.replaceChildren(); return; }
            const kp = typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null;
            if (!kp) { setStatus('Поиск недоступен на этой странице.', 'error'); return; }
            setStatus('Ищем…');
            try {
                const asId = /^\d{1,9}$/.test(query) ? await kp.getMovieById(Number(query)) : null;
                const found = asId ? [asId] : (await kp.searchMovies(query, 1, 8))?.docs || [];
                if (seq !== searchSeq || mode() !== 'movie' || query !== ui.movieSearch.value.trim()) return;
                const movies = found
                    .map(m => ({
                        ...m,
                        kinopoiskId: Number(m.kinopoiskId || m.id),
                        name: m.name || m.title || m.nameRu || 'Без названия',
                        year: m.year || '',
                        posterUrl: m.posterUrl || m.poster?.previewUrl || m.poster?.url || '',
                        duration: Number(m.duration || m.movieLength || 0)
                    }))
                    .filter(m => Number.isSafeInteger(m.kinopoiskId) && m.kinopoiskId > 0);
                setStatus(movies.length ? '' : 'Ничего не нашлось.');
                renderResults(movies);
            } catch (error) {
                console.warn('[AdminLive] Movie search failed:', error);
                if (seq !== searchSeq || mode() !== 'movie' || query !== ui.movieSearch.value.trim()) return;
                if (/^\d{1,9}$/.test(query)) {
                    // Lookup is only a convenience: a bare Kinopoisk ID is enough to broadcast.
                    selectMovie({ kinopoiskId: Number(query), name: `Фильм #${query}`, year: '', posterUrl: '', duration: 0 });
                    setStatus('Описание не загрузилось, но фильм выбран по ID.');
                } else {
                    setStatus('Поиск не удался. Попробуйте ещё раз или введите Kinopoisk ID.', 'error');
                }
            }
        }, 350);
        ui.movieSearch.addEventListener('input', () => {
            searchSeq++; continuationStartMs = null; draft.movie = null; series?.hide();
            ui.moviePreview.hidden = true; ui.movieResults.replaceChildren();
            syncPlannerSource(); refreshStart(); searchMovies();
        });

        // ---- Publish -------------------------------------------------------------
        function syncPlannerSource() {
            if (!planner || busy || planner.busy) return;
            const youtube = mode() === 'youtube';
            const item = youtube ? draft.youtube : draft.movie;
            const episode = !youtube && isSeries(item) ? series?.selection : null;
            const selectable = item && (!isSeries(item) || youtube || series?.ready);
            const rawLength = Number(String(youtube ? ui.ytDuration.value : ui.duration.value).replace(',', '.'));
            const options = {};
            if (!youtube && isSeries(item)) {
                options.preserveStart = true;
                if (episode && Number.isFinite(continuationStartMs)) options.startMs = continuationStartMs;
            }
            planner.setDraft(selectable ? {
                key: `${mode()}:${youtube ? item.id : item.kinopoiskId}${episode ? `:${episodeCode(episode)}` : ''}`,
                mode: mode(), title: youtube ? ui.ytName.textContent : item.name,
                ...(episode || {}),
                cover: youtube ? ui.ytThumb.src : item.posterUrl,
                durationSec: youtube && item.durationSec > 0 && !ui.ytLive.checked ? item.durationSec
                    : episode?.durationSec > 0 ? episode.durationSec
                    : !youtube && !isSeries(item) && item.duration > 0 ? Math.round(item.duration * 60)
                    : Number.isFinite(rawLength) && rawLength > 0 ? Math.round(rawLength * 60) : 0
            } : null, options);
            if (episode) continuationStartMs = null;
        }
        async function confirmTiming(item, start, end) {
            const nowMs = window.CinemaChannel.now();
            const running = item.docPath === current?.docPath && ['live', 'paused'].includes(computePosition(current).state);
            if (!running && !(start.getTime() <= nowMs && end.getTime() > nowMs)) return true;
            return window.ConfirmDialog ? window.ConfirmDialog.confirm({
                title: 'Изменить текущую программу?',
                message: 'Изменение времени может переключить показ у всех зрителей.',
                confirmLabel: 'Изменить'
            }) : true;
        }
        planner = new window.LiveSchedulePlanner({
            DatePicker,
            onStatus: setStatus,
            onRange: () => {
                if (series?.recorded && planner?.selected?.movie?.mediaType === 'tv-series' && series.recorded !== planner.selected) {
                    series.setRecorded(draft.movie, planner.selected);
                } else series?.render();
                refreshStart();
            },
            onAdd: () => {
                ui.movieSearch.scrollIntoView({ block: 'nearest', behavior: 'auto' });
                (mode() === 'movie' ? ui.movieSearch : ui.ytInput).focus({ preventScroll: true });
            },
            onSelect: item => {
                titleTouched = false;
                if (!item) {
                    if (series?.recorded) { series.recorded = null; series.render(); }
                    ui.title.readOnly = false;
                    ui.title.value = mode() === 'youtube' ? (draft.youtube ? ui.ytName.textContent : '') : (draft.movie?.name || '');
                    refreshStart(); return;
                }
                form.querySelector(`input[name="liveMode"][value="${item.mode}"]`).checked = true;
                ui.title.value = item.title || ''; ui.title.readOnly = true;
                if (item.mode === 'youtube') {
                    series?.hide();
                    draft.youtube = { id: item.youtube.videoId, durationSec: item.youtube.live ? 0 : item.youtube.durationSec };
                    ui.ytInput.value = `https://www.youtube.com/watch?v=${item.youtube.videoId}`;
                    ui.ytName.textContent = item.title || 'Видео YouTube';
                    ui.ytThumb.src = coverUrl(item); ui.ytPreview.hidden = false;
                    ui.ytDuration.value = item.youtube.durationSec ? String(item.youtube.durationSec / 60) : '';
                    ui.ytLive.checked = item.youtube.live;
                } else {
                    const prior = draft.movie?.kinopoiskId === item.movie.kinopoiskId ? draft.movie : {};
                    draft.movie = { ...prior, kinopoiskId: item.movie.kinopoiskId, name: item.title, posterUrl: item.movie.posterUrl,
                        duration: item.movie.durationSec / 60, isSeries: item.movie.mediaType === 'tv-series', type: item.movie.mediaType || 'movie' };
                    ui.movieName.textContent = item.title; ui.moviePoster.src = item.movie.posterUrl || '';
                    ui.moviePoster.hidden = !item.movie.posterUrl; ui.moviePreview.hidden = false;
                    ui.movieMeta.textContent = `KP ${item.movie.kinopoiskId}`;
                    ui.duration.value = item.movie.durationSec ? String(item.movie.durationSec / 60) : '';
                    if (isSeries(draft.movie)) series?.setRecorded(draft.movie, item);
                    else series?.hide();
                }
                syncGroups();
            },
            onChange: async (item, start, end) => {
                if (!service) throw new Error('Firebase недоступен — время нельзя сохранить.');
                if (!await confirmTiming(item, start, end)) return null;
                const saved = await service.updateSchedule(item, start, end);
                setStatus('Время показа сохранено.', 'success'); return saved;
            },
            onRemove: async item => {
                if (!service) throw new Error('Firebase недоступен — показ нельзя удалить.');
                const confirmed = window.ConfirmDialog ? await window.ConfirmDialog.confirm({
                    title: 'Убрать показ из программы?', message: item.docPath === current?.docPath && ['live', 'paused'].includes(computePosition(current).state) ? 'Текущий показ у зрителей завершится.' : `«${item.title}» будет убран из программы.`,
                    confirmLabel: 'Убрать', danger: true
                }) : true;
                if (!confirmed) return false;
                await service.unschedule(item.id); setStatus('Показ убран из программы.', 'success'); return true;
            }
        });
        async function prepareNext(item) {
            if (!series || busy || planner.busy) return;
            continuationStartMs = window.CinemaChannel.getScheduleBounds(item).endMs;
            planner.selected = null; planner.dirty = false;
            await series.prepareNext(item);
            if (!series.selection) continuationStartMs = null;
            refreshStart();
        }
        if (window.LiveSeriesEditor && $('liveSeriesEditor')) {
            series = new window.LiveSeriesEditor({
                root: $('liveSeriesEditor'),
                loadCatalogue: async movie => {
                    const manager = window.firebaseManager;
                    const tmdb = manager?.getTMDBService?.() || (window.TMDBService ? new window.TMDBService() : null);
                    const mapping = manager?.getIdMappingService?.()
                        || (window.IdMappingService ? new window.IdMappingService(null, tmdb, manager) : null);
                    if (!tmdb || !mapping) throw new Error('Каталог серий недоступен. Обновите страницу.');
                    const identity = await mapping.resolveTmdbIdByKinopoiskId(movie.kinopoiskId, 'tv', { kinopoiskMovie: movie });
                    const tmdbId = Number(identity?.tmdbId);
                    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0 || identity.identityStatus && identity.identityStatus !== 'VERIFIED') {
                        throw new Error('Не удалось подтвердить соответствие сериала в TMDB. Выберите другой сериал или повторите позже.');
                    }
                    const details = await tmdb.getTvDetails(tmdbId);
                    if (!details) throw new Error('Не удалось получить список сезонов. Попробуйте снова.');
                    return { tmdb, tmdbId, seasons: details.seasons };
                },
                getItems: () => planner.items,
                getDay: () => planner.date,
                onChange: selection => {
                    if (!seriesActive()) return;
                    if (planner.selected) planner.setDraft(null, { startMs: planner.range.start.getTime() });
                    ui.duration.value = selection?.durationSec > 0 ? String(selection.durationSec / 60) : '';
                    syncPlannerSource(); refreshStart();
                },
                onExisting: item => planner.select(item),
                onContinue: prepareNext,
                onState: refreshStart
            });
        }
        ui.findFree?.addEventListener('click', () => {
            if (busy || planner.busy || !series?.ready || planner.selected) return;
            try {
                const startMs = planner.nearestFreeStart(planner.range.start.getTime(), planner.source?.durationSec);
                if (Number.isFinite(startMs)) planner.setDraft(planner.source, { startMs });
            } catch { /* Keep the input validation message. */ }
        });
        for (const input of [ui.duration, ui.ytDuration]) input.addEventListener('input', syncPlannerSource);
        ui.ytLive.addEventListener('change', syncPlannerSource);

        async function publish(input, doneText, startDate = null, endDate = null, { selectSaved = true } = {}) {
            if (!service || busy) return;
            busy = true; planner.setBusy(true); refreshStart(); setStatus('Сохраняем…'); let saved;
            try {
                saved = startDate ? await service.schedule(input, startDate, endDate) : await service.save(input, { restart: true });
                setStatus(doneText, 'success');
            } catch (error) {
                setStatus(error?.code === 'permission-denied' ? 'Нет прав или правила Firestore ещё не обновлены для нового расписания.' : error.message || 'Не удалось сохранить эфир.', 'error');
            } finally { busy = false; planner.setBusy(false); refreshStart(); }
            if (saved?.id) {
                scheduleItems = [...scheduleItems.filter(item => item.id !== saved.id), saved];
                planner.setItems(scheduleItems, current);
                if (selectSaved) planner.select(saved);
            }
            return saved;
        }

        form.addEventListener('submit', async event => {
            event.preventDefault(); if (!ready() || busy || planner.busy) return;
            const range = planner.range;
            if (planner.selected) { planner.saveRange(planner.selected, range.start); return; }
            const youtube = mode() === 'youtube';
            const episode = seriesActive() ? { ...series.selection } : null;
            const saved = await publish(youtube ? {
                mode: 'youtube', title: ui.title.value || ui.ytName.textContent,
                youtubeUrl: `https://www.youtube.com/watch?v=${draft.youtube.id}`,
                youtubeLive: ui.ytLive.checked, durationMin: ui.ytDuration.value
            } : {
                mode: 'movie', title: ui.title.value || draft.movie.name, kinopoiskId: draft.movie.kinopoiskId,
                ...(episode || {}), durationMin: ui.duration.value, posterUrl: draft.movie.posterUrl
            }, 'Передача добавлена в программу.', range.start, range.end, { selectSaved: !episode });
            if (saved?.id && episode) await prepareNext(saved);
        });

        ui.stop.addEventListener('click', async () => {
            const confirmed = window.ConfirmDialog
                ? await window.ConfirmDialog.confirm({ title: 'Остановить эфир?', message: 'У зрителей появится заставка. Следующий показ начнётся по программе.', confirmLabel: 'Остановить', danger: true })
                : true;
            if (confirmed) publish({ mode: 'off', title: '' }, 'Эфир остановлен.');
        });

        syncGroups();

        renderNow();

        waitForFirebase().then(manager => {
            service = new window.CinemaChannelService(manager);
            refreshStart();
            service.subscribe(channel => { manual = channel; resolveCurrent(); }, error => {
                console.warn('[AdminLive] Channel read failed:', error);
                ui.nowState.textContent = 'Статус недоступен';
            });
            service.subscribeSchedule(items => {
                scheduleItems = items;
                scheduleReady = true;
                resolveCurrent();
            }, error => { console.warn('[AdminLive] Schedule read failed:', error); setStatus('Не удалось загрузить программу эфира. Проверьте соединение.', 'error'); });
            // Update the clock without rebuilding the grid or stealing its focus.
            setInterval(() => {
                if (!manual) return;
                current = resolveChannel(manual, scheduleItems);
                renderNow();
                planner.tick();
            }, 1000);

        }).catch(() => setStatus('Firebase недоступен — эфир сейчас нельзя изменить.', 'error'));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
