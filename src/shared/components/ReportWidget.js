class ReportWidget {
    constructor() {
        this.container = null;
        this.drawer = null;
        this.overlay = null;
        this.triggerBtn = null;
        this.textarea = null;
        this.fileInput = null;
        this.submitBtn = null;
        this.previewContainer = null;
        this.previewImg = null;
        this.charCounter = null;
        this.messageBox = null;
        this.spinner = null;
        this.btnText = null;
        this.reportBody = null;

        this.selectedFile = null;
        this.MAX_CHARS = 5000;
        this.MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

        this.init();
    }

    init() {
        // Prevent multiple initializations
        if (document.getElementById('reportWidgetContainer')) return;

        this.render();
        this.bindElements();
        this.attachEventListeners();
    }

    render() {
        const html = `
            <!-- Overlay -->
            <div id="reportWidgetOverlay" class="report-overlay"></div>

            <!-- Widget Button -->
            <div id="reportWidgetContainer" class="report-widget-container">
                <button id="reportWidgetBtn" class="report-widget-btn" title="Сообщить об ошибке / Предложить улучшение">
                    ›
                </button>
            </div>

            <!-- Drawer -->
            <div id="reportWidgetDrawer" class="report-widget-drawer">
                <div class="report-drawer-header">
                    <h3>Сообщить об ошибке / Предложить улучшение</h3>
                    <button id="reportWidgetCloseBtn" class="report-close-btn" title="Закрыть">✕</button>
                </div>
                
                <div class="report-drawer-body">
                    <div id="reportWidgetMessage" class="report-message"></div>

                    <div>
                        <textarea id="reportWidgetText" placeholder="Опишите проблему или предложение..." maxlength="5000"></textarea>
                        <div class="report-char-counter"><span id="reportWidgetCharCount">0</span> / 5000</div>
                    </div>

                    <div class="report-file-upload">
                        <label for="reportWidgetFile" class="report-file-label">
                            <span id="reportWidgetFileLabelText">📎 Прикрепить скриншот (до 5 МБ)</span>
                        </label>
                        <input type="file" id="reportWidgetFile" class="report-file-input" accept="image/jpeg, image/png, image/webp">
                        
                        <div id="reportWidgetPreviewContainer" class="report-preview-container">
                            <img id="reportWidgetPreviewImg" class="report-preview-image" src="" alt="Preview">
                            <button id="reportWidgetRemovePhotoBtn" class="report-remove-photo-btn" title="Удалить фото">✕</button>
                        </div>
                    </div>
                </div>

                <div class="report-drawer-footer">
                    <button id="reportWidgetSubmitBtn" class="report-submit-btn" disabled>
                        <div id="reportWidgetSpinner" class="report-spinner"></div>
                        <span id="reportWidgetBtnText">Отправить</span>
                    </button>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
    }

    bindElements() {
        this.container = document.getElementById('reportWidgetContainer');
        this.drawer = document.getElementById('reportWidgetDrawer');
        this.overlay = document.getElementById('reportWidgetOverlay');
        this.triggerBtn = document.getElementById('reportWidgetBtn');
        this.closeBtn = document.getElementById('reportWidgetCloseBtn');
        this.textarea = document.getElementById('reportWidgetText');
        this.charCounter = document.getElementById('reportWidgetCharCount');
        this.fileInput = document.getElementById('reportWidgetFile');
        this.previewContainer = document.getElementById('reportWidgetPreviewContainer');
        this.previewImg = document.getElementById('reportWidgetPreviewImg');
        this.removePhotoBtn = document.getElementById('reportWidgetRemovePhotoBtn');
        this.submitBtn = document.getElementById('reportWidgetSubmitBtn');
        this.messageBox = document.getElementById('reportWidgetMessage');
        this.spinner = document.getElementById('reportWidgetSpinner');
        this.btnText = document.getElementById('reportWidgetBtnText');
        this.fileLabelText = document.getElementById('reportWidgetFileLabelText');
        this.reportBody = this.drawer.querySelector('.report-drawer-body');
    }

    attachEventListeners() {
        // Toggle Drawer
        this.triggerBtn.addEventListener('mousedown', () => this.openDrawer());
        this.closeBtn.addEventListener('mousedown', () => this.closeDrawer());
        this.overlay.addEventListener('mousedown', () => this.closeDrawer());

        // Text input handling
        this.textarea.addEventListener('input', () => {
            const count = this.textarea.value.length;
            this.charCounter.textContent = count;
            this.validateForm();
        });

        // File input handling
        this.fileInput.addEventListener('change', (e) => this.handleFileSelection(e));
        
        // Drag and Drop
        if (this.reportBody) {
            this.reportBody.addEventListener('dragover', (e) => {
                e.preventDefault(); // Necessary to allow dropping
                this.reportBody.classList.add('drag-over');
            });
            
            this.reportBody.addEventListener('dragleave', (e) => {
                e.preventDefault();
                // Avoid flickering
                if (!this.reportBody.contains(e.relatedTarget)) {
                    this.reportBody.classList.remove('drag-over');
                }
            });
            
            this.reportBody.addEventListener('drop', (e) => {
                e.preventDefault();
                this.reportBody.classList.remove('drag-over');
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    this.processFile(e.dataTransfer.files[0]);
                }
            });
        }
        
        // Clipboard Paste Handling
        this.drawer.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const file = items[i].getAsFile();
                    if (file) {
                        e.preventDefault(); // Prevent default text pasting behavior when pasting image into textarea
                        this.processFile(file);
                        break; // Process only the first image
                    }
                }
            }
        });

        // Remove photo handling
        this.removePhotoBtn.addEventListener('mousedown', () => this.removePhoto());

        // Form submission
        this.submitBtn.addEventListener('mousedown', () => this.submitReport());
    }

    openDrawer() {
        this.drawer.classList.add('open');
        this.overlay.classList.add('visible');
        this.triggerBtn.style.display = 'none';
        this.clearMessage();
        
        // Устанавливаем фокус на текстовое поле
        setTimeout(() => {
            this.textarea.focus();
        }, 100);
    }

    closeDrawer() {
        this.drawer.classList.remove('open');
        this.overlay.classList.remove('visible');
        setTimeout(() => {
            this.triggerBtn.style.display = 'flex';
        }, 300); // match transition duration
    }

    handleFileSelection(e) {
        const file = e.target.files[0];
        if (!file) {
            this.removePhoto();
            return;
        }

        this.processFile(file);
        // Reset file input value to allow selecting the same file again if removed
        this.fileInput.value = '';
    }

    processFile(file) {
        // Validate size
        if (file.size > this.MAX_FILE_SIZE) {
            this.showMessage('Файл слишком большой. Максимальный размер 5 МБ.', 'error');
            this.removePhoto();
            return;
        }

        // Validate type
        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!validTypes.includes(file.type)) {
            this.showMessage('Недопустимый формат файла. Поддерживаются JPG, PNG, GIF, WEBP.', 'error');
            this.removePhoto();
            return;
        }

        this.selectedFile = file;
        this.clearMessage();

        const reader = new FileReader();
        reader.onload = (event) => {
            this.previewImg.src = event.target.result;
            this.previewContainer.style.display = 'block';
            this.fileLabelText.textContent = 'Заменить скриншот';
        };
        reader.readAsDataURL(file);

        this.validateForm();
    }

    removePhoto() {
        this.selectedFile = null;
        this.fileInput.value = '';
        this.previewImg.src = '';
        this.previewContainer.style.display = 'none';
        this.fileLabelText.textContent = '📎 Прикрепить скриншот (до 5 МБ)';
        this.validateForm();
    }

    validateForm() {
        const text = this.textarea.value.trim();
        const hasFile = !!this.selectedFile;
        // Button is enabled if there is text or a file
        this.submitBtn.disabled = !(text.length > 0 || hasFile);
    }

    showMessage(text, type) {
        this.messageBox.textContent = text;
        this.messageBox.className = `report-message ${type}`;
        this.messageBox.style.display = 'block';
    }

    clearMessage() {
        this.messageBox.style.display = 'none';
        this.messageBox.textContent = '';
        this.messageBox.className = 'report-message';
    }

    setLoading(isLoading) {
        this.submitBtn.disabled = isLoading;
        this.textarea.disabled = isLoading;
        this.fileInput.disabled = isLoading;
        
        if (isLoading) {
            this.spinner.style.display = 'block';
            this.btnText.textContent = 'Отправка...';
        } else {
            this.spinner.style.display = 'none';
            this.btnText.textContent = 'Отправить';
            this.validateForm();
        }
    }

    resetForm() {
        this.textarea.value = '';
        this.charCounter.textContent = '0';
        this.removePhoto();
        this.clearMessage();
    }

    async submitReport() {
        const text = this.textarea.value.trim();
        const file = this.selectedFile;

        if (!text && !file) return;

        try {
            this.setLoading(true);
            this.clearMessage();

            if (typeof window.firebaseManager === 'undefined') {
                throw new Error('FirebaseManager не инициализирован. Попробуйте позже.');
            }

            const pageUrl = window.location.href;
            await window.firebaseManager.addReport(text, file, pageUrl);

            this.showMessage('Ваше сообщение успешно отправлено!', 'success');
            
            // Auto close after success
            setTimeout(() => {
                this.closeDrawer();
                this.resetForm();
                this.setLoading(false);
            }, 2000);

        } catch (error) {
            console.error('Ошибка при отправке репорта:', error);
            this.showMessage(`Ошибка: ${error.message}`, 'error');
            this.setLoading(false);
        }
    }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.reportWidget = new ReportWidget();
    });
} else {
    window.reportWidget = new ReportWidget();
}
