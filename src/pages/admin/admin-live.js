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

    function init() {
        const form = $('liveChannelForm');
        if (!form || !window.CinemaChannelService) return;
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
            ytDuration: $('liveYoutubeDurationInput'),
            startAt: $('liveStartAtInput'),
            whenTime: form.querySelector('.live-when__time'),
            tzHint: $('liveTimezoneHint'),
            scheduleList: $('liveScheduleList'),
            scheduleEmpty: $('liveScheduleEmpty')
        };
        const groups = form.querySelectorAll('[data-live-mode]');
        const draft = { youtube: null, movie: null };
        let titleTouched = false;
        let service = null;
        let current = null;
        let busy = false;
        let searchSeq = 0;

        const mode = () => form.querySelector('input[name="liveMode"]:checked')?.value || 'youtube';
        const when = () => form.querySelector('input[name="liveWhen"]:checked')?.value || 'now';
        // datetime-local is read in the admin's own time zone.
        const plannedDate = () => (ui.startAt.value ? new Date(ui.startAt.value) : null);
        let manual = null;
        let scheduleItems = [];
        let sweptOnce = false;
        const setStatus = (text, tone = '') => { ui.status.textContent = text; ui.status.dataset.tone = tone; };
        const ready = () => (mode() === 'youtube' ? Boolean(draft.youtube) : Boolean(draft.movie))
            && (when() === 'now' || Number.isFinite(plannedDate()?.getTime()));
        const refreshStart = () => { ui.start.disabled = busy || !service || !ready(); };
        const suggestTitle = value => { if (!titleTouched && value) ui.title.value = value; };

        // ---- «Сейчас в эфире» card -------------------------------------------------
        function renderNow() {
            const channel = current;
            const position = computePosition(channel);
            const on = channel && channel.mode !== 'off' && position.state !== 'ended';
            ui.nowCard.dataset.state = !channel || channel.mode === 'off' ? 'off' : position.state;
            ui.stop.hidden = !channel || channel.mode === 'off';

            const cover = on ? coverUrl(channel) : '';
            if (ui.nowMedia.dataset.src !== cover) {
                ui.nowMedia.dataset.src = cover;
                ui.nowMedia.style.backgroundImage = cover ? `url("${cover.replace(/"/g, '%22')}")` : '';
                ui.nowMedia.classList.toggle('is-poster', channel?.mode === 'movie');
            }

            if (!channel || channel.mode === 'off') {
                ui.nowState.textContent = 'Эфир выключен';
                ui.nowTitle.textContent = 'Сейчас ничего не идёт';
                ui.nowMeta.textContent = 'Выберите источник ниже и запустите показ.';
                return;
            }
            const live = channel.mode === 'youtube' && channel.youtube.live;
            ui.nowTitle.textContent = channel.title || (channel.mode === 'youtube' ? 'Видео YouTube' : `Фильм #${channel.movie.kinopoiskId}`);
            ui.nowState.textContent = position.state === 'ended' ? 'Показ завершён' : position.state === 'paused' ? 'Пауза' : 'В эфире';
            const source = channel.mode === 'youtube' ? (live ? 'YouTube · прямая трансляция' : 'YouTube') : 'Фильм';
            const total = channel[channel.mode]?.durationSec;
            const clock = live || position.state === 'ended' ? ''
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
            if (event.target.name === 'liveMode') syncGroups();
            if (event.target.name === 'liveWhen') syncWhen();
        });

        function toLocalInputValue(date) {
            const pad = n => String(n).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
        }

        function syncWhen() {
            const later = when() === 'later';
            ui.whenTime.hidden = !later;
            ui.start.textContent = later ? 'Добавить в расписание' : 'Запустить эфир';
            if (later && !ui.startAt.value) {
                // Default: the next full hour.
                const next = new Date(Date.now() + 3600_000);
                next.setMinutes(0, 0, 0);
                ui.startAt.value = toLocalInputValue(next);
            }
            ui.startAt.min = toLocalInputValue(new Date());
            refreshStart();
        }
        ui.startAt.addEventListener('input', refreshStart);
        try {
            const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const offsetMin = -new Date().getTimezoneOffset();
            const sign = offsetMin >= 0 ? '+' : '−';
            const hours = Math.floor(Math.abs(offsetMin) / 60);
            const minutes = Math.abs(offsetMin) % 60;
            ui.tzHint.textContent = `— по вашему времени (${zone}, UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''})`;
        } catch { ui.tzHint.textContent = '— по вашему времени'; }

        // ---- Schedule list --------------------------------------------------------
        const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
        const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

        function scheduleStateText(item) {
            const position = computePosition(item);
            if (position.state === 'upcoming') {
                const minutes = Math.ceil(position.offsetSec / 60);
                return minutes < 60 ? `Через ${minutes} мин` : `Через ${Math.floor(minutes / 60)} ч ${minutes % 60 ? `${minutes % 60} мин` : ''}`.trim();
            }
            if (position.state === 'ended') return 'Завершён';
            if (current && current.docPath === item.docPath) return position.state === 'paused' ? 'На паузе' : 'В эфире';
            return 'Перекрыт более поздним показом';
        }

        function renderSchedule() {
            ui.scheduleEmpty.hidden = scheduleItems.length > 0;
            ui.scheduleList.replaceChildren(...scheduleItems.map(item => {
                const position = computePosition(item);
                const li = document.createElement('li');
                li.className = 'live-schedule__item';
                li.dataset.state = current?.docPath === item.docPath && position.state !== 'ended' ? 'live' : position.state;

                const whenEl = document.createElement('span');
                whenEl.className = 'live-schedule__when';
                const time = document.createElement('strong');
                const start = new Date(item.startedAtMs);
                time.textContent = timeFormat.format(start);
                const day = document.createElement('small');
                day.textContent = dayFormat.format(start);
                whenEl.append(time, day);

                const cover = document.createElement('span');
                cover.className = `live-schedule__cover${item.mode === 'movie' ? ' is-poster' : ''}`;
                const url = coverUrl(item);
                if (url) cover.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;

                const info = document.createElement('span');
                info.className = 'live-schedule__info';
                const name = document.createElement('strong');
                name.textContent = item.title || (item.mode === 'youtube' ? 'Видео YouTube' : `Фильм #${item.movie.kinopoiskId}`);
                const meta = document.createElement('small');
                const length = item[item.mode]?.durationSec;
                const kind = item.mode === 'youtube' ? (item.youtube.live ? 'YouTube · трансляция' : 'YouTube') : 'Фильм';
                meta.textContent = [kind, length ? formatClock(length) : '', scheduleStateText(item)].filter(Boolean).join(' · ');
                info.append(name, meta);

                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'btn btn-secondary btn-sm';
                remove.textContent = 'Удалить';
                remove.addEventListener('click', async () => {
                    const live = li.dataset.state === 'live';
                    const confirmed = window.ConfirmDialog
                        ? await window.ConfirmDialog.confirm({
                            title: 'Удалить из расписания?',
                            message: live ? 'Этот показ сейчас идёт — у зрителей он сразу прекратится.' : `«${name.textContent}» не начнётся.`,
                            confirmLabel: 'Удалить',
                            danger: true
                        })
                        : true;
                    if (!confirmed) return;
                    remove.disabled = true;
                    try { await service.unschedule(item.id); } catch (error) {
                        remove.disabled = false;
                        setStatus(error?.code === 'permission-denied' ? 'Нет прав на изменение расписания.' : 'Не удалось удалить показ.', 'error');
                    }
                });

                li.append(whenEl, cover, info, remove);
                return li;
            }));
        }

        function resolveCurrent() {
            if (!manual) return;
            current = resolveChannel(manual, scheduleItems);
            renderNow();
            renderSchedule();
        }
        ui.title.addEventListener('input', () => { titleTouched = ui.title.value.trim().length > 0; });

        // ---- YouTube: instant preview + title from oEmbed --------------------------
        let lastYoutubeId = '';
        const updateYoutube = debounce(async () => {
            const raw = ui.ytInput.value.trim();
            const info = raw && typeof Utils !== 'undefined' ? Utils.extractYouTubeVideoInfo(raw) : null;
            draft.youtube = info ? { id: info.id } : null;
            ui.ytPreview.hidden = !info;
            ui.ytInput.setAttribute('aria-invalid', String(Boolean(raw) && !info));
            refreshStart();
            if (!info) {
                lastYoutubeId = '';
                if (raw) setStatus('Это не похоже на ссылку YouTube.', 'error');
                return;
            }
            setStatus('');
            ui.ytThumb.src = `https://i.ytimg.com/vi/${encodeURIComponent(info.id)}/hqdefault.jpg`;
            if (info.id !== lastYoutubeId) {
                lastYoutubeId = info.id;
                ui.ytLive.checked = /youtube\.com\/live\//i.test(raw);
            } else if (/youtube\.com\/live\//i.test(raw)) {
                ui.ytLive.checked = true;
            }
            ui.ytName.textContent = 'Видео YouTube';
            try {
                const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${info.id}`)}`);
                if (!response.ok || draft.youtube?.id !== info.id) return;
                const meta = await response.json();
                if (meta?.title) {
                    ui.ytName.textContent = meta.title;
                    suggestTitle(meta.title);
                }
            } catch { /* oEmbed is a nicety; the id alone is enough to broadcast */ }
        }, 250);
        ui.ytInput.addEventListener('input', updateYoutube);

        // ---- Movie: search by title or id ------------------------------------------
        function selectMovie(movie) {
            draft.movie = movie;
            ui.movieResults.replaceChildren();
            ui.moviePreview.hidden = false;
            ui.moviePoster.src = movie.posterUrl || '';
            ui.moviePoster.hidden = !movie.posterUrl;
            ui.movieName.textContent = movie.name;
            ui.movieMeta.textContent = [movie.year || '', `KP ${movie.kinopoiskId}`].filter(Boolean).join(' · ');
            if (movie.duration > 0 && !ui.duration.value) ui.duration.value = String(movie.duration);
            suggestTitle(movie.name);
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
                meta.textContent = [movie.year || '', movie.duration ? `${movie.duration} мин` : ''].filter(Boolean).join(' · ');
                text.append(name, meta);
                item.append(img, text);
                item.addEventListener('click', () => selectMovie(movie));
                return item;
            }));
        }

        const searchMovies = debounce(async () => {
            const query = ui.movieSearch.value.trim();
            const seq = ++searchSeq;
            draft.movie = null;
            ui.moviePreview.hidden = true;
            refreshStart();
            if (query.length < 2) { ui.movieResults.replaceChildren(); return; }
            const kp = typeof KinopoiskService !== 'undefined' ? new KinopoiskService() : null;
            if (!kp) { setStatus('Поиск недоступен на этой странице.', 'error'); return; }
            setStatus('Ищем…');
            try {
                const asId = /^\d{1,9}$/.test(query) ? await kp.getMovieById(Number(query)) : null;
                const found = asId ? [asId] : (await kp.searchMovies(query, 1, 8))?.docs || [];
                if (seq !== searchSeq) return;
                const movies = found
                    .map(m => ({
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
                if (seq !== searchSeq) return;
                if (/^\d{1,9}$/.test(query)) {
                    // Lookup is only a convenience: a bare Kinopoisk ID is enough to broadcast.
                    selectMovie({ kinopoiskId: Number(query), name: `Фильм #${query}`, year: '', posterUrl: '', duration: 0 });
                    setStatus('Описание не загрузилось, но фильм выбран по ID.');
                } else {
                    setStatus('Поиск не удался. Попробуйте ещё раз или введите Kinopoisk ID.', 'error');
                }
            }
        }, 350);
        ui.movieSearch.addEventListener('input', searchMovies);

        // ---- Publish -------------------------------------------------------------
        async function publish(input, doneText, startDate = null) {
            if (!service) return;
            busy = true;
            refreshStart();
            ui.stop.disabled = true;
            setStatus('Сохраняем…');
            try {
                if (startDate) await service.schedule(input, startDate);
                else await service.save(input, { restart: true });
                setStatus(doneText, 'success');
            } catch (error) {
                setStatus(error?.code === 'permission-denied'
                    ? 'Нет прав: запускать эфир может только администратор.'
                    : (error?.message || 'Не удалось сохранить эфир.'), 'error');
            } finally {
                busy = false;
                ui.stop.disabled = false;
                refreshStart();
            }
        }

        form.addEventListener('submit', event => {
            event.preventDefault();
            if (!ready()) return;
            const isYoutube = mode() === 'youtube';
            const startDate = when() === 'later' ? plannedDate() : null;
            const doneText = startDate
                ? `Добавлено в расписание: ${dayFormat.format(startDate)}, ${timeFormat.format(startDate)}.`
                : 'Эфир запущен — зрители уже видят его.';
            publish(isYoutube ? {
                mode: 'youtube',
                title: ui.title.value || ui.ytName.textContent,
                youtubeUrl: `https://www.youtube.com/watch?v=${draft.youtube.id}`,
                youtubeLive: ui.ytLive.checked,
                durationMin: ui.ytDuration.value
            } : {
                mode: 'movie',
                title: ui.title.value || draft.movie.name,
                kinopoiskId: draft.movie.kinopoiskId,
                durationMin: ui.duration.value,
                posterUrl: draft.movie.posterUrl
            }, doneText, startDate);
        });

        ui.stop.addEventListener('click', async () => {
            const confirmed = window.ConfirmDialog
                ? await window.ConfirmDialog.confirm({ title: 'Остановить эфир?', message: 'Страница «Эфир» у всех зрителей сразу станет пустой.', confirmLabel: 'Остановить', danger: true })
                : true;
            if (confirmed) publish({ mode: 'off', title: '' }, 'Эфир остановлен.');
        });

        syncGroups();
        syncWhen();
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
                resolveCurrent();
                if (!sweptOnce) {
                    sweptOnce = true;
                    service.sweepFinished(items).catch(() => {});
                }
            }, error => console.warn('[AdminLive] Schedule read failed:', error));
            // The «now» card ticks every second; the list only needs a periodic refresh
            // (rebuilding it each second would steal focus from its buttons).
            setInterval(() => {
                if (!manual) return;
                current = resolveChannel(manual, scheduleItems);
                renderNow();
            }, 1000);
            setInterval(renderSchedule, 30000);
        }).catch(() => setStatus('Firebase недоступен — эфир сейчас нельзя изменить.', 'error'));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
