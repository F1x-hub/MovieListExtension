import { i18n } from '../../shared/i18n/I18n.js';

document.addEventListener('DOMContentLoaded', async () => {
    await i18n.init();
    i18n.translatePage();

    const languageSelect = document.getElementById('languageSelect');
    const statusMessage = document.getElementById('statusMessage');

    // Set current value
    languageSelect.value = i18n.currentLocale;

    languageSelect.addEventListener('change', async (e) => {
        const newLang = e.target.value;
        const success = await i18n.setLanguage(newLang);
        
        if (success) {
            statusMessage.textContent = i18n.get('settings.saved');
            statusMessage.classList.add('success');
            setTimeout(() => {
                statusMessage.classList.remove('success');
            }, 2000);
        }
    });
});
