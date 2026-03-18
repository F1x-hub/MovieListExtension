import { i18n } from '../../shared/i18n/I18n.js';

let initialState = {
    displayMode: 'popup',
    language: 'en',
    showAnimeRadio: false,
    animeRadioSource: 'anison'
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
    const dropdownHeader = languageDropdown.querySelector('.dropdown-header');
    const dropdownItems = languageDropdown.querySelectorAll('.dropdown-item');
    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');
    
    // Anime Radio Elements
    const animeRadioToggle = document.getElementById('animeRadioToggle');
    const radioSourceGroup = document.getElementById('radioSourceGroup');
    const radioSourceRadios = document.getElementsByName('radioSource');
    
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
            currentState.animeRadioSource !== initialState.animeRadioSource;
            
        if (isDirty) {
            saveBtn.style.backgroundColor = '#22c55e';
            saveBtn.style.color = '#ffffff';
        } else {
            saveBtn.style.backgroundColor = '';
            saveBtn.style.color = '';
        }
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
        animeRadioSource: 'anison'
    };

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
    }

    /**
     * Load current settings from storage
     */
    async function loadSettings() {
        try {
            const result = await chrome.storage.local.get(['displayMode', 'language', 'showAnimeRadio', 'animeRadioSource']);
            
            initialState = {
                displayMode: result.displayMode || DEFAULT_SETTINGS.displayMode,
                language: result.language || i18n.currentLocale || DEFAULT_SETTINGS.language,
                showAnimeRadio: result.showAnimeRadio ?? false,
                animeRadioSource: result.animeRadioSource || 'anison'
            };
            
            currentState = { ...initialState };
            
            updateUIFromState();
            
            // Ensure language matches initial
            if (i18n.currentLocale !== initialState.language) {
                await i18n.setLanguage(initialState.language);
                i18n.translatePage();
            }
            
            updateDirtyState();
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    /**
     * Save settings to storage
     */
    async function saveSettings() {
        try {
            await chrome.storage.local.set({
                displayMode: currentState.displayMode,
                language: currentState.language,
                showAnimeRadio: currentState.showAnimeRadio,
                animeRadioSource: currentState.animeRadioSource
            });

            // If language changed, ensure i18n saves it globally depending on how it's structured, but i18n.setLanguage was already called on preview.
            // Notify background script
            chrome.runtime.sendMessage({
                type: 'SETTINGS_UPDATED',
                settings: { 
                    displayMode: currentState.displayMode,
                    language: currentState.language,
                    showAnimeRadio: currentState.showAnimeRadio,
                    animeRadioSource: currentState.animeRadioSource
                }
            });

            initialState = { ...currentState };
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
                await chrome.storage.local.set(DEFAULT_SETTINGS);
                
                // Reload UI
                await loadSettings();
                
                // Notify background
                chrome.runtime.sendMessage({
                    type: 'SETTINGS_UPDATED',
                    settings: DEFAULT_SETTINGS
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

    for (const radio of radioSourceRadios) {
        radio.addEventListener('change', (e) => {
            currentState.animeRadioSource = e.target.value;
            updateDirtyState();
        });
    }

    // Event Listeners for buttons
    saveBtn.addEventListener('mousedown', saveSettings);
    resetBtn.addEventListener('mousedown', resetSettings);

    // Initialize
    loadSettings();
    
    // Theme setup
    const theme = localStorage.getItem('movieExtensionTheme') || 'dark';
    if (theme === 'light') {
        document.body.classList.add('light-theme');
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
        cancelBtn.className = 'btn btn-ghost';
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
