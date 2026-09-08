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
        if (status === 'awaiting_confirmation') {
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
            renderMediaPlayerSetup();
            return;
        }
        if (currentState.mediaPlayerSetup.status !== 'ready') {
            mediaPlayerRetentionLoaded = false;
            if (torrentRetentionSelect) torrentRetentionSelect.disabled = true;
            if (mediaplayerRetentionStatus) mediaplayerRetentionStatus.textContent = 'Настройки торрентов заблокированы до успешной проверки.';
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
                return;
            }
            const settings = await mediaPlayerService.getSettings();
            const days = Number(settings.torrentRetentionDays);
            currentState.torrentRetentionDays = days;
            initialState.torrentRetentionDays = days;
            mediaPlayerRetentionLoaded = true;
            torrentRetentionSelect.disabled = false;
            updateUIFromState();

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
            updateDirtyState();
        });
    }

    if (mediaPlayerChooseFolderBtn) {
        mediaPlayerChooseFolderBtn.addEventListener('click', chooseMediaPlayerFolder);
    }

    if (mediaPlayerVerifyBtn) {
        mediaPlayerVerifyBtn.addEventListener('click', verifyMediaPlayerInstallation);
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
