/**
 * Settings Page Logic
 */
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Navigation
    const nav = new Navigation('navbar');
    nav.render();

    // Elements
    const displayModeRadios = document.getElementsByName('displayMode');
    const saveBtn = document.getElementById('saveBtn');
    const resetBtn = document.getElementById('resetBtn');

    // Default Settings
    const DEFAULT_SETTINGS = {
        displayMode: 'popup'
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

            // Notify background script to update popup behavior immediately
            chrome.runtime.sendMessage({
                type: 'SETTINGS_UPDATED',
                settings: { displayMode: selectedMode }
            });

            showToast('Settings saved successfully!');
        } catch (error) {
            console.error('Failed to save settings:', error);
            showToast('Failed to save settings', true);
        }
    }

    /**
     * Reset settings to defaults
     */
    async function resetSettings() {
        if (confirm('Are you sure you want to reset all settings to default?')) {
            try {
                await chrome.storage.local.set(DEFAULT_SETTINGS);
                
                // Reload UI
                loadSettings();
                
                // Notify background
                chrome.runtime.sendMessage({
                    type: 'SETTINGS_UPDATED',
                    settings: DEFAULT_SETTINGS
                });

                showToast('Settings reset to defaults');
            } catch (error) {
                console.error('Failed to reset settings:', error);
            }
        }
    }

    /**
     * Show a toast message
     */
    function showToast(message, isError = false) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        if (isError) {
            toast.style.backgroundColor = 'var(--danger)';
        }
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(100%)';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
    }

    // Event Listeners
    saveBtn.addEventListener('click', saveSettings);
    resetBtn.addEventListener('click', resetSettings);

    // Initialize
    loadSettings();
    
    // Initialize Theme (reusing common logic if available or just simple check)
    // The Navigation component usually handles auth state, but we might want to ensure theme is applied
    const theme = localStorage.getItem('movieExtensionTheme') || 'dark';
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    }
});
