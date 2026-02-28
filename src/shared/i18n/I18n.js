import { locales } from './locales.js';

class I18n {
    constructor() {
        this.currentLocale = 'en'; // Default
        this.locales = locales;
    }

    async init() {
        try {
            const result = await chrome.storage.sync.get(['language']);
            if (result.language && this.locales[result.language]) {
                this.currentLocale = result.language;
            }
        } catch (error) {
            console.error('Failed to load language settings:', error);
        }
    }

    get(key) {
        const keys = key.split('.');
        let value = this.locales[this.currentLocale];
        
        for (const k of keys) {
            value = value?.[k];
        }
        
        // Fallback to English if key missing in current locale
        if (!value && this.currentLocale !== 'en') {
             let fallback = this.locales['en'];
             for (const k of keys) {
                fallback = fallback?.[k];
            }
            return fallback || key;
        }

        return value || key;
    }

    async setLanguage(lang) {
        if (this.locales[lang]) {
            this.currentLocale = lang;
            await chrome.storage.sync.set({ language: lang });
            this.translatePage();
            return true;
        }
        return false;
    }

    translatePage() {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(element => {
            let key = element.getAttribute('data-i18n');
            let targetAttr = null;

            if (key.startsWith('[')) {
                const match = key.match(/^\[(.*?)\](.*)/);
                if (match) {
                    targetAttr = match[1];
                    key = match[2];
                }
            }

            const translation = this.get(key);
            
            if (targetAttr) {
                element.setAttribute(targetAttr, translation);
            } else if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                if (element.hasAttribute('placeholder')) {
                    element.placeholder = translation;
                } else {
                    element.value = translation;
                }
            } else if (element.tagName === 'OPTION') {
                element.textContent = translation;
            } else {
                element.textContent = translation;
            }
        });
    }

    formatRelativeTime(timestamp) {
        if (!timestamp) return '';
        
        const date = timestamp.toDate ? timestamp.toDate() : (timestamp.seconds ? new Date(timestamp.seconds * 1000) : new Date(timestamp));
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);

        const isRu = this.currentLocale === 'ru';
        
        if (diffInSeconds < 60) {
            return isRu ? 'Только что' : 'Just now';
        } else if (diffInSeconds < 3600) {
            const minutes = Math.floor(diffInSeconds / 60);
            if (isRu) return `${minutes} мин. назад`;
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else if (diffInSeconds < 86400) {
            const hours = Math.floor(diffInSeconds / 3600);
            if (isRu) return `${hours} ч. назад`;
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else {
            return date.toLocaleDateString(isRu ? 'ru-RU' : 'en-US');
        }
    }
}

export const i18n = new I18n();

// Expose to window for non-module scripts
if (typeof window !== 'undefined') {
    window.i18n = i18n;
}
