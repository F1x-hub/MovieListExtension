import { i18n } from '../../shared/i18n/I18n.js';

const SUBTITLE_APPEARANCE_STORAGE_KEY = 'movieExtensionSubtitleAppearanceV1';
const EXTENSION_UPDATE_STATE_STORAGE_KEY = 'extension_update_state_v2';
const MEDIA_PLAYER_SETUP_STORAGE_KEY = 'mediaplayer_setup_v1';
const MEDIA_PLAYER_SETUP_DEFAULTS = Object.freeze({
    enabled: false,
    status: 'disabled',
    installPath: '',
    version: '',
    verifiedAt: '',
    checks: [],
    errorCode: '',
    errorMessage: ''
});
const SUBTITLE_APPEARANCE_DEFAULTS = Object.freeze({
    version: 1,
    fontSizePercent: 100,
    color: '#ffffff',
    position: 'bottom',
    offsetPercent: 6,
    backgroundOpacity: 0.45,
    textShadow: 'strong'
});

const SUBTITLE_APPEARANCE_LIMITS = Object.freeze({
    fontSizePercent: { min: 75, max: 200, step: 5 },
    offsetPercent: { min: 2, max: 20, step: 1 },
    backgroundOpacity: { min: 0, max: 0.9, step: 0.05 }
});

function normalizeSubtitleAppearanceNumber(value, { min, max, step }, fallback) {
    if (
        (typeof value !== 'number' && typeof value !== 'string') ||
        (typeof value === 'string' && value.trim() === '')
    ) {
        return fallback;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;

    const boundedValue = Math.min(max, Math.max(min, numericValue));
    const steppedValue = Math.round((boundedValue - min) / step) * step + min;
    return Number(steppedValue.toFixed(2));
}

function normalizeSubtitleAppearance(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const color = typeof source.color === 'string' && /^#[\da-f]{6}$/i.test(source.color)
        ? source.color.toLowerCase()
        : SUBTITLE_APPEARANCE_DEFAULTS.color;

    return {
        version: SUBTITLE_APPEARANCE_DEFAULTS.version,
        fontSizePercent: normalizeSubtitleAppearanceNumber(
            source.fontSizePercent,
            SUBTITLE_APPEARANCE_LIMITS.fontSizePercent,
            SUBTITLE_APPEARANCE_DEFAULTS.fontSizePercent
        ),
        color,
        position: ['bottom', 'top'].includes(source.position)
            ? source.position
            : SUBTITLE_APPEARANCE_DEFAULTS.position,
        offsetPercent: normalizeSubtitleAppearanceNumber(
            source.offsetPercent,
            SUBTITLE_APPEARANCE_LIMITS.offsetPercent,
            SUBTITLE_APPEARANCE_DEFAULTS.offsetPercent
        ),
        backgroundOpacity: normalizeSubtitleAppearanceNumber(
            source.backgroundOpacity,
            SUBTITLE_APPEARANCE_LIMITS.backgroundOpacity,
            SUBTITLE_APPEARANCE_DEFAULTS.backgroundOpacity
        ),
        textShadow: ['none', 'soft', 'strong'].includes(source.textShadow)
            ? source.textShadow
            : SUBTITLE_APPEARANCE_DEFAULTS.textShadow
    };
}

function createDefaultSubtitleAppearance() {
    return { ...SUBTITLE_APPEARANCE_DEFAULTS };
}

function normalizeMediaPlayerSetup(value, enabled = false) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const isEnabled = enabled === true || source.enabled === true;
    const validStatuses = ['disabled', 'path_required', 'verifying', 'ready', 'error'];
    const status = !isEnabled
        ? 'disabled'
        : validStatuses.includes(source.status) && source.status !== 'disabled'
            ? source.status
            : 'path_required';
    return {
        ...MEDIA_PLAYER_SETUP_DEFAULTS,
        ...source,
        enabled: isEnabled,
        status,
        installPath: String(source.installPath || '').trim(),
        version: source.version ? String(source.version) : '',
        verifiedAt: source.verifiedAt ? String(source.verifiedAt) : '',
        checks: Array.isArray(source.checks) ? source.checks : [],
        errorCode: source.errorCode ? String(source.errorCode) : '',
        errorMessage: source.errorMessage ? String(source.errorMessage) : ''
    };
}

function createDefaultMediaPlayerSetup() {
    return { ...MEDIA_PLAYER_SETUP_DEFAULTS, checks: [] };
}

function haveMatchingMediaPlayerSetup(first, second) {
    const left = normalizeMediaPlayerSetup(first, first?.enabled === true);
    const right = normalizeMediaPlayerSetup(second, second?.enabled === true);
    return left.enabled === right.enabled
        && left.status === right.status
        && left.installPath === right.installPath;
}

function haveMatchingSubtitleAppearances(first, second) {
    return Object.keys(SUBTITLE_APPEARANCE_DEFAULTS)
        .every((key) => first?.[key] === second?.[key]);
}

let initialState = {
    displayMode: 'popup',
    language: 'en',
    showAnimeRadio: false,
    animeRadioSource: 'anison',
    showGames: false,
    torrentRetentionDays: 7,
    mediaPlayerEnabled: false,
    mediaPlayerSetup: createDefaultMediaPlayerSetup(),
    subtitleAppearance: createDefaultSubtitleAppearance(),
    autoUpdateEnabled: true
};

