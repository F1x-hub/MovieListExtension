// Конфигурация
const EXTENSION_PATH = 'd:\\Programing\\JS\\Projects\\MovieListExstension';
const NATIVE_HOST_NAME = 'com.movielist.updater';

// State
let updateZipPath = '';
let updateCommand = '';

// Elements
const elements = {
    zipPath: document.getElementById('zipPath'),
    commandBlock: document.getElementById('commandBlock'),
    autoUpdateBtn: document.getElementById('autoUpdateBtn'),
    showManualBtn: document.getElementById('showManualBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyMsg: document.getElementById('copyMsg'),
    manualInstructions: document.getElementById('manualInstructions'),
    setupInstructions: document.getElementById('setupInstructions'),
    statusSection: document.getElementById('statusSection'),
    autoUpdateStatus: document.getElementById('autoUpdateStatus'),
    backToAutoBtn: document.getElementById('backToAutoBtn'),
    backFromSetupBtn: document.getElementById('backFromSetupBtn'),
    hostPath: document.getElementById('hostPath')
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadUpdateInfo();
    setupEventListeners();
});

async function loadUpdateInfo() {
    const result = await chrome.storage.local.get('updateZipPath');
    updateZipPath = result.updateZipPath || '%USERPROFILE%\\Downloads\\extension_update.zip';
    
    if (elements.zipPath) elements.zipPath.textContent = updateZipPath;
    if (elements.hostPath) elements.hostPath.textContent = `${EXTENSION_PATH}\\native-host`;

    // Generate command for manual update
    const scriptPath = `${EXTENSION_PATH}\\Update-Extension.ps1`;
    updateCommand = `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -ZipPath "${updateZipPath}" -ExtensionPath "${EXTENSION_PATH}"`;
    
    if (elements.commandBlock) elements.commandBlock.textContent = updateCommand;
}

function setupEventListeners() {
    elements.autoUpdateBtn?.addEventListener('click', startAutoUpdate);
    
    elements.showManualBtn?.addEventListener('click', () => {
        elements.statusSection.style.display = 'none';
        elements.manualInstructions.style.display = 'block';
    });
    
    elements.backToAutoBtn?.addEventListener('click', () => {
        elements.manualInstructions.style.display = 'none';
        elements.statusSection.style.display = 'block';
    });
    
    elements.backFromSetupBtn?.addEventListener('click', () => {
        elements.setupInstructions.style.display = 'none';
        elements.statusSection.style.display = 'block';
    });

    elements.copyBtn?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(updateCommand);
        elements.copyMsg.style.display = 'inline';
        setTimeout(() => elements.copyMsg.style.display = 'none', 2000);
    });
}

function updateStatus(msg, type = 'info') {
    const statusEl = elements.autoUpdateStatus;
    statusEl.style.display = 'block';
    statusEl.textContent = msg;
    statusEl.className = `status-msg ${type}`;
    
    if (type === 'loading') {
        elements.autoUpdateBtn.disabled = true;
        elements.autoUpdateBtn.textContent = '⏳ Выполнение...';
    } else {
        elements.autoUpdateBtn.disabled = false;
        elements.autoUpdateBtn.textContent = 'Обновить автоматически';
    }
}

async function startAutoUpdate() {
    updateStatus('Подключение к Native Host...', 'loading');
    
    try {
        // 1. Check if host is installed by sending a ping
        const response = await sendNativeMessage({ action: 'ping' });
        
        if (!response || !response.success) {
            throw new Error('Native Host not responding');
        }
        
        // 2. Send update command
        updateStatus('Запуск скрипта обновления (подтвердите права админа)...', 'loading');
        
        const updateResponse = await sendNativeMessage({
            action: 'update',
            scriptPath: `${EXTENSION_PATH}\\Update-Extension.ps1`,
            zipPath: updateZipPath,
            extensionPath: EXTENSION_PATH
        });
        
        if (updateResponse && updateResponse.success) {
            updateStatus('Обновление успешно! Перезагрузка...', 'success');
            setTimeout(() => {
                chrome.runtime.reload();
            }, 2000);
        } else {
            throw new Error(updateResponse?.error || 'Unknown error during update');
        }
        
    } catch (error) {
        console.error('Auto update failed:', error);
        
        if (error.message.includes('Native Host') || error.message.includes('Access to the specified native messaging host is forbidden')) {
            // Host not installed
            elements.statusSection.style.display = 'none';
            elements.setupInstructions.style.display = 'block';
        } else {
            updateStatus(`Ошибка: ${error.message}`, 'error');
        }
    }
}

function sendNativeMessage(message) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}
