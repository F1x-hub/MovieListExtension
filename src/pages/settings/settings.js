import { i18n } from '../../shared/i18n/I18n.js';

/**
 * Settings Page Logic
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize I18n
    await i18n.init();
    i18n.translatePage();
    // Initialize Navigation
    const nav = new Navigation('navbar');
    nav.render();

    // Elements
    const displayModeRadios = document.getElementsByName('displayMode');
    const languageDropdown = document.getElementById('languageDropdown');
    const dropdownHeader = languageDropdown.querySelector('.dropdown-header');
    const dropdownItems = languageDropdown.querySelectorAll('.dropdown-item');
    
    // Sidebar Navigation Elements
    const sidebarLinks = document.querySelectorAll('.sidebar-link');
    const settingsPanes = document.querySelectorAll('.settings-pane');

    /**
     * Handle Sidebar Navigation
     */
    sidebarLinks.forEach(link => {
        link.addEventListener('click', () => {
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
     * Handle Language Change
     */
    async function handleLanguageChange(lang) {
        try {
            // Update UI immediately
            updateDropdownUI(lang);
            
            // Close dropdown
            languageDropdown.classList.remove('active');

            // Save and apply if changed
            if (lang !== i18n.currentLocale) {
                await i18n.setLanguage(lang);
                
                await chrome.storage.local.set({ language: lang });

                // Redraw page text
                i18n.translatePage();

                // Notify background
                chrome.runtime.sendMessage({
                    type: 'SETTINGS_UPDATED',
                    settings: { 
                        displayMode: DEFAULT_SETTINGS.displayMode,
                        language: lang
                    }
                });
            }
        } catch (error) {
            console.error('Failed to change language:', error);
            showToast(i18n.get('settings.save_failed'), true);
        }
    }

    // Dropdown Event Listeners
    dropdownHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        languageDropdown.classList.toggle('active');
    });

    document.addEventListener('click', () => {
        languageDropdown.classList.remove('active');
    });

    dropdownItems.forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const lang = item.dataset.value;
            await handleLanguageChange(lang);
        });
    });

    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');

    // Default Settings
    const DEFAULT_SETTINGS = {
        displayMode: 'popup',
        language: 'en'
    };

    /**
     * Load current settings from storage
     */
    async function loadSettings() {
        try {
            const result = await chrome.storage.local.get(['displayMode']);
            const currentMode = result.displayMode || DEFAULT_SETTINGS.displayMode;
            
            // Set radio button
            for (const radio of displayModeRadios) {
                if (radio.value === currentMode) {
                    radio.checked = true;
                    break;
                }
            }
            
            // Set language dropdown
            const currentLang = result.language || i18n.currentLocale || DEFAULT_SETTINGS.language;
            updateDropdownUI(currentLang);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    /**
     * Save settings to storage
     */
    async function saveSettings() {
        let selectedMode = DEFAULT_SETTINGS.displayMode;
        
        for (const radio of displayModeRadios) {
            if (radio.checked) {
                selectedMode = radio.value;
                break;
            }
        }

        try {
            await chrome.storage.local.set({
                displayMode: selectedMode
            });

            // Notify background script
            chrome.runtime.sendMessage({
                type: 'SETTINGS_UPDATED',
                settings: { 
                    displayMode: selectedMode,
                    language: i18n.currentLocale
                }
            });

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
                loadSettings();
                
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

    // Event Listeners
    saveBtn.addEventListener('click', saveSettings);
    resetBtn.addEventListener('click', resetSettings);

    // Initialize
    loadSettings();
    
    // Theme setup
    const theme = localStorage.getItem('movieExtensionTheme') || 'dark';
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    }

    // Anime Radio Toggle + Source Selector
    const animeRadioToggle = document.getElementById('animeRadioToggle');
    const radioSourceGroup = document.getElementById('radioSourceGroup');
    const radioSourceRadios = document.getElementsByName('radioSource');

    const updateSourceGroupVisibility = (show) => {
        if (radioSourceGroup) {
            radioSourceGroup.style.display = show ? 'block' : 'none';
        }
    };

    if (animeRadioToggle) {
        // Load saved state
        chrome.storage.local.get(['showAnimeRadio', 'animeRadioSource'], (data) => {
            const isEnabled = data.showAnimeRadio ?? false;
            animeRadioToggle.checked = isEnabled;
            updateSourceGroupVisibility(isEnabled);

            // Set source radio
            const source = data.animeRadioSource || 'anison';
            for (const radio of radioSourceRadios) {
                radio.checked = (radio.value === source);
            }
        });

        // Save on toggle change & apply immediately
        animeRadioToggle.addEventListener('change', (e) => {
            chrome.storage.local.set({ showAnimeRadio: e.target.checked });
            updateSourceGroupVisibility(e.target.checked);
            const radioBlock = document.getElementById('navigationLeft');
            if (radioBlock) {
                radioBlock.style.display = e.target.checked ? 'flex' : 'none';
            }
        });
    }

    // Source selector save
    for (const radio of radioSourceRadios) {
        radio.addEventListener('change', (e) => {
            chrome.storage.local.set({ animeRadioSource: e.target.value });
        });
    }
});
