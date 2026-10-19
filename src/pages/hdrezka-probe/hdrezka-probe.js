(function () {
    'use strict';
    ThemeService.applyTheme(ThemeService.getCurrentTheme(), { persist: false, syncChromeStorage: false });
    const fileInput = document.getElementById('harFile');
    const select = document.getElementById('streamSelect');
    const play = document.getElementById('playButton');
    const stop = document.getElementById('stopButton');
    const clear = document.getElementById('clearButton');
    const status = document.getElementById('probeStatus');
    const metrics = document.getElementById('playbackMetrics');
    const mount = document.getElementById('playerMount');
    let sources = [];
    let transport = null;
    let generation = 0;
    let importGeneration = 0;

    function dispose() {
        generation += 1;
        transport?.destroy();
        transport = null;
        const video = mount.querySelector('video');
        if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
        mount.replaceChildren();
        mount.hidden = true;
        stop.disabled = true;
        metrics.textContent = '';
    }

    function reset(clearFile = true) {
        importGeneration += 1;
        dispose();
        sources = [];
        if (clearFile) fileInput.value = '';
        select.replaceChildren(new Option('Сначала выберите файл', ''));
        select.disabled = play.disabled = clear.disabled = true;
    }

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        reset(false);
        if (!file) return;
        const request = importGeneration;
        status.textContent = 'Чтение записи…';
        try {
            if (file.size > HdrezkaProbeSources.MAX_BYTES) throw new Error('too-large');
            const value = JSON.parse(await file.text());
            if (request !== importGeneration) return;
            sources = HdrezkaProbeSources.fromHar(value);
            if (!sources.length) throw new Error('no-streams');
            select.replaceChildren(...sources.map((_source, index) => new Option(`Поток ${index + 1}`, String(index))));
            select.disabled = play.disabled = clear.disabled = false;
            status.textContent = `Найдено потоков: ${sources.length}. Нажмите «Воспроизвести».`;
        } catch (error) {
            if (request !== importGeneration) return;
            status.textContent = error.message === 'too-large' ? 'Файл превышает 32 МБ. Сохраните запись только запросов видео.'
                : error.message === 'no-streams' ? 'В записи нет успешных запросов m3u8 с поддерживаемых серверов HDRezka.'
                    : 'Не удалось прочитать HAR. Выберите JSON-запись Network.';
        }
    });

    select.addEventListener('change', () => {
        dispose();
        status.textContent = 'Поток выбран. Нажмите «Воспроизвести».';
    });
    play.addEventListener('click', () => {
        const source = sources[Number(select.value)];
        if (!source) return;
        dispose();
        const request = generation;
        let failed = false;
        const video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        mount.replaceChildren(video);
        mount.hidden = false;
        stop.disabled = false;
        status.textContent = 'Загрузка видео…';
        const active = () => !failed && generation === request && mount.contains(video);
        const update = () => {
            if (!active()) return;
            const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
            metrics.textContent = `${video.videoWidth} × ${video.videoHeight} · ${Math.floor(video.currentTime)} / ${duration} с`;
        };
        video.addEventListener('loadeddata', () => { if (active()) { status.textContent = 'Кадр видео загружен. Можно запустить просмотр и проверить перемотку.'; update(); } });
        video.addEventListener('playing', () => { if (active()) status.textContent = 'Видео воспроизводится.'; });
        video.addEventListener('seeked', () => { if (active()) { status.textContent = 'Позиция изменена. Ожидание воспроизведения…'; update(); } });
        video.addEventListener('timeupdate', update);
        transport = HlsPlaybackFactory.create(video, source.url, {
            networkProfile: 'hdrezka', providerManifestUrl: source.url,
            rememberBandwidth: false, maxNetworkRetries: 1, isCurrent: active,
            onFatal: ({ reason }) => {
                if (!active()) return true;
                failed = true;
                status.textContent = reason === 'policy' ? 'Поток отклонён: перенаправление или адрес вне разрешённого каталога.'
                    : reason === 'source-rejected' ? 'Сервер отклонил ссылку. Запишите свежий HAR на HDRezka.'
                        : 'Не удалось воспроизвести поток. Проверьте доступ к HDRezka и запишите свежий HAR.';
                return true;
            }
        });
        if (!transport) { if (!failed) status.textContent = 'HLS недоступен в этом браузере.'; return; }
        video.play().catch(() => { if (active()) status.textContent = 'Нажмите Play на видео, чтобы начать просмотр.'; });
    });
    stop.addEventListener('click', () => { dispose(); status.textContent = 'Воспроизведение остановлено.'; });
    clear.addEventListener('click', () => { reset(); status.textContent = 'Запись очищена. Выберите файл для новой проверки.'; });
    window.addEventListener('pagehide', () => { reset(); });
})();