let currentState = { ...initialState };
let isDirty = false;

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize I18n
    await i18n.init();
    i18n.translatePage();
    // Initialize Navigation
    const nav = new Navigation('navbar');
    nav.render();

    // Intercept Navigation
    setupNavigationInterception();

    // Elements
    const displayModeRadios = document.getElementsByName('displayMode');
    const languageDropdown = document.getElementById('languageDropdown');
    const dropdownHeader = languageDropdown.querySelector('.dropdown-trigger');
    const dropdownItems = languageDropdown.querySelectorAll('.dropdown-option');
    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');
    const torrentRetentionSelect = document.getElementById('torrentRetentionDays');
    const mediaplayerRetentionStatus = document.getElementById('mediaplayerRetentionStatus');
    const mediaPlayerEnabledToggle = document.getElementById('mediaPlayerEnabledToggle');
    const mediaPlayerSetupPanel = document.getElementById('mediaPlayerSetupPanel');
    const mediaPlayerInstallPath = document.getElementById('mediaPlayerInstallPath');
    const mediaPlayerChooseFolderBtn = document.getElementById('mediaPlayerChooseFolderBtn');
    const mediaPlayerVerifyBtn = document.getElementById('mediaPlayerVerifyBtn');
    const mediaPlayerSetupStatus = document.getElementById('mediaPlayerSetupStatus');
    const mediaPlayerSetupChecks = document.getElementById('mediaPlayerSetupChecks');
    const mediaPlayerService = typeof window.MediaPlayerService === 'function'
        ? new window.MediaPlayerService()
        : null;
    let mediaPlayerRetentionLoaded = false;
    const jackettIndexersStatus = document.getElementById('jackettIndexersStatus');
    const jackettIndexersList = document.getElementById('jackettIndexersList');
    const jackettIndexerAddBtn = document.getElementById('jackettIndexerAddBtn');
    const jackettIndexersRefreshBtn = document.getElementById('jackettIndexersRefreshBtn');
    let jackettIndexersState = { indexers: [], enabledIds: [] };
    let jackettIndexersLoading = false;
    let jackettIndexerMutation = false;
    const subtitleFontSizePercentInput = document.getElementById('subtitleFontSizePercent');
    const subtitleFontSizePercentOutput = document.getElementById('subtitleFontSizePercentOutput');
    const subtitleColorInput = document.getElementById('subtitleColor');
    const subtitleColorOutput = document.getElementById('subtitleColorOutput');
    const subtitlePositionSelect = document.getElementById('subtitlePosition');
    const subtitleOffsetPercentInput = document.getElementById('subtitleOffsetPercent');
    const subtitleOffsetPercentOutput = document.getElementById('subtitleOffsetPercentOutput');
    const subtitleBackgroundOpacityInput = document.getElementById('subtitleBackgroundOpacity');
    const subtitleBackgroundOpacityOutput = document.getElementById('subtitleBackgroundOpacityOutput');
    const subtitleTextShadowSelect = document.getElementById('subtitleTextShadow');
    const subtitleAppearanceResetBtn = document.getElementById('subtitleAppearanceResetBtn');
    const subtitleAppearancePreviewFrame = document.getElementById('subtitleAppearancePreviewFrame');
    const subtitleAppearancePreviewCaption = document.getElementById('subtitleAppearancePreviewCaption');
    
    // Anime Radio Elements
    const animeRadioToggle = document.getElementById('animeRadioToggle');
    const radioSourceGroup = document.getElementById('radioSourceGroup');
    const radioSourceRadios = document.getElementsByName('radioSource');

    // Mini Games Elements
    const gamesToggle = document.getElementById('gamesToggle');
    const extensionAutoUpdateToggle = document.getElementById('extensionAutoUpdateToggle');
    const extensionUpdateStatus = document.getElementById('extensionUpdateStatus');
    const extensionUpdateSetupBtn = document.getElementById('extensionUpdateSetupBtn');
    const extensionUpdateInstallBtn = document.getElementById('extensionUpdateInstallBtn');
    document.getElementById('extensionUpdateLogsBtn')?.addEventListener('click', async () => {
        const report = await globalThis.UpdateService.exportDiagnostics();
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `MovieList-update-diagnostics-${Date.now()}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    });
    const extensionUpdateInstallStatus = document.getElementById('extensionUpdateInstallStatus');
    
    // Sidebar Navigation Elements
    const sidebarLinks = document.querySelectorAll('.sidebar-link');
    const settingsPanes = document.querySelectorAll('.settings-pane');

    /**
     * Handle Sidebar Navigation
     */
    sidebarLinks.forEach(link => {
        link.addEventListener('mousedown', () => {
            // Remove active class from all links and panes
            sidebarLinks.forEach(l => l.classList.remove('active'));
            settingsPanes.forEach(p => p.classList.remove('active'));

            // Add active class to clicked link and target pane
            link.classList.add('active');
            const targetId = 'pane-' + link.dataset.target;
            const targetPane = document.getElementById(targetId);
            if (targetPane) {
                targetPane.classList.add('active');
            }
        });
    });

    /**
     * Update Dropdown UI
     */
    function updateDropdownUI(lang) {
        // Update header
        const selectedItem = Array.from(dropdownItems).find(item => item.dataset.value === lang);
        if (selectedItem) {
            const flag = selectedItem.querySelector('.item-flag').textContent;
            const name = selectedItem.querySelector('.native-name').textContent;
            
            dropdownHeader.querySelector('.selected-flag').textContent = flag;
            dropdownHeader.querySelector('.selected-name').textContent = name;
        }

        // Update active state in list
        dropdownItems.forEach(item => {
            if (item.dataset.value === lang) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });
    }

    /**
     * Handle Setting Changes tracking
     */
    function updateDirtyState() {
        isDirty = 
            currentState.displayMode !== initialState.displayMode ||
            currentState.language !== initialState.language ||
            currentState.showAnimeRadio !== initialState.showAnimeRadio ||
            currentState.animeRadioSource !== initialState.animeRadioSource ||
            currentState.showGames !== initialState.showGames ||
            currentState.mediaPlayerEnabled !== initialState.mediaPlayerEnabled ||
            !haveMatchingMediaPlayerSetup(currentState.mediaPlayerSetup, initialState.mediaPlayerSetup) ||
            !haveMatchingSubtitleAppearances(currentState.subtitleAppearance, initialState.subtitleAppearance) ||
            currentState.autoUpdateEnabled !== initialState.autoUpdateEnabled ||
            (mediaPlayerRetentionLoaded && currentState.torrentRetentionDays !== initialState.torrentRetentionDays);
            
        saveBtn.classList.toggle('is-dirty', isDirty);
        return isDirty;
    }

    /**
     * Handle Language Change (UI Only until Save)
     */
    async function handleLanguageChange(lang) {
        if (lang !== currentState.language) {
            currentState.language = lang;
            updateDropdownUI(lang);
            updateDirtyState();

            // Preview language temporarily
            try {
                await i18n.setLanguage(lang);
                i18n.translatePage();
            } catch (error) {
                console.error('Failed to preview language:', error);
            }
        }
        languageDropdown.classList.remove('active');
    }

    // Dropdown Event Listeners
    dropdownHeader.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        languageDropdown.classList.toggle('active');
    });

    document.addEventListener('mousedown', () => {
        languageDropdown.classList.remove('active');
    });

    dropdownItems.forEach(item => {
        item.addEventListener('mousedown', async (e) => {
            e.stopPropagation();
            const lang = item.dataset.value;
            await handleLanguageChange(lang);
        });
    });

    // Default Settings
    const DEFAULT_SETTINGS = {
        displayMode: 'popup',
        language: 'en',
        showAnimeRadio: false,
        animeRadioSource: 'anison',
        showGames: false,
        mediaPlayerEnabled: false
    };

    function updateSubtitleAppearanceUI() {
        const appearance = normalizeSubtitleAppearance(currentState.subtitleAppearance);
        const textShadows = {
            none: 'none',
            soft: '0 1px 3px rgb(0 0 0 / 0.72)',
            strong: '0 2px 6px rgb(0 0 0 / 0.92), 0 0 1px rgb(0 0 0 / 0.98)'
        };

        currentState.subtitleAppearance = appearance;

        if (subtitleFontSizePercentInput) subtitleFontSizePercentInput.value = String(appearance.fontSizePercent);
        if (subtitleFontSizePercentOutput) subtitleFontSizePercentOutput.textContent = `${appearance.fontSizePercent}%`;
        if (subtitleColorInput) subtitleColorInput.value = appearance.color;
        if (subtitleColorOutput) subtitleColorOutput.textContent = appearance.color.toUpperCase();
        if (subtitlePositionSelect) subtitlePositionSelect.value = appearance.position;
        if (subtitleOffsetPercentInput) subtitleOffsetPercentInput.value = String(appearance.offsetPercent);
        if (subtitleOffsetPercentOutput) subtitleOffsetPercentOutput.textContent = `${appearance.offsetPercent}%`;
        if (subtitleBackgroundOpacityInput) subtitleBackgroundOpacityInput.value = String(appearance.backgroundOpacity);
        if (subtitleBackgroundOpacityOutput) subtitleBackgroundOpacityOutput.textContent = `${Math.round(appearance.backgroundOpacity * 100)}%`;
        if (subtitleTextShadowSelect) subtitleTextShadowSelect.value = appearance.textShadow;

        if (subtitleAppearancePreviewFrame) {
            subtitleAppearancePreviewFrame.dataset.position = appearance.position;
            subtitleAppearancePreviewFrame.style.setProperty(
                '--subtitle-preview-offset',
                `${Math.round(appearance.offsetPercent * 1.8)}px`
            );
        }

        if (subtitleAppearancePreviewCaption) {
            subtitleAppearancePreviewCaption.style.setProperty('--subtitle-preview-color', appearance.color);
            subtitleAppearancePreviewCaption.style.setProperty('--subtitle-preview-font-size', `${appearance.fontSizePercent / 100}rem`);
            subtitleAppearancePreviewCaption.style.setProperty('--subtitle-preview-background-opacity', String(appearance.backgroundOpacity));
            subtitleAppearancePreviewCaption.style.setProperty('--subtitle-preview-text-shadow', textShadows[appearance.textShadow]);
        }
    }

    function updateSubtitleAppearance(field, value) {
        currentState.subtitleAppearance = normalizeSubtitleAppearance({
            ...currentState.subtitleAppearance,
            [field]: value
        });
        updateSubtitleAppearanceUI();
        updateDirtyState();
    }

    function getMediaPlayerSetupStatusText(setup) {
        if (!currentState.mediaPlayerEnabled) return 'MediaPlayer выключен.';
        if (setup.status === 'path_required') return 'Укажите папку установки MediaPlayer.';
        if (setup.status === 'verifying') return 'Проверяем MediaPlayer…';
        if (setup.status === 'ready') {
            return setup.version
                ? `MediaPlayer готов к работе (версия ${setup.version}).`
                : 'MediaPlayer готов к работе.';
        }
        return setup.errorMessage || 'Проверка установки MediaPlayer не пройдена.';
    }

    function renderMediaPlayerSetup() {
        const setup = normalizeMediaPlayerSetup(currentState.mediaPlayerSetup, currentState.mediaPlayerEnabled);
        currentState.mediaPlayerSetup = setup;
        const enabled = currentState.mediaPlayerEnabled === true;
        const hasPath = Boolean(setup.installPath);

        if (mediaPlayerEnabledToggle) mediaPlayerEnabledToggle.checked = enabled;
        if (mediaPlayerSetupPanel) mediaPlayerSetupPanel.hidden = !enabled;
        if (mediaPlayerInstallPath) mediaPlayerInstallPath.value = setup.installPath;
        if (mediaPlayerChooseFolderBtn) mediaPlayerChooseFolderBtn.disabled = !enabled || setup.status === 'verifying';
        if (mediaPlayerVerifyBtn) mediaPlayerVerifyBtn.disabled = !enabled || !hasPath || setup.status === 'verifying';
        if (mediaPlayerSetupStatus) {
            mediaPlayerSetupStatus.textContent = getMediaPlayerSetupStatusText(setup);
            mediaPlayerSetupStatus.dataset.state = setup.status;
        }
        if (mediaPlayerSetupChecks) {
            mediaPlayerSetupChecks.replaceChildren();
            setup.checks.forEach(check => {
                const item = document.createElement('li');
                item.className = 'mediaplayer-setup-check';
                item.dataset.status = String(check.status || 'pending');
                const label = document.createElement('span');
                label.textContent = check.label || check.id || 'Проверка';
                const message = document.createElement('span');
                message.textContent = check.message || check.status || '';
                item.append(label, message);
                mediaPlayerSetupChecks.appendChild(item);
            });
        }

        if (torrentRetentionSelect) {
            torrentRetentionSelect.disabled = !mediaPlayerRetentionLoaded || !enabled || setup.status !== 'ready';
        }
    }

    function renderJackettIndexers() {
        if (!jackettIndexersList) return;
        const ready = currentState.mediaPlayerEnabled && currentState.mediaPlayerSetup.status === 'ready';
        if (jackettIndexersRefreshBtn) {
            jackettIndexersRefreshBtn.disabled = !ready || jackettIndexersLoading || jackettIndexerMutation;
        }
        if (jackettIndexerAddBtn) {
            jackettIndexerAddBtn.disabled = !ready || jackettIndexersLoading || jackettIndexerMutation;
        }
        jackettIndexersList.replaceChildren();
        jackettIndexersState.indexers.forEach((indexer) => {
            const row = document.createElement('div');
            row.className = 'mediaplayer-indexer-row';
            row.setAttribute('role', 'listitem');

            const toggle = document.createElement('input');
            toggle.className = 'mediaplayer-indexer-toggle';
            toggle.type = 'checkbox';
            toggle.checked = indexer.enabled === true;
            toggle.disabled = !ready || jackettIndexersLoading || jackettIndexerMutation;
            toggle.dataset.indexerId = indexer.id;
            toggle.setAttribute('aria-label', `Использовать ${indexer.name}`);

            const info = document.createElement('div');
            info.className = 'mediaplayer-indexer-info';
            const name = document.createElement('span');
            name.className = 'mediaplayer-indexer-name';
            name.textContent = indexer.name;
            const meta = document.createElement('span');
            meta.className = 'mediaplayer-indexer-meta';
            meta.textContent = [indexer.language, indexer.type, indexer.id].filter(Boolean).join(' · ');
            info.append(name, meta);

            const testBtn = document.createElement('button');
            testBtn.className = 'btn btn-secondary mediaplayer-indexer-test';
            testBtn.type = 'button';
            testBtn.textContent = 'Проверить';
            testBtn.disabled = !ready || jackettIndexersLoading || jackettIndexerMutation;
            testBtn.dataset.indexerTestId = indexer.id;

            const actions = document.createElement('div');
            actions.className = 'mediaplayer-indexer-actions';

            const configureBtn = document.createElement('button');
            configureBtn.className = 'btn btn-secondary mediaplayer-indexer-configure';
            configureBtn.type = 'button';
            configureBtn.textContent = 'Настроить';
            configureBtn.disabled = !ready || jackettIndexersLoading || jackettIndexerMutation;
            configureBtn.dataset.indexerConfigureId = indexer.id;
            configureBtn.setAttribute('aria-label', `Настроить ${indexer.name}`);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-danger mediaplayer-indexer-delete';
            deleteBtn.type = 'button';
            deleteBtn.textContent = 'Удалить';
            deleteBtn.disabled = !ready || jackettIndexersLoading || jackettIndexerMutation;
            deleteBtn.dataset.indexerDeleteId = indexer.id;
            deleteBtn.setAttribute('aria-label', `Удалить ${indexer.name} из Jackett`);

            actions.append(configureBtn, testBtn, deleteBtn);
            row.append(toggle, info, actions);
            jackettIndexersList.appendChild(row);
        });
    }

    function setJackettIndexersStatus(message, state = '') {
        if (!jackettIndexersStatus) return;
        jackettIndexersStatus.textContent = message;
        jackettIndexersStatus.dataset.state = state;
    }

    async function loadJackettIndexers() {
        const ready = currentState.mediaPlayerEnabled && currentState.mediaPlayerSetup.status === 'ready';
        if (!ready || !mediaPlayerService) {
            jackettIndexersState = { indexers: [], enabledIds: [] };
            setJackettIndexersStatus('Включите и проверьте MediaPlayer, чтобы управлять индексерами.');
            renderJackettIndexers();
            return;
        }

        jackettIndexersLoading = true;
        setJackettIndexersStatus('Загружаем настроенные индексеры Jackett…');
        renderJackettIndexers();
        try {
            jackettIndexersState = await mediaPlayerService.getJackettIndexers();
            const enabledCount = jackettIndexersState.enabledIds.length;
            setJackettIndexersStatus(`Настроено: ${jackettIndexersState.indexers.length}; активно в поиске: ${enabledCount}.`);
        } catch (error) {
            jackettIndexersState = { indexers: [], enabledIds: [] };
            setJackettIndexersStatus(error?.message || 'Не удалось загрузить индексеры Jackett.', 'error');
        } finally {
            jackettIndexersLoading = false;
            renderJackettIndexers();
        }
    }

    async function updateJackettIndexerSelection() {
        if (!mediaPlayerService || jackettIndexerMutation) return;
        const previous = jackettIndexersState;
        const enabledIds = Array.from(jackettIndexersList?.querySelectorAll('[data-indexer-id]:checked') || [])
            .map(input => input.dataset.indexerId)
            .filter(Boolean);
        if (!enabledIds.length) {
            setJackettIndexersStatus('Оставьте активным хотя бы один индексер.', 'error');
            renderJackettIndexers();
            return;
        }

        jackettIndexerMutation = true;
        setJackettIndexersStatus('Сохраняем активные индексеры…');
        renderJackettIndexers();
        try {
            jackettIndexersState = await mediaPlayerService.updateJackettIndexers(enabledIds);
            setJackettIndexersStatus(`Активно в поиске: ${jackettIndexersState.enabledIds.length}.`);
        } catch (error) {
            jackettIndexersState = previous;
            setJackettIndexersStatus(error?.message || 'Не удалось сохранить выбор индексеров.', 'error');
        } finally {
            jackettIndexerMutation = false;
            renderJackettIndexers();
        }
    }

    async function testJackettIndexer(indexerId) {
        if (!mediaPlayerService || jackettIndexerMutation) return;
        jackettIndexerMutation = true;
        setJackettIndexersStatus('Проверяем индексер Jackett…');
        renderJackettIndexers();
        try {
            const result = await mediaPlayerService.testJackettIndexer(indexerId);
            setJackettIndexersStatus(result?.message || 'Индексер Jackett доступен.');
        } catch (error) {
            setJackettIndexersStatus(error?.message || 'Проверка индексера не пройдена.', 'error');
        } finally {
            jackettIndexerMutation = false;
            renderJackettIndexers();
        }
    }

    function getJackettIndexer(indexerId) {
        const id = String(indexerId || '').trim().toLowerCase();
        return jackettIndexersState.indexers.find(indexer => indexer.id === id) || { id, name: id };
    }

    async function configureJackettIndexer(indexerId) {
        if (!mediaPlayerService || jackettIndexerMutation) return;
        const indexer = getJackettIndexer(indexerId);
        jackettIndexerMutation = true;
        setJackettIndexersStatus(`Загружаем настройки ${indexer.name}…`);
        renderJackettIndexers();
        try {
            const config = await mediaPlayerService.getJackettIndexerConfig(indexer.id);
            const updates = await showJackettIndexerConfigDialog(indexer, config);
            if (!updates) return;
            setJackettIndexersStatus(`Сохраняем настройки ${indexer.name}…`);
            await mediaPlayerService.updateJackettIndexerConfig(indexer.id, updates);
            setJackettIndexersStatus(`Настройки ${indexer.name} сохранены.`);
        } catch (error) {
            setJackettIndexersStatus(error?.message || 'Не удалось изменить настройки индексера.', 'error');
        } finally {
            jackettIndexerMutation = false;
            renderJackettIndexers();
        }
    }

    async function deleteJackettIndexer(indexerId) {
        if (!mediaPlayerService || jackettIndexerMutation) return;
        const indexer = getJackettIndexer(indexerId);
        if (!await showJackettDeleteDialog(indexer)) return;

        jackettIndexerMutation = true;
        setJackettIndexersStatus(`Удаляем ${indexer.name} из Jackett…`);
        renderJackettIndexers();
        try {
            jackettIndexersState = await mediaPlayerService.deleteJackettIndexer(indexer.id);
            setJackettIndexersStatus(`${indexer.name} удалён из Jackett.`);
        } catch (error) {
            setJackettIndexersStatus(error?.message || 'Не удалось удалить индексер.', 'error');
        } finally {
            jackettIndexerMutation = false;
            renderJackettIndexers();
        }
    }

    async function addJackettIndexer() {
        if (!mediaPlayerService || jackettIndexerMutation || jackettIndexersLoading) return;

        jackettIndexersLoading = true;
        setJackettIndexersStatus('Загружаем каталог доступных индексеров Jackett…');
        renderJackettIndexers();
        try {
            const availableIndexers = await mediaPlayerService.getAvailableJackettIndexers();
            jackettIndexersLoading = false;
            renderJackettIndexers();
            const selectedId = await showJackettIndexerAddDialog(availableIndexers);
            if (!selectedId) {
                setJackettIndexersStatus(`Настроено: ${jackettIndexersState.indexers.length}; активно в поиске: ${jackettIndexersState.enabledIds.length}.`);
                return;
            }

            const selected = availableIndexers.find(indexer => indexer.id === selectedId) || { id: selectedId, name: selectedId };
            jackettIndexerMutation = true;
            setJackettIndexersStatus(`Добавляем ${selected.name} в Jackett…`);
            renderJackettIndexers();
            jackettIndexersState = await mediaPlayerService.addJackettIndexer(selected.id);
            setJackettIndexersStatus(`${selected.name} добавлен в Jackett и включён в поиск.`);
        } catch (error) {
            setJackettIndexersStatus(error?.message || 'Не удалось добавить индексер Jackett.', 'error');
        } finally {
            jackettIndexersLoading = false;
            jackettIndexerMutation = false;
            renderJackettIndexers();
        }
    }

    function createJackettDialogBase(className, titleText, descriptionText) {
        const overlay = document.createElement('div');
        overlay.className = `unsaved-dialog-overlay ${className}`;
        const dialog = document.createElement('div');
        dialog.className = 'unsaved-dialog jackett-indexer-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-label', titleText);
        const title = document.createElement('h3');
        title.textContent = titleText;
        const description = document.createElement('p');
        description.textContent = descriptionText;
        dialog.append(title, description);
        overlay.appendChild(dialog);
        return { overlay, dialog };
    }

    function showJackettIndexerAddDialog(indexers) {
        return new Promise(resolve => {
            const { overlay, dialog } = createJackettDialogBase(
                'jackett-add-dialog-overlay',
                'Добавить индексер Jackett',
                'Найдите источник в каталоге Jackett и добавьте его. Секретные параметры настраиваются после добавления.'
            );
            const searchInput = document.createElement('input');
            searchInput.className = 'jackett-available-search';
            searchInput.type = 'search';
            searchInput.placeholder = 'Поиск по имени, ID или описанию…';
            searchInput.setAttribute('aria-label', 'Поиск доступных индексеров');
            const catalog = Array.isArray(indexers) ? indexers : [];
            const normalizeFilterValue = value => String(value || '').trim().toLocaleLowerCase();
            const collectFilterValues = getValue => {
                const values = new Map();
                catalog.forEach(indexer => {
                    const rawValue = getValue(indexer);
                    const source = Array.isArray(rawValue) ? rawValue : [rawValue];
                    source.forEach(value => {
                        const text = String(value || '').trim();
                        const key = normalizeFilterValue(text);
                        if (key && !values.has(key)) values.set(key, text);
                    });
                });
                return [...values.values()].sort((left, right) => left.localeCompare(right, 'ru'));
            };
            const createFilter = (labelText, allText, values, className) => {
                const wrapper = document.createElement('label');
                wrapper.className = 'jackett-available-filter';
                const label = document.createElement('span');
                label.textContent = labelText;
                const select = document.createElement('select');
                select.className = className;
                select.setAttribute('aria-label', labelText);
                const allOption = document.createElement('option');
                allOption.value = '';
                allOption.textContent = allText;
                select.appendChild(allOption);
                values.forEach(value => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = value;
                    select.appendChild(option);
                });
                wrapper.append(label, select);
                return select;
            };
            const filters = document.createElement('div');
            filters.className = 'jackett-available-filters';
            const languageFilter = createFilter(
                'Язык',
                'Все языки',
                collectFilterValues(indexer => indexer.language),
                'jackett-available-language-filter'
            );
            const accessTypeFilter = createFilter(
                'Доступ',
                'Любой доступ',
                collectFilterValues(indexer => indexer.type),
                'jackett-available-type-filter'
            );
            const categoryFilter = createFilter(
                'Категория',
                'Все категории',
                collectFilterValues(indexer => indexer.categories),
                'jackett-available-category-filter'
            );
            filters.append(languageFilter.parentElement, accessTypeFilter.parentElement, categoryFilter.parentElement);
            const summary = document.createElement('div');
            summary.className = 'jackett-available-summary';
            summary.setAttribute('aria-live', 'polite');
            const list = document.createElement('div');
            list.className = 'jackett-available-list';
            list.setAttribute('role', 'list');
            dialog.append(searchInput, filters, summary, list);

            const actions = document.createElement('div');
            actions.className = 'unsaved-dialog-actions';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn btn-secondary';
            cancelBtn.type = 'button';
            cancelBtn.textContent = 'Отмена';
            actions.appendChild(cancelBtn);
            dialog.appendChild(actions);

            let settled = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKeyDown);
                overlay.classList.remove('active');
                setTimeout(() => overlay.remove(), 200);
                resolve(value);
            };
            const onKeyDown = event => {
                if (event.key === 'Escape') finish(null);
            };
            const render = () => {
                const query = searchInput.value.trim().toLocaleLowerCase();
                const language = normalizeFilterValue(languageFilter.value);
                const accessType = normalizeFilterValue(accessTypeFilter.value);
                const category = normalizeFilterValue(categoryFilter.value);
                const filtered = catalog.filter(indexer => [
                    indexer.name,
                    indexer.id,
                    indexer.description,
                    indexer.site,
                    indexer.language,
                    indexer.type,
                    ...(Array.isArray(indexer.categories) ? indexer.categories : [])
                ].join(' ').toLocaleLowerCase().includes(query)
                    && (!language || normalizeFilterValue(indexer.language) === language)
                    && (!accessType || normalizeFilterValue(indexer.type) === accessType)
                    && (!category || (Array.isArray(indexer.categories) && indexer.categories.some(
                        item => normalizeFilterValue(item) === category
                    ))));
                summary.textContent = `Показано: ${filtered.length} из ${catalog.length}`;
                list.replaceChildren();
                if (!filtered.length) {
                    const empty = document.createElement('div');
                    empty.className = 'jackett-available-empty';
                    empty.textContent = catalog.length ? 'По вашему запросу ничего не найдено.' : 'Доступных не настроенных индексеров нет.';
                    list.appendChild(empty);
                    return;
                }
                filtered.forEach(indexer => {
                    const row = document.createElement('div');
                    row.className = 'jackett-available-row';
                    row.setAttribute('role', 'listitem');
                    const info = document.createElement('div');
                    info.className = 'jackett-available-info';
                    const name = document.createElement('span');
                    name.className = 'jackett-available-name';
                    name.textContent = indexer.name;
                    const meta = document.createElement('span');
                    meta.className = 'jackett-available-meta';
                    meta.textContent = [indexer.language, indexer.type, indexer.id, ...(indexer.categories || [])]
                        .filter(Boolean)
                        .join(' · ');
                    info.append(name, meta);
                    if (indexer.description) {
                        const description = document.createElement('span');
                        description.className = 'jackett-available-description';
                        description.textContent = indexer.description;
                        info.appendChild(description);
                    }
                    const addBtn = document.createElement('button');
                    addBtn.className = 'btn btn-primary';
                    addBtn.type = 'button';
                    addBtn.textContent = 'Добавить';
                    addBtn.addEventListener('click', () => finish(indexer.id));
                    row.append(info, addBtn);
                    list.appendChild(row);
                });
            };
            const onSearch = () => render();
            searchInput.addEventListener('input', onSearch);
            languageFilter.addEventListener('change', onSearch);
            accessTypeFilter.addEventListener('change', onSearch);
            categoryFilter.addEventListener('change', onSearch);
            cancelBtn.addEventListener('click', () => finish(null));
            overlay.addEventListener('click', event => {
                if (event.target === overlay) finish(null);
            });
            document.addEventListener('keydown', onKeyDown);
            document.body.appendChild(overlay);
            render();
            requestAnimationFrame(() => {
                overlay.classList.add('active');
                searchInput.focus();
            });
        });
    }

    function showJackettDeleteDialog(indexer) {
        return new Promise(resolve => {
            const { overlay, dialog } = createJackettDialogBase(
                'jackett-delete-dialog-overlay',
                `Удалить ${indexer.name}?`,
                'Jackett удалит индексер из настроенных источников. Скачанные файлы MediaPlayer не затрагиваются.'
            );
            const actions = document.createElement('div');
            actions.className = 'unsaved-dialog-actions';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn btn-secondary';
            cancelBtn.type = 'button';
            cancelBtn.textContent = 'Отмена';
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-danger';
            deleteBtn.type = 'button';
            deleteBtn.textContent = 'Удалить';

            let settled = false;
            const finish = confirmed => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKeyDown);
                overlay.classList.remove('active');
                setTimeout(() => overlay.remove(), 200);
                resolve(confirmed);
            };
            const onKeyDown = event => {
                if (event.key === 'Escape') finish(false);
            };
            cancelBtn.addEventListener('click', () => finish(false));
            deleteBtn.addEventListener('click', () => finish(true));
            overlay.addEventListener('click', event => {
                if (event.target === overlay) finish(false);
            });
            document.addEventListener('keydown', onKeyDown);
            actions.append(cancelBtn, deleteBtn);
            dialog.appendChild(actions);
            document.body.appendChild(overlay);
            requestAnimationFrame(() => {
                overlay.classList.add('active');
                cancelBtn.focus();
            });
        });
    }

    function showJackettIndexerConfigDialog(indexer, config) {
        return new Promise(resolve => {
            const { overlay, dialog } = createJackettDialogBase(
                'jackett-config-dialog-overlay',
                `Настройка ${indexer.name}`,
                'Параметры сохраняются в Jackett. Секретные поля не показываются; оставьте их пустыми, чтобы сохранить текущее значение.'
            );
            const form = document.createElement('form');
            form.className = 'jackett-config-form';
            const fields = Array.isArray(config?.fields) ? config.fields : [];
            fields.forEach(field => {
                const type = String(field.type || 'inputstring').toLowerCase();
                if (['displayinfo', 'displaytitle', 'info'].includes(type)) {
                    const info = document.createElement('p');
                    info.className = 'jackett-config-info';
                    info.textContent = field.name || 'Информация';
                    form.appendChild(info);
                    return;
                }

                const wrapper = document.createElement('label');
                wrapper.className = 'jackett-config-field';
                const label = document.createElement('span');
                label.className = 'jackett-config-label';
                label.textContent = field.name || field.id;
                wrapper.appendChild(label);

                let input;
                if (type === 'inputbool') {
                    input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = field.value === true;
                    wrapper.classList.add('jackett-config-field--checkbox');
                } else if (type === 'inputselect') {
                    input = document.createElement('select');
                    Object.entries(field.options || {}).forEach(([value, optionLabel]) => {
                        const option = document.createElement('option');
                        option.value = value;
                        option.textContent = optionLabel;
                        input.appendChild(option);
                    });
                    if (field.value !== null && field.value !== undefined) input.value = String(field.value);
                } else {
                    input = document.createElement('input');
                    input.type = field.sensitive || type.includes('password') ? 'password' : 'text';
                    input.value = field.sensitive ? '' : field.value === null || field.value === undefined ? '' : String(field.value);
                    if (field.sensitive && field.hasValue) input.placeholder = 'Сохранено — оставьте пустым без изменений';
                    if (field.pattern) input.pattern = field.pattern;
                    if (field.separator) input.dataset.separator = field.separator;
                }
                input.dataset.jackettConfigField = field.id;
                input.dataset.jackettConfigType = type;
                input.dataset.jackettConfigSensitive = field.sensitive === true ? 'true' : 'false';
                wrapper.appendChild(input);
                form.appendChild(wrapper);
            });

            const actions = document.createElement('div');
            actions.className = 'unsaved-dialog-actions';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn btn-secondary';
            cancelBtn.type = 'button';
            cancelBtn.textContent = 'Отмена';
            const saveBtn = document.createElement('button');
            saveBtn.className = 'btn btn-primary';
            saveBtn.type = 'submit';
            saveBtn.textContent = 'Сохранить';
            actions.append(cancelBtn, saveBtn);
            form.appendChild(actions);
            dialog.appendChild(form);

            let settled = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKeyDown);
                overlay.classList.remove('active');
                setTimeout(() => overlay.remove(), 200);
                resolve(value);
            };
            const onKeyDown = event => {
                if (event.key === 'Escape') finish(null);
            };
            cancelBtn.addEventListener('click', () => finish(null));
            form.addEventListener('submit', event => {
                event.preventDefault();
                const updates = Array.from(form.querySelectorAll('[data-jackett-config-field]')).map(input => ({
                    id: input.dataset.jackettConfigField,
                    value: input.type === 'checkbox' ? input.checked : input.value
                }));
                finish(updates);
            });
            overlay.addEventListener('click', event => {
                if (event.target === overlay) finish(null);
            });
            document.addEventListener('keydown', onKeyDown);
            document.body.appendChild(overlay);
            requestAnimationFrame(() => {
                overlay.classList.add('active');
                (form.querySelector('input, select') || cancelBtn).focus();
            });
        });
    }

    async function chooseMediaPlayerFolder() {
        if (!mediaPlayerService || !currentState.mediaPlayerEnabled) return;
        try {
            const result = await mediaPlayerService.selectInstallFolder();
            currentState.mediaPlayerSetup = normalizeMediaPlayerSetup({
                ...currentState.mediaPlayerSetup,
                enabled: true,
                status: 'path_required',
                installPath: result.installPath,
                checks: [],
                errorCode: '',
                errorMessage: ''
            }, true);
            mediaPlayerRetentionLoaded = false;
            renderMediaPlayerSetup();
            if (mediaplayerRetentionStatus) {
                mediaplayerRetentionStatus.textContent = 'Проверьте установку MediaPlayer, чтобы открыть настройки торрентов.';
            }
            updateDirtyState();
        } catch (error) {
            currentState.mediaPlayerSetup = normalizeMediaPlayerSetup({
                ...currentState.mediaPlayerSetup,
                enabled: true,
                status: 'error',
                errorCode: error?.code || 'setup_verification_failed',
                errorMessage: error?.message || 'Не удалось выбрать папку MediaPlayer.'
            }, true);
            renderMediaPlayerSetup();
            updateDirtyState();
        }
    }

    async function verifyMediaPlayerInstallation() {
        const installPath = currentState.mediaPlayerSetup?.installPath;
        if (!mediaPlayerService || !currentState.mediaPlayerEnabled || !installPath) return;
        currentState.mediaPlayerSetup = normalizeMediaPlayerSetup({
            ...currentState.mediaPlayerSetup,
            enabled: true,
            status: 'verifying',
            errorCode: '',
            errorMessage: ''
        }, true);
        renderMediaPlayerSetup();
        try {
            const setup = await mediaPlayerService.verifyInstallation(installPath);
            currentState.mediaPlayerSetup = normalizeMediaPlayerSetup(setup, true);
            mediaPlayerRetentionLoaded = false;
            renderMediaPlayerSetup();
            if (currentState.mediaPlayerSetup.status === 'ready') {
                await loadMediaPlayerSettings();
            } else if (mediaplayerRetentionStatus) {
                mediaplayerRetentionStatus.textContent = 'Настройки торрентов заблокированы до успешной проверки.';
            }
            updateDirtyState();
        } catch (error) {
            currentState.mediaPlayerSetup = normalizeMediaPlayerSetup({
                ...currentState.mediaPlayerSetup,
                enabled: true,
                status: 'error',
                errorCode: error?.code || 'setup_verification_failed',
                errorMessage: error?.message || 'Не удалось проверить MediaPlayer.'
            }, true);
            mediaPlayerRetentionLoaded = false;
            renderMediaPlayerSetup();
            if (mediaplayerRetentionStatus) {
                mediaplayerRetentionStatus.textContent = 'Настройки торрентов заблокированы до успешной проверки.';
            }
            updateDirtyState();
        }
    }

    /**
     * Update UI from currentState
     */
    function updateUIFromState() {
        // Set radio button for display mode
        for (const radio of displayModeRadios) {
            if (radio.value === currentState.displayMode) {
                radio.checked = true;
                break;
            }
        }
        
        // Set language dropdown
        updateDropdownUI(currentState.language);

        // Anime radio toggle
        if (animeRadioToggle) {
            animeRadioToggle.checked = currentState.showAnimeRadio;
            if (radioSourceGroup) {
                radioSourceGroup.style.display = currentState.showAnimeRadio ? 'block' : 'none';
            }
            const radioBlock = document.getElementById('navigationLeft');
            if (radioBlock) {
                radioBlock.style.display = currentState.showAnimeRadio ? 'flex' : 'none';
            }
        }

        // Set source radio
        if (radioSourceRadios) {
            for (const radio of radioSourceRadios) {
                radio.checked = (radio.value === currentState.animeRadioSource);
            }
        }

        // Mini games toggle
        if (gamesToggle) {
            gamesToggle.checked = currentState.showGames;
            const gamesBtn = document.getElementById('navGamesBtn');
            if (gamesBtn) {
                gamesBtn.style.display = currentState.showGames ? 'inline-flex' : 'none';
            }
        }

        if (extensionAutoUpdateToggle) {
            extensionAutoUpdateToggle.checked = currentState.autoUpdateEnabled === true;
        }

        if (torrentRetentionSelect && mediaPlayerRetentionLoaded) {
            torrentRetentionSelect.value = String(currentState.torrentRetentionDays);
        }

        renderMediaPlayerSetup();
        updateSubtitleAppearanceUI();
    }

    /**
     * Load current settings from storage
     */
    async function loadSettings() {
        try {
            mediaPlayerRetentionLoaded = false;
            if (torrentRetentionSelect) torrentRetentionSelect.disabled = true;
            const result = await chrome.storage.local.get([
                'displayMode',
                'language',
                'showAnimeRadio',
                'animeRadioSource',
                'showGames',
                'mediaPlayerEnabled',
                MEDIA_PLAYER_SETUP_STORAGE_KEY,
                SUBTITLE_APPEARANCE_STORAGE_KEY
            ]);
            const updateStateResponse = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: 'GET_UPDATE_STATE' }, (response) => {
                    resolve(chrome.runtime.lastError ? null : response);
                });
            });
            const mediaPlayerEnabled = result.mediaPlayerEnabled === true;
            const storedMediaPlayerSetup = normalizeMediaPlayerSetup(
                result[MEDIA_PLAYER_SETUP_STORAGE_KEY],
                mediaPlayerEnabled
            );
            
            initialState = {
                displayMode: result.displayMode || DEFAULT_SETTINGS.displayMode,
                language: result.language || i18n.currentLocale || DEFAULT_SETTINGS.language,
                showAnimeRadio: result.showAnimeRadio ?? false,
                animeRadioSource: result.animeRadioSource || 'anison',
                showGames: result.showGames ?? false,
                torrentRetentionDays: initialState.torrentRetentionDays ?? 7,
                mediaPlayerEnabled,
                mediaPlayerSetup: storedMediaPlayerSetup,
                subtitleAppearance: normalizeSubtitleAppearance(result[SUBTITLE_APPEARANCE_STORAGE_KEY]),
                autoUpdateEnabled: updateStateResponse?.settings?.autoUpdateEnabled !== false
            };
            
            currentState = {
                ...initialState,
                subtitleAppearance: { ...initialState.subtitleAppearance }
            };
            
            updateUIFromState();
            
            // Ensure language matches initial
            if (i18n.currentLocale !== initialState.language) {
                await i18n.setLanguage(initialState.language);
                i18n.translatePage();
            }
            
            updateDirtyState();
            await loadMediaPlayerSettings();
            renderExtensionUpdateState(updateStateResponse?.state);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    function renderExtensionUpdateState(state) {
        if (!state) return;

        const status = String(state.status || 'idle');
        const version = state.availableVersion || state.currentVersion || '';
        const setupRequired = state.configured === false || status === 'setup_required';
        const pending = ['installing', 'queued', 'downloading', 'replacing'].includes(status);

        if (extensionUpdateStatus) {
            extensionUpdateStatus.textContent = setupRequired
                ? i18n.get('settings.updates.setup_required')
                : pending || status === 'awaiting_confirmation'
                    ? i18n.get('settings.updates.install_latest_started').replace('{version}', version)
                    : state.availableVersion
                        ? i18n.get('settings.updates.available').replace('{version}', state.availableVersion)
                        : i18n.get('settings.updates.automatic');
        }
        if (extensionUpdateSetupBtn) extensionUpdateSetupBtn.hidden = !setupRequired;

        if (!extensionUpdateInstallStatus) return;
        if (status === 'check_failed') {
            extensionUpdateInstallStatus.hidden = false;
            const russian = String(i18n.currentLocale || navigator.language).startsWith('ru');
            extensionUpdateInstallStatus.textContent = russian
                ? 'Не удалось проверить обновления. Проверьте интернет и доступ к GitHub, затем повторите попытку. Подробности — в журнале обновлений.'
                : 'Could not check for updates. Check your connection and access to GitHub, then retry. Export diagnostics for details.';
        } else if (status === 'awaiting_confirmation') {
            extensionUpdateInstallStatus.hidden = false;
            extensionUpdateInstallStatus.textContent = i18n.get('settings.updates.install_latest_restarting')
                .replace('{version}', version);
        } else if (pending) {
            extensionUpdateInstallStatus.hidden = false;
            extensionUpdateInstallStatus.textContent = i18n.get('settings.updates.install_latest_started')
                .replace('{version}', version);
        } else if (status === 'failed') {
            extensionUpdateInstallStatus.hidden = false;
            extensionUpdateInstallStatus.textContent = i18n.get('settings.updates.install_latest_failed');
        } else if (status === 'succeeded') {
            extensionUpdateInstallStatus.hidden = false;
            extensionUpdateInstallStatus.textContent = i18n.get('settings.updates.install_latest_succeeded')
                .replace('{version}', version);
        } else if (status === 'up_to_date') {
            extensionUpdateInstallStatus.hidden = false;
            extensionUpdateInstallStatus.textContent = i18n.get('settings.updates.install_latest_up_to_date');
        }
    }

    if (chrome.storage?.onChanged?.addListener) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            const updateChange = changes[EXTENSION_UPDATE_STATE_STORAGE_KEY];
            if (updateChange?.newValue) renderExtensionUpdateState(updateChange.newValue);
        });
    }

    async function loadMediaPlayerSettings() {
        if (!currentState.mediaPlayerEnabled) {
            mediaPlayerRetentionLoaded = false;
            if (mediaplayerRetentionStatus) mediaplayerRetentionStatus.textContent = 'Включите MediaPlayer и завершите проверку установки.';
            await loadJackettIndexers();
            renderMediaPlayerSetup();
            return;
        }
        if (currentState.mediaPlayerSetup.status !== 'ready') {
            mediaPlayerRetentionLoaded = false;
            if (torrentRetentionSelect) torrentRetentionSelect.disabled = true;
            if (mediaplayerRetentionStatus) mediaplayerRetentionStatus.textContent = 'Настройки торрентов заблокированы до успешной проверки.';
            await loadJackettIndexers();
            renderMediaPlayerSetup();
            return;
        }
        if (!mediaPlayerService || !torrentRetentionSelect) {
            if (mediaplayerRetentionStatus) mediaplayerRetentionStatus.textContent = 'MediaPlayer недоступен на этой странице.';
            return;
        }
        if (mediaplayerRetentionStatus) mediaplayerRetentionStatus.textContent = 'Подключение к MediaPlayer…';
        try {
            const runtimeSetup = await mediaPlayerService.getRuntimeReadiness();
            currentState.mediaPlayerSetup = normalizeMediaPlayerSetup(runtimeSetup, true);
            initialState.mediaPlayerSetup = normalizeMediaPlayerSetup(runtimeSetup, true);
            if (currentState.mediaPlayerSetup.status !== 'ready') {
                mediaPlayerRetentionLoaded = false;
                if (torrentRetentionSelect) torrentRetentionSelect.disabled = true;
                renderMediaPlayerSetup();
                if (mediaplayerRetentionStatus) {
                    mediaplayerRetentionStatus.textContent = 'Настройки торрентов заблокированы до успешной проверки.';
                }
                await loadJackettIndexers();
                return;
            }
            const settings = await mediaPlayerService.getSettings();
            const days = Number(settings.torrentRetentionDays);
            currentState.torrentRetentionDays = days;
            initialState.torrentRetentionDays = days;
            mediaPlayerRetentionLoaded = true;
            torrentRetentionSelect.disabled = false;
            updateUIFromState();
            await loadJackettIndexers();

            updateDirtyState();
            if (mediaplayerRetentionStatus) mediaplayerRetentionStatus.textContent = 'Изменения применяются после нажатия «Сохранить».';
        } catch (error) {
            mediaPlayerRetentionLoaded = false;
            torrentRetentionSelect.disabled = true;
            currentState.mediaPlayerSetup = normalizeMediaPlayerSetup({
                ...currentState.mediaPlayerSetup,
                enabled: true,
                status: 'error',
                errorCode: error?.code || 'connection_failed',
                errorMessage: error?.message || 'Проверьте запуск службы.'
            }, true);
            renderMediaPlayerSetup();
            await loadJackettIndexers();
            if (mediaplayerRetentionStatus) mediaplayerRetentionStatus.textContent = `MediaPlayer недоступен: ${error?.message || 'проверьте запуск службы.'}`;
            updateDirtyState();
        }
    }

    /**
     * Save settings to storage
     */
    async function saveSettings() {
        try {
            const retentionChanged = mediaPlayerRetentionLoaded
                && currentState.torrentRetentionDays !== initialState.torrentRetentionDays;
            if (retentionChanged) {
                if (!mediaPlayerService) throw new Error('MediaPlayer недоступен.');
                const settings = await mediaPlayerService.updateSettings({
                    torrentRetentionDays: currentState.torrentRetentionDays
                });
                currentState.torrentRetentionDays = settings.torrentRetentionDays;
                if (mediaplayerRetentionStatus) mediaplayerRetentionStatus.textContent = 'Срок хранения обновлён.';
            }
            const subtitleAppearance = normalizeSubtitleAppearance(currentState.subtitleAppearance);
            currentState.subtitleAppearance = subtitleAppearance;
            if (!currentState.mediaPlayerEnabled) {
                currentState.mediaPlayerSetup = createDefaultMediaPlayerSetup();
            } else {
                currentState.mediaPlayerSetup = normalizeMediaPlayerSetup(currentState.mediaPlayerSetup, true);
            }
            if (mediaPlayerService) {
                await mediaPlayerService.writeSetupState(currentState.mediaPlayerSetup);
            }
            await chrome.storage.local.set({
                displayMode: currentState.displayMode,
                language: currentState.language,
                showAnimeRadio: currentState.showAnimeRadio,
                animeRadioSource: currentState.animeRadioSource,
                showGames: currentState.showGames,
                mediaPlayerEnabled: currentState.mediaPlayerEnabled,
                [MEDIA_PLAYER_SETUP_STORAGE_KEY]: currentState.mediaPlayerSetup,
                [SUBTITLE_APPEARANCE_STORAGE_KEY]: subtitleAppearance
            });

            await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: 'SET_AUTO_UPDATE',
                    enabled: currentState.autoUpdateEnabled === true
                }, (response) => {
                    if (chrome.runtime.lastError || !response?.success) {
                        reject(new Error(response?.error || chrome.runtime.lastError?.message || 'Не удалось сохранить обновления'));
                        return;
                    }
                    resolve(response);
                });
            });

            // If language changed, ensure i18n saves it globally depending on how it's structured, but i18n.setLanguage was already called on preview.
            // Notify background script
            chrome.runtime.sendMessage({
                type: 'SETTINGS_UPDATED',
                settings: { 
                    displayMode: currentState.displayMode,
                    language: currentState.language,
                    showAnimeRadio: currentState.showAnimeRadio,
                    animeRadioSource: currentState.animeRadioSource,
                    showGames: currentState.showGames,
                    mediaPlayerEnabled: currentState.mediaPlayerEnabled,
                    autoUpdateEnabled: currentState.autoUpdateEnabled,
                    mediaPlayerSetup: currentState.mediaPlayerSetup,
                    [SUBTITLE_APPEARANCE_STORAGE_KEY]: subtitleAppearance
                }
            });

            initialState = {
                ...currentState,
                subtitleAppearance: { ...subtitleAppearance }
            };
            updateDirtyState();

            showToast(i18n.get('settings.saved'));
        } catch (error) {
            console.error('Failed to save settings:', error);
            showToast(i18n.get('settings.save_failed'), true);
        }
    }

    /**
     * Reset settings to defaults
     */
    async function resetSettings() {
        if (confirm(i18n.get('settings.reset_confirm'))) {
            try {
                if (mediaPlayerRetentionLoaded && currentState.torrentRetentionDays !== 7) {
                    if (!mediaPlayerService) throw new Error('MediaPlayer недоступен.');
                    await mediaPlayerService.updateSettings({ torrentRetentionDays: 7 });
                }
                const defaultSubtitleAppearance = createDefaultSubtitleAppearance();
                const defaultMediaPlayerSetup = createDefaultMediaPlayerSetup();
                if (mediaPlayerService) await mediaPlayerService.writeSetupState(defaultMediaPlayerSetup);
                await chrome.storage.local.set({
                    ...DEFAULT_SETTINGS,
                    [MEDIA_PLAYER_SETUP_STORAGE_KEY]: defaultMediaPlayerSetup,
                    [SUBTITLE_APPEARANCE_STORAGE_KEY]: defaultSubtitleAppearance
                });
                await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ type: 'SET_AUTO_UPDATE', enabled: true }, () => resolve());
                });
                
                // Reload UI
                await loadSettings();
                
                // Notify background
                chrome.runtime.sendMessage({
                    type: 'SETTINGS_UPDATED',
                    settings: {
                        ...DEFAULT_SETTINGS,
                        mediaPlayerSetup: defaultMediaPlayerSetup,
                        [SUBTITLE_APPEARANCE_STORAGE_KEY]: defaultSubtitleAppearance
                    }
                });

                showToast(i18n.get('settings.reset_done'));
            } catch (error) {
                console.error('Failed to reset settings:', error);
            }
        }
    }

    /**
     * Show a toast message
     */
    function showToast(message, isError = false) {
        let toast = document.querySelector('.toast');
        if (toast) {
            toast.remove();
        }

        toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        if (isError) {
            toast.style.backgroundColor = 'var(--filter-exclude-border)';
        }
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(100%)';
            setTimeout(() => {
                if (toast.parentNode) {
                    document.body.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    // Input Event Listeners for tracking dirty state
    for (const radio of displayModeRadios) {
        radio.addEventListener('change', (e) => {
            currentState.displayMode = e.target.value;
            updateDirtyState();
        });
    }

    if (animeRadioToggle) {
        animeRadioToggle.addEventListener('change', (e) => {
            currentState.showAnimeRadio = e.target.checked;
            updateDirtyState();
            
            // Immediately update visually 
            if (radioSourceGroup) {
                radioSourceGroup.style.display = e.target.checked ? 'block' : 'none';
            }
            const radioBlock = document.getElementById('navigationLeft');
            if (radioBlock) {
                radioBlock.style.display = e.target.checked ? 'flex' : 'none';
            }
        });
    }

    if (gamesToggle) {
        gamesToggle.addEventListener('change', (e) => {
            currentState.showGames = e.target.checked;
            updateDirtyState();
            
            const gamesBtn = document.getElementById('navGamesBtn');
            if (gamesBtn) {
                gamesBtn.style.display = e.target.checked ? 'inline-flex' : 'none';
            }
        });
    }

    for (const radio of radioSourceRadios) {
        radio.addEventListener('change', (e) => {
            currentState.animeRadioSource = e.target.value;
            updateDirtyState();
        });
    }

    if (extensionAutoUpdateToggle) {
        extensionAutoUpdateToggle.addEventListener('change', (event) => {
            currentState.autoUpdateEnabled = event.target.checked;
            if (extensionUpdateStatus) {
                extensionUpdateStatus.textContent = event.target.checked
                    ? i18n.get('settings.updates.enabled')
                    : i18n.get('settings.updates.disabled');
            }
            updateDirtyState();
        });
    }

    if (extensionUpdateSetupBtn) {
        extensionUpdateSetupBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: UpdateService.getSetupUrl() }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Could not open updater setup:', chrome.runtime.lastError.message);
                }
            });
        });
    }

    function sendUpdateRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response?.success) {
                    reject(new Error(response?.error || 'UPDATE_REQUEST_FAILED'));
                    return;
                }
                resolve(response);
            });
        });
    }

    if (extensionUpdateInstallBtn) {
        extensionUpdateInstallBtn.addEventListener('click', async () => {
            extensionUpdateInstallBtn.disabled = true;
            if (extensionUpdateInstallStatus) {
                extensionUpdateInstallStatus.hidden = false;
                extensionUpdateInstallStatus.textContent = i18n.get('settings.updates.install_latest_preparing');
            }

            try {
                const checkResponse = await sendUpdateRuntimeMessage({
                    type: 'CHECK_FOR_UPDATES',
                    force: true,
                    interactive: true
                });
                let result = checkResponse.state;
                if (result.status === 'waiting_for_safe_moment' && result.requiresConfirmation) {
                    const confirmed = await showPlaybackUpdateDialog(result.availableVersion);
                    if (!confirmed) {
                        extensionUpdateInstallStatus.textContent = i18n.get('settings.updates.install_latest_declined');
                        return;
                    }
                    result = (await sendUpdateRuntimeMessage({
                        type: 'APPLY_UPDATE',
                        automatic: false,
                        allowPlayback: true
                    })).state;
                } else if (['available', 'available_manual', 'deferred'].includes(result.status)) {
                    result = (await sendUpdateRuntimeMessage({
                        type: 'APPLY_UPDATE',
                        automatic: false,
                        allowPlayback: false
                    })).state;
                }

                if (extensionUpdateInstallStatus) {
                    const messageKey = result.status === 'up_to_date'
                        ? 'settings.updates.install_latest_up_to_date'
                        : result.status === 'setup_required'
                            ? 'settings.updates.setup_required'
                        : result.status === 'waiting_for_safe_moment'
                                ? 'settings.updates.install_latest_not_safe'
                                : result.errorCode === 'RECOVERY_REQUIRED'
                                    ? 'settings.updates.install_latest_recovery_required'
                                : result.status === 'installing' || result.status === 'queued'
                                    ? 'settings.updates.install_latest_started'
                                    : 'settings.updates.install_latest_failed';
                    extensionUpdateInstallStatus.textContent = i18n
                        .get(messageKey)
                        .replace('{version}', result.availableVersion || '');
                }
                renderExtensionUpdateState(result);
            } catch (error) {
                console.error('Could not install latest extension release:', error);
                if (extensionUpdateInstallStatus) {
                    const messageKey = error?.message === 'SETUP_REQUIRED'
                        ? 'settings.updates.setup_required'
                        : error?.message === 'UPDATE_NOT_SAFE'
                            ? 'settings.updates.install_latest_not_safe'
                            : error?.message === 'UPDATE_IN_PROGRESS'
                                ? 'settings.updates.install_latest_in_progress'
                            : error?.message === 'RECOVERY_REQUIRED'
                                ? 'settings.updates.install_latest_recovery_required'
                            : 'settings.updates.install_latest_failed';
                    extensionUpdateInstallStatus.textContent = i18n.get(messageKey);
                }
            } finally {
                extensionUpdateInstallBtn.disabled = false;
            }
        });
    }

    if (subtitleFontSizePercentInput) {
        subtitleFontSizePercentInput.addEventListener('input', (event) => {
            updateSubtitleAppearance('fontSizePercent', event.target.value);
        });
    }

    if (subtitleColorInput) {
        subtitleColorInput.addEventListener('input', (event) => {
            updateSubtitleAppearance('color', event.target.value);
        });
    }

    if (subtitlePositionSelect) {
        subtitlePositionSelect.addEventListener('change', (event) => {
            updateSubtitleAppearance('position', event.target.value);
        });
    }

    if (subtitleOffsetPercentInput) {
        subtitleOffsetPercentInput.addEventListener('input', (event) => {
            updateSubtitleAppearance('offsetPercent', event.target.value);
        });
    }

    if (subtitleBackgroundOpacityInput) {
        subtitleBackgroundOpacityInput.addEventListener('input', (event) => {
            updateSubtitleAppearance('backgroundOpacity', event.target.value);
        });
    }

    if (subtitleTextShadowSelect) {
        subtitleTextShadowSelect.addEventListener('change', (event) => {
            updateSubtitleAppearance('textShadow', event.target.value);
        });
    }

    if (subtitleAppearanceResetBtn) {
        subtitleAppearanceResetBtn.addEventListener('click', () => {
            currentState.subtitleAppearance = createDefaultSubtitleAppearance();
            updateSubtitleAppearanceUI();
            updateDirtyState();
        });
    }

    if (mediaPlayerEnabledToggle) {
        mediaPlayerEnabledToggle.addEventListener('change', (event) => {
            const enabled = event.target.checked;
            currentState.mediaPlayerEnabled = enabled;
            currentState.mediaPlayerSetup = normalizeMediaPlayerSetup({
                ...currentState.mediaPlayerSetup,
                enabled,
                status: enabled ? 'path_required' : 'disabled',
                errorCode: '',
                errorMessage: ''
            }, enabled);
            mediaPlayerRetentionLoaded = false;
            renderMediaPlayerSetup();
            if (mediaplayerRetentionStatus) {
                mediaplayerRetentionStatus.textContent = enabled
                    ? 'Выберите папку и завершите проверку MediaPlayer.'
                    : 'Включите MediaPlayer и завершите проверку установки.';
            }
            void loadJackettIndexers();
            updateDirtyState();
        });
    }

    if (mediaPlayerChooseFolderBtn) {
        mediaPlayerChooseFolderBtn.addEventListener('click', chooseMediaPlayerFolder);
    }

    if (mediaPlayerVerifyBtn) {
        mediaPlayerVerifyBtn.addEventListener('click', verifyMediaPlayerInstallation);
    }

    if (jackettIndexersRefreshBtn) {
        jackettIndexersRefreshBtn.addEventListener('click', () => {
            void loadJackettIndexers();
        });
    }

    if (jackettIndexerAddBtn) {
        jackettIndexerAddBtn.addEventListener('click', () => {
            void addJackettIndexer();
        });
    }

    if (jackettIndexersList) {
        jackettIndexersList.addEventListener('change', (event) => {
            if (event.target?.matches?.('[data-indexer-id]')) {
                void updateJackettIndexerSelection();
            }
        });
        jackettIndexersList.addEventListener('click', (event) => {
            const configureButton = event.target?.closest?.('[data-indexer-configure-id]');
            if (configureButton) {
                void configureJackettIndexer(configureButton.dataset.indexerConfigureId);
                return;
            }
            const deleteButton = event.target?.closest?.('[data-indexer-delete-id]');
            if (deleteButton) {
                void deleteJackettIndexer(deleteButton.dataset.indexerDeleteId);
                return;
            }
            const testButton = event.target?.closest?.('[data-indexer-test-id]');
            if (testButton) void testJackettIndexer(testButton.dataset.indexerTestId);
        });
    }

    if (torrentRetentionSelect) {
        torrentRetentionSelect.addEventListener('change', (event) => {
            currentState.torrentRetentionDays = Number(event.target.value);
            if (mediaplayerRetentionStatus) mediaplayerRetentionStatus.textContent = 'Есть несохранённое изменение.';
            updateDirtyState();
        });
    }

    // Event Listeners for buttons
    saveBtn.addEventListener('mousedown', saveSettings);
    resetBtn.addEventListener('mousedown', resetSettings);

    // Initialize
    loadSettings();
    
    // ThemeService is the single owner of persisted theme state and DOM classes.
    if (window.ThemeService) {
        window.ThemeService.applyCurrentTheme({
            persist: false,
            syncChromeStorage: false
        });
    }

    /**
     * Custom Unsaved Dialog UI
     */
    function showUnsavedDialog(onCancel, onSave) {
        const overlay = document.createElement('div');
        overlay.className = 'unsaved-dialog-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'unsaved-dialog';

        const title = document.createElement('h3');
        title.textContent = 'Внимание';

        const text = document.createElement('p');
        text.textContent = 'У вас есть несохранённые изменения. Что хотите сделать?';

        const actions = document.createElement('div');
        actions.className = 'unsaved-dialog-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.textContent = 'Отменить изменения';
        cancelBtn.addEventListener('mousedown', async () => {
            overlay.classList.remove('active');
            setTimeout(() => document.body.removeChild(overlay), 200);
            
            // Revert state
            currentState = { ...initialState };
            updateUIFromState();
            updateDirtyState();
            if (i18n.currentLocale !== initialState.language) {
                await i18n.setLanguage(initialState.language);
                i18n.translatePage();
            }
            
            if (onCancel) onCancel();
        });

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.style.backgroundColor = '#22c55e';
        confirmBtn.textContent = 'Сохранить';
        confirmBtn.addEventListener('mousedown', async () => {
            overlay.classList.remove('active');
            setTimeout(() => document.body.removeChild(overlay), 200);
            
            await saveSettings();
            
            if (onSave) onSave();
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        dialog.appendChild(title);
        dialog.appendChild(text);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);

        document.body.appendChild(overlay);

        // Trigger animation
        requestAnimationFrame(() => {
            overlay.classList.add('active');
        });
    }

    function showPlaybackUpdateDialog(version) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'unsaved-dialog-overlay update-playback-dialog-overlay';

            const dialog = document.createElement('div');
            dialog.className = 'unsaved-dialog';
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');
            dialog.setAttribute('aria-label', i18n.get('settings.updates.playback_warning_title'));

            const title = document.createElement('h3');
            title.textContent = i18n.get('settings.updates.playback_warning_title');

            const text = document.createElement('p');
            text.textContent = i18n.get('settings.updates.playback_warning')
                .replace('{version}', version || 'latest');

            const actions = document.createElement('div');
            actions.className = 'unsaved-dialog-actions';

            const declineBtn = document.createElement('button');
            declineBtn.className = 'btn btn-secondary';
            declineBtn.type = 'button';
            declineBtn.textContent = i18n.get('settings.updates.playback_decline_button');

            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'btn btn-primary';
            confirmBtn.type = 'button';
            confirmBtn.textContent = i18n.get('settings.updates.playback_confirm_button');

            let settled = false;
            const finish = (confirmed) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKeyDown);
                overlay.classList.remove('active');
                setTimeout(() => overlay.remove(), 200);
                resolve(confirmed);
            };
            const onKeyDown = (event) => {
                if (event.key === 'Escape') finish(false);
            };

            declineBtn.addEventListener('click', () => finish(false));
            confirmBtn.addEventListener('click', () => finish(true));
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) finish(false);
            });
            document.addEventListener('keydown', onKeyDown);

            actions.appendChild(declineBtn);
            actions.appendChild(confirmBtn);
            dialog.appendChild(title);
            dialog.appendChild(text);
            dialog.appendChild(actions);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            requestAnimationFrame(() => {
                overlay.classList.add('active');
                confirmBtn.focus();
            });
        });
    }

    /**
     * Intercept Navigation
     */
    function setupNavigationInterception() {
        // 1. Intercept all global link clicks
        const linkInterceptor = (e) => {
            const link = e.target.closest('a');
            if (link && link.href && !link.href.startsWith('javascript:') && !link.href.includes('#')) {
                if (updateDirtyState()) {
                    e.preventDefault();
                    e.stopPropagation();
                    const targetHref = link.href;
                    showUnsavedDialog(
                        () => { window.location.href = targetHref; },
                        async () => { window.location.href = targetHref; }
                    );
                }
            }
        };
        
        document.addEventListener('mousedown', linkInterceptor, true);
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            // If we caught it in mousedown, just prevent click on dirty forms to avoid double triggers
            if (link && link.href && !link.href.startsWith('javascript:') && !link.href.includes('#')) {
                if (updateDirtyState()) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        }, true);

        // 2. Intercept Navigation.js methods securely via prototype
        if (typeof Navigation !== 'undefined') {
            const origNavigate = Navigation.prototype.navigateToPage;
            if (origNavigate && !Navigation.prototype._navigateIntercepted) {
                Navigation.prototype._navigateIntercepted = true;
                Navigation.prototype.navigateToPage = function(page) {
                    if (updateDirtyState() && page !== 'settings') {
                        showUnsavedDialog(
                            () => { origNavigate.call(this, page); },
                            async () => { origNavigate.call(this, page); }
                        );
                        return;
                    }
                    origNavigate.call(this, page);
                };
            }

            const origNavSearch = Navigation.prototype.navigateToSearchWithQuery;
            if (origNavSearch && !Navigation.prototype._searchIntercepted) {
                Navigation.prototype._searchIntercepted = true;
                Navigation.prototype.navigateToSearchWithQuery = function(query) {
                    if (updateDirtyState()) {
                        showUnsavedDialog(
                            () => { origNavSearch.call(this, query); },
                            async () => { origNavSearch.call(this, query); }
                        );
                        return;
                    }
                    origNavSearch.call(this, query);
                };
            }
        }

        // 3. Intercept chrome.tabs.create (e.g. from Navigation.js or anywhere else)
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            const origTabsCreate = chrome.tabs.create;
            if (!chrome.tabs.create._intercepted) {
                chrome.tabs.create = function(createProperties, callback) {
                    if (updateDirtyState() && typeof createProperties.url === 'string' && !createProperties.url.includes('settings.html')) {
                        showUnsavedDialog(
                            () => { origTabsCreate.call(chrome.tabs, createProperties, callback); },
                            async () => { origTabsCreate.call(chrome.tabs, createProperties, callback); }
                        );
                        return;
                    }
                    origTabsCreate.call(chrome.tabs, createProperties, callback);
                };
                chrome.tabs.create._intercepted = true;
            }
        }

        // 4. Intercept history.pushState
        if (typeof history !== 'undefined' && history.pushState) {
            const origPushState = history.pushState;
            if (!history.pushState._intercepted) {
                history.pushState = function(state, unused, url) {
                    if (updateDirtyState()) {
                        showUnsavedDialog(
                            () => { origPushState.call(history, state, unused, url); },
                            async () => { origPushState.call(history, state, unused, url); }
                        );
                        return;
                    }
                    origPushState.call(history, state, unused, url);
                };
                history.pushState._intercepted = true;
            }
        }
    }

});
