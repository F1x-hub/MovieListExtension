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
        const { computePosition, formatClock, coverUrl } = window.CinemaChannel;

        const ui = {
            nowCard: $('liveNowCard'), nowMedia: $('liveNowMedia'), nowState: $('liveNowState'),
            nowTitle: $('liveNowTitle'), nowMeta: $('liveNowMeta'), stop: $('liveStopBtn'),
            start: $('liveStartBtn'), status: $('liveChannelStatus'), title: $('liveTitleInput'),
            ytInput: $('liveYoutubeInput'), ytPreview: $('liveYoutubePreview'), ytThumb: $('liveYoutubeThumb'),
            ytName: $('liveYoutubeName'), ytLive: $('liveYoutubeLive'),
            movieSearch: $('liveMovieSearch'), movieResults: $('liveMovieResults'), moviePreview: $('liveMoviePreview'),
            moviePoster: $('liveMoviePoster'), movieName: $('liveMovieName'), movieMeta: $('liveMovieMeta'),
            duration: $('liveMovieDurationInput')
        };
        const groups = form.querySelectorAll('[data-live-mode]');
        const draft = { youtube: null, movie: null };
        let titleTouched = false;
        let service = null;
        let current = null;
        let busy = false;
        let searchSeq = 0;

        const mode = () => form.querySelector('input[name="liveMode"]:checked')?.value || 'youtube';
        const setStatus = (text, tone = '') => { ui.status.textContent = text; ui.status.dataset.tone = tone; };
        const ready = () => (mode() === 'youtube' ? Boolean(draft.youtube) : Boolean(draft.movie));
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
            ui.nowState.textContent = position.state === 'ended' ? 'Показ завершён' : 'В эфире';
            const source = channel.mode === 'youtube' ? (live ? 'YouTube · прямая трансляция' : 'YouTube') : 'Фильм';
            const total = channel.movie?.durationSec;
            const clock = live ? '' : position.state === 'ended'
                ? ''
                : ` · идёт ${formatClock(position.offsetSec)}${total ? ` из ${formatClock(total)}` : ''}`;
            ui.nowMeta.textContent = source + clock;
        }

        // ---- Source picker ---------------------------------------------------------
        const syncGroups = () => {
            groups.forEach(group => { group.hidden = group.dataset.liveMode !== mode(); });
            refreshStart();
        };
        form.addEventListener('change', event => { if (event.target.name === 'liveMode') syncGroups(); });
        ui.title.addEventListener('input', () => { titleTouched = ui.title.value.trim().length > 0; });

        // ---- YouTube: instant preview + title from oEmbed --------------------------
        const updateYoutube = debounce(async () => {
            const raw = ui.ytInput.value.trim();
            const info = raw && typeof Utils !== 'undefined' ? Utils.extractYouTubeVideoInfo(raw) : null;
            draft.youtube = info ? { id: info.id } : null;
            ui.ytPreview.hidden = !info;
            ui.ytInput.setAttribute('aria-invalid', String(Boolean(raw) && !info));
            refreshStart();
            if (!info) {
                if (raw) setStatus('Это не похоже на ссылку YouTube.', 'error');
                return;
            }
            setStatus('');
            ui.ytThumb.src = `https://i.ytimg.com/vi/${encodeURIComponent(info.id)}/hqdefault.jpg`;
            if (/youtube\.com\/live\//i.test(raw)) ui.ytLive.checked = true;
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
        async function publish(input, doneText) {
            if (!service) return;
            busy = true;
            refreshStart();
            ui.stop.disabled = true;
            setStatus('Сохраняем…');
            try {
                await service.save(input, { restart: true });
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
            publish(isYoutube ? {
                mode: 'youtube',
                title: ui.title.value || ui.ytName.textContent,
                youtubeUrl: `https://www.youtube.com/watch?v=${draft.youtube.id}`,
                youtubeLive: ui.ytLive.checked
            } : {
                mode: 'movie',
                title: ui.title.value || draft.movie.name,
                kinopoiskId: draft.movie.kinopoiskId,
                durationMin: ui.duration.value,
                posterUrl: draft.movie.posterUrl
            }, 'Эфир запущен — зрители уже видят его.');
        });

        ui.stop.addEventListener('click', async () => {
            const confirmed = window.ConfirmDialog
                ? await window.ConfirmDialog.confirm({ title: 'Остановить эфир?', message: 'Страница «Эфир» у всех зрителей сразу станет пустой.', confirmLabel: 'Остановить', danger: true })
                : true;
            if (confirmed) publish({ mode: 'off', title: '' }, 'Эфир остановлен.');
        });

        syncGroups();
        renderNow();

        waitForFirebase().then(manager => {
            service = new window.CinemaChannelService(manager);
            refreshStart();
            service.subscribe(channel => { current = channel; renderNow(); }, error => {
                console.warn('[AdminLive] Channel read failed:', error);
                ui.nowState.textContent = 'Статус недоступен';
            });
            setInterval(renderNow, 1000);
        }).catch(() => setStatus('Firebase недоступен — эфир сейчас нельзя изменить.', 'error'));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
