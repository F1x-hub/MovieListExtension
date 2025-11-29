// Конфигурация (должна совпадать с background.js)
const EXTENSION_PATH = 'd:\\Programing\\JS\\Projects\\MovieListExstension';

// Загрузка данных
async function loadUpdateInfo() {
    const result = await chrome.storage.local.get('updateZipPath');
    const zipPath = result.updateZipPath || '%USERPROFILE%\\Downloads\\extension_update.zip';
    
    const zipPathElement = document.getElementById('zipPath');
    if (zipPathElement) {
        zipPathElement.textContent = zipPath;
    }

    // Формирование команды
    // Путь к скрипту Update-Extension.ps1 предполагается внутри папки расширения
    const scriptPath = `${EXTENSION_PATH}\\Update-Extension.ps1`;
    
    const command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -ZipPath "${zipPath}" -ExtensionPath "${EXTENSION_PATH}"`;
    
    const commandBlockElement = document.getElementById('commandBlock');
    if (commandBlockElement) {
        commandBlockElement.textContent = command;
    }
    
    return command;
}

let currentCommand = '';

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    loadUpdateInfo().then(cmd => {
        currentCommand = cmd;
    });

    // Копирование в буфер обмена
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            if (currentCommand) {
                await navigator.clipboard.writeText(currentCommand);
                const msg = document.getElementById('copyMsg');
                if (msg) {
                    msg.style.display = 'inline';
                    setTimeout(() => {
                        msg.style.display = 'none';
                    }, 2000);
                }
            }
        });
    }
});
