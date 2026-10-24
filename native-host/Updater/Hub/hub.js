'use strict';

(() => {
    const RUNNING = new Set(['queued', 'downloading', 'replacing', 'installing', 'verifying']);
    const PHASES = {
        queued: 'Подготовка…',
        downloading: 'Загрузка и проверка подписи…',
        verifying: 'Проверка установки…',
        installing: 'Установка… Подтвердите запрос Windows, если он появится.',
        replacing: 'Замена файлов…'
    };
    const ERRORS = {
        NETWORK_UNAVAILABLE: 'Нет связи с сервером обновлений. Проверьте интернет и повторите.',
        FEED_INVALID: 'Сервер вернул повреждённые данные обновления. Попробуйте позже.',
        FEED_UNAVAILABLE: 'Сервер обновлений недоступен.',
        CATALOG_NOT_PUBLISHED: 'Каталог компонентов ещё не опубликован в релизе.',
        HUB_BUSY: 'Подождите завершения текущего действия.',
        UPDATE_IN_PROGRESS: 'Сейчас уже идёт обновление. Повторите после его завершения.',
        ELEVATION_DECLINED: 'Установка отменена: запрос администратора Windows был отклонён.',
        SUITE_INSTALL_CANCELLED: 'Установка медиаплеера была отменена.',
        SUITE_INSTALL_FAILED: 'Установщик медиаплеера завершился с ошибкой.',
        SUITE_INSTALL_TIMEOUT: 'Установщик медиаплеера не завершился вовремя.',
        SUITE_VERSION_MISMATCH: 'Медиаплеер установлен, но служба не подтвердила новую версию.',
        SUITE_ACTIVATION_NOT_CONFIRMED: 'Служба медиаплеера не подтвердила новую версию — выполнен откат.',
        SUITE_BROKER_TIMEOUT: 'Служба обслуживания медиаплеера не ответила вовремя.',
        SUITE_BROKER_REJECTED: 'Служба обслуживания медиаплеера отклонила обновление.',
        SUITE_RECOVERY_REQUIRED: 'Установка медиаплеера требует восстановления. Нажмите «Восстановить установку».',
        COMPONENT_NOT_NEWER: 'Установлена та же или более новая версия.',
        COMPONENT_EXECUTION_FAILED: 'Не удалось выполнить установку компонента.',
        COMPONENT_REQUEST_REJECTED: 'Компонент не прошёл проверку подписи или совместимости.',
        UPDATER_PROBE_FAILED: 'Новая версия хаба не прошла проверку — оставлена текущая.',
        UPDATER_RECOVERY_REQUIRED: 'Не удалось вернуть прежнюю версию хаба. Скачайте MovieListSetup.exe заново.',
        CHROME_NOT_FOUND: 'Chrome не найден. Откройте chrome://extensions вручную.',
        FOLDER_UNAVAILABLE: 'Папка не найдена.',
        RELOAD_VERSION_MISMATCH: 'Chrome загружает другую папку расширения. Укажите папку, которая подключена в Chrome.',
        CONFIRMATION_EXPIRED: 'Браузер не подтвердил установку обновления.'
    };

    const pending = new Map();
    let sequence = 0;
    let state = null;
    let pollTimer = 0;
    let installTarget = null;

    const $ = (id) => document.getElementById(id);

    function call(action, args = {}) {
        return new Promise((resolve) => {
            const id = String(++sequence);
            pending.set(id, resolve);
            window.chrome.webview.postMessage({ id, action, args });
        });
    }

    window.chrome.webview.addEventListener('message', (event) => {
        const message = event.data || {};
        if (message.event === 'progress') {
            $('installProgressLabel').textContent = {
                downloading: 'Загрузка расширения…',
                verifying: 'Проверка подписи и архива…',
                installing: 'Установка файлов…'
            }[message.value] || '';
            return;
        }
        const resolve = pending.get(message.id);
        if (resolve) {
            pending.delete(message.id);
            resolve(message.result || {});
        }
    });

    function errorText(result) {
        return ERRORS[result?.errorCode] || result?.error || 'Действие не выполнено.';
    }

    function compareVersions(left, right) {
        const a = String(left || '').split('.').map(Number);
        const b = String(right || '').split('.').map(Number);
        for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
            const difference = (a[index] || 0) - (b[index] || 0);
            if (difference) return Math.sign(difference);
        }
        return 0;
    }

    const isNewer = (latest, installed) => Boolean(latest && installed && compareVersions(latest, installed) > 0);

    function showNotice(text, tone = '') {
        const notice = $('notice');
        notice.hidden = !text;
        notice.textContent = text || '';
        if (tone) notice.dataset.tone = tone; else delete notice.dataset.tone;
    }

    function button(label, variant, handler, { disabled = false, title = '' } = {}) {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = `btn btn--${variant} btn--small`;
        element.textContent = label;
        element.disabled = disabled;
        if (title) element.title = title;
        element.addEventListener('click', handler);
        return element;
    }

    function setBadge(card, text, tone) {
        const badge = card.querySelector('[data-role="badge"]');
        badge.textContent = text;
        badge.dataset.tone = tone;
    }

    function setFacts(card, rows) {
        const facts = card.querySelector('[data-role="facts"]');
        facts.replaceChildren(...rows.filter(([, value]) => value !== null && value !== undefined && value !== '')
            .flatMap(([label, value]) => {
                const term = document.createElement('dt');
                const detail = document.createElement('dd');
                term.textContent = label;
                detail.textContent = String(value);
                detail.title = String(value);
                // Versions and paths are data; prose values keep the UI font.
                if (/^[\d.]+$|[\\/]/.test(String(value))) detail.className = 'facts__data';
                return [term, detail];
            }));
    }

    function setActions(card, buttons) {
        card.querySelector('[data-role="actions"]').replaceChildren(...buttons.filter(Boolean));
    }

    // Shows the hub-tracked component journal inside its own card.
    function renderOperation(card, componentId) {
        const box = card.querySelector('[data-role="operation"]');
        const operation = state?.componentOperation;
        if (!operation || operation.componentId !== componentId
            || operation.status === 'succeeded' || operation.status === 'dismissed') {
            box.hidden = true;
            return false;
        }
        box.hidden = false;
        if (RUNNING.has(operation.status)) {
            const total = Number(operation.totalBytes), done = Number(operation.downloadedBytes);
            const measured = operation.status === 'downloading' && total > 0 && done >= 0;
            box.innerHTML = '<div class="progress__bar"><div class="progress__fill"></div></div><span class="operation__text"></span>';
            const bar = box.querySelector('.progress__bar');
            if (measured) {
                const percent = Math.min(100, Math.floor(done / total * 100));
                bar.classList.add('progress__bar--measured');
                bar.querySelector('.progress__fill').style.width = `${percent}%`;
                bar.setAttribute('role', 'progressbar');
                bar.setAttribute('aria-valuenow', String(percent));
                bar.setAttribute('aria-valuemin', '0');
                bar.setAttribute('aria-valuemax', '100');
            }
            box.querySelector('.operation__text').textContent = phaseText(operation, measured ? { done, total } : null);
            return true;
        }
        const row = document.createElement('div');
        row.className = 'operation__row';
        const text = document.createElement('span');
        text.className = 'operation__text';
        text.textContent = ERRORS[operation.errorCode] || `Операция не выполнена (${operation.errorCode || operation.status}).`;
        row.append(text, button('Скрыть', 'ghost', async () => {
            const result = await call('dismissComponent', { operationId: operation.operationId });
            if (result.success !== true) showNotice(errorText(result), 'danger');
            await refresh(false);
        }));
        box.replaceChildren(row);
        return false;
    }

    const megabytes = bytes => (bytes / 1024 / 1024).toFixed(0);

    // The maintenance broker never shows a Windows prompt; only the fallback
    // installer path can, so the prompt is mentioned only there.
    function phaseText(operation, progress) {
        if (progress) {
            return `Загрузка: ${megabytes(progress.done)} из ${megabytes(progress.total)} МБ (${Math.floor(progress.done / progress.total * 100)}%)`;
        }
        if (operation.broker) {
            if (operation.brokerPhase === 'draining') return 'Ждём окончания просмотра, затем установим обновление…';
            return {
                queued: 'Служба обслуживания готовит обновление…',
                downloading: 'Служба обслуживания скачивает обновление…',
                installing: 'Установка в фоне…',
                verifying: 'Проверка установки…'
            }[operation.status] || 'Выполняется в фоне…';
        }
        return PHASES[operation.status] || 'Выполняется…';
    }

    function renderExtension() {
        const card = $('extensionCard');
        const extension = state.extension;
        const operation = extension.operation;
        if (!extension.configured) {
            setBadge(card, 'Не установлено', 'neutral');
        } else if (operation?.status === 'failed' && operation.errorCode === 'RELOAD_VERSION_MISMATCH') {
            setBadge(card, 'Другая папка в Chrome', 'warning');
        } else if (isNewer(extension.latestVersion, extension.installedVersion)) {
            setBadge(card, `Доступна ${extension.latestVersion}`, 'update');
        } else {
            setBadge(card, 'Подключено', 'ok');
        }
        setFacts(card, [
            ['Установлено', extension.installedVersion || '—'],
            ['Последняя', extension.latestVersion || (extension.feedError ? 'нет связи' : '—')],
            ['Папка', extension.path]
        ]);
        setActions(card, extension.configured ? [
            button('Скопировать путь', 'ghost', () => copyPath(extension.path)),
            button('Открыть папку', 'ghost', () => openFolder('extension')),
            button('Сменить папку', 'link', connectExistingFolder)
        ] : []);
        $('onboarding').hidden = extension.configured === true;
        if (!installTarget) installTarget = extension.defaultPath;
        $('installFolder').textContent = installTarget;
    }

    function renderPlayer() {
        const card = $('playerCard');
        const player = state.player;
        const catalogReady = state.catalog.available && Boolean(player.latestVersion);
        const busy = renderOperation(card, 'mediaPlayerSuite');
        const unavailable = catalogReady ? '' : (ERRORS[state.catalog.error] || 'Установщик медиаплеера сейчас недоступен.');
        let actions = [];
        if (!player.installed) {
            setBadge(card, 'Не установлен', 'neutral');
            actions = [button('Установить медиаплеер', 'primary', () => startComponent('installPlayer'),
                { disabled: busy || !catalogReady, title: unavailable })];
        } else if (player.needsFullSetup) {
            setBadge(card, 'Нужно восстановление', 'warning');
            actions = [button('Восстановить установку', 'primary', () => startComponent('installPlayer'),
                { disabled: busy || !catalogReady, title: unavailable })];
        } else if (isNewer(player.latestVersion, player.version)) {
            setBadge(card, `Доступна ${player.latestVersion}`, 'update');
            actions = [button('Обновить', 'primary', () => startComponent('updatePlayer'), { disabled: busy })];
        } else {
            setBadge(card, 'Установлен', 'ok');
        }
        if (busy) setBadge(card, 'Выполняется', 'busy');
        const service = { running: 'работает', stopped: 'остановлена', absent: 'не найдена' }[player.serviceStatus] || player.serviceStatus;
        setFacts(card, [
            ['Установлено', player.installed ? (player.version || 'версия неизвестна') : '—'],
            ['Последняя', player.latestVersion || '—'],
            ['Служба', player.installed ? `${service}${player.ready ? ', готова' : ''}` : null],
            ['Обслуживание', player.installed ? (player.brokerAvailable ? 'фоновое, без запросов' : 'с подтверждением Windows') : null],
            ['Папка', player.installPath]
        ]);
        if (player.installed) actions.push(button('Открыть папку', 'ghost', () => openFolder('player')));
        setActions(card, actions);
        const notes = [];
        if (player.installed && player.needsFullSetup) {
            notes.push('Эта установка не поддерживает автообновление. Полная установка сохранит фильмы, настройки и аккаунт и перенесёт плеер в защищённую папку.');
        }
        if (unavailable && (!player.installed || player.needsFullSetup)) notes.push(unavailable);
        const box = card.querySelector('[data-role="operation"]');
        if (notes.length && !busy && box.hidden) {
            box.hidden = false;
            box.replaceChildren(...notes.map(text => {
                const line = document.createElement('span');
                line.className = 'operation__text';
                line.textContent = text;
                return line;
            }));
        }
        return busy;
    }

    function renderHub() {
        const card = $('hubCard');
        const hub = state.hub;
        const installed = hub.installedVersion || hub.runningVersion;
        const busy = renderOperation(card, 'updater');
        if (busy) setBadge(card, 'Выполняется', 'busy');
        else if (isNewer(hub.latestVersion, installed)) setBadge(card, `Доступна ${hub.latestVersion}`, 'update');
        else setBadge(card, hub.installed ? 'Установлен' : 'Не установлен', hub.installed ? 'ok' : 'neutral');
        setFacts(card, [
            ['Установлено', hub.installedVersion || '—'],
            ['Запущено', hub.runningVersion],
            ['Последняя', hub.latestVersion || '—']
        ]);
        setActions(card, [isNewer(hub.latestVersion, installed) && hub.installed
            ? button('Обновить хаб', 'primary', () => startComponent('updateHub'), { disabled: busy }) : null]);
        $('hubVersion').textContent = `Версия ${hub.runningVersion}`;
        return busy;
    }

    function render() {
        renderExtension();
        const playerBusy = renderPlayer();
        const hubBusy = renderHub();
        const feedError = state.extension.feedError;
        if (feedError && !$('notice').dataset.sticky) showNotice(ERRORS[feedError] || 'Не удалось проверить обновления.', 'danger');
        clearTimeout(pollTimer);
        if (playerBusy || hubBusy) pollTimer = setTimeout(() => refresh(false), 2000);
    }

    async function refresh(fromNetwork) {
        const button = $('refreshButton');
        if (fromNetwork) button.disabled = true;
        const result = await call('status', { refresh: fromNetwork });
        button.disabled = false;
        if (result.success !== true) {
            showNotice(errorText(result), 'danger');
            return;
        }
        if (fromNetwork) showNotice('');
        state = result;
        render();
    }

    async function startComponent(action) {
        showNotice('');
        const result = await call(action);
        if (result.success !== true) showNotice(errorText(result), 'danger');
        await refresh(false);
    }

    async function copyPath(path) {
        const result = await call('copyText', { text: path });
        showNotice(result.success === true ? 'Путь скопирован.' : errorText(result), result.success === true ? 'ok' : 'danger');
    }

    async function openFolder(target) {
        const result = await call('openFolder', { target });
        if (result.success !== true) showNotice(errorText(result), 'danger');
    }

    function showChromeStep(path) {
        $('chromeStepPath').textContent = path;
        $('chromeStep').hidden = false;
        void call('copyText', { text: path });
    }

    async function connectExistingFolder() {
        const choice = await call('chooseFolder', { title: 'Выберите папку распакованного расширения MovieList' });
        if (choice.success !== true) return;
        const result = await call('connectFolder', { folder: choice.path });
        if (result.success !== true) {
            showNotice(errorText(result), 'danger');
            return;
        }
        showNotice('Папка подключена. Если Chrome уже был открыт, перезапустите его полностью.', 'ok');
        showChromeStep(result.path);
        await refresh(false);
    }

    $('refreshButton').addEventListener('click', () => refresh(true));
    $('changeFolderButton').addEventListener('click', async () => {
        const choice = await call('chooseFolder', { title: 'Папка для установки расширения', initial: installTarget });
        if (choice.success === true) {
            installTarget = choice.path;
            $('installFolder').textContent = installTarget;
        }
    });
    $('installExtensionButton').addEventListener('click', async () => {
        const installButton = $('installExtensionButton');
        installButton.disabled = true;
        $('installProgress').hidden = false;
        $('installProgressLabel').textContent = 'Подготовка…';
        const result = await call('installExtension', { folder: installTarget });
        $('installProgress').hidden = true;
        installButton.disabled = false;
        if (result.success !== true) {
            showNotice(errorText(result), 'danger');
            return;
        }
        showNotice('Расширение установлено и подключено к автоматическим обновлениям.', 'ok');
        showChromeStep(result.path);
        await refresh(false);
    });
    $('connectExistingButton').addEventListener('click', connectExistingFolder);
    $('copyPathButton').addEventListener('click', () => copyPath($('chromeStepPath').textContent));
    $('openChromeButton').addEventListener('click', async () => {
        const result = await call('openExtensionsPage');
        if (result.success !== true) showNotice(errorText(result), 'danger');
    });
    $('chromeDoneButton').addEventListener('click', () => { $('chromeStep').hidden = true; });

    const lightQuery = window.matchMedia('(prefers-color-scheme: light)');
    const applyTheme = () => {
        document.documentElement.classList.toggle('light-theme', lightQuery.matches);
        $('brandIcon').src = lightQuery.matches ? 'icon-black.png' : 'icon-white.png';
    };
    lightQuery.addEventListener('change', applyTheme);
    applyTheme();
    void refresh(true);
})();
