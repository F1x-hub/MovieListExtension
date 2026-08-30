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
        this.lastFocusedElement = null;

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
            <div id="reportWidgetOverlay" class="report-overlay" aria-hidden="true"></div>

            <!-- Widget Button -->
            <div id="reportWidgetContainer" class="report-widget-container">
                <button id="reportWidgetBtn" class="report-widget-btn" type="button" title="Сообщить об ошибке / Предложить улучшение" aria-label="Сообщить об ошибке" aria-expanded="false" aria-controls="reportWidgetDrawer">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
            </div>

            <!-- Drawer -->
            <div id="reportWidgetDrawer" class="report-widget-drawer" role="dialog" aria-modal="true" aria-labelledby="reportWidgetTitle" aria-hidden="true" tabindex="-1">
                <div class="report-drawer-header">
                    <h2 id="reportWidgetTitle">Сообщить об ошибке / Предложить улучшение</h2>
                    <button id="reportWidgetCloseBtn" class="report-close-btn" type="button" title="Закрыть" aria-label="Закрыть">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                
                <div class="report-drawer-body">
                    <div id="reportWidgetMessage" class="report-message"></div>

                    <div>
                        <textarea id="reportWidgetText" aria-label="Описание проблемы или предложения" aria-describedby="reportWidgetCharCount" placeholder="Опишите проблему или предложение..." maxlength="5000"></textarea>
                        <div class="report-char-counter" id="reportWidgetCharCount" aria-live="polite"><span>0</span> / 5000</div>
                    </div>

                    <div class="report-file-upload">
                        <label for="reportWidgetFile" class="report-file-label">
                            <span id="reportWidgetFileLabelText">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                Прикрепить скриншот (до 5 МБ)
                            </span>
                        </label>
                        <input type="file" id="reportWidgetFile" class="report-file-input" accept="image/jpeg, image/png, image/webp">
                        
                        <div id="reportWidgetPreviewContainer" class="report-preview-container">
                            <img id="reportWidgetPreviewImg" class="report-preview-image" src="" alt="Preview">
                            <button id="reportWidgetRemovePhotoBtn" class="report-remove-photo-btn" type="button" title="Удалить фото" aria-label="Удалить фото">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="report-drawer-footer">
                    <button id="reportWidgetSubmitBtn" class="report-submit-btn" type="button" disabled>
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
        this.triggerBtn.addEventListener('click', () => this.openDrawer());
        this.closeBtn.addEventListener('click', () => this.closeDrawer());
        this.overlay.addEventListener('click', () => this.closeDrawer());
        this.drawer.addEventListener('keydown', (event) => this.handleDrawerKeydown(event));

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
        this.removePhotoBtn.addEventListener('click', () => this.removePhoto());

        // Form submission
        this.submitBtn.addEventListener('click', () => this.submitReport());
    }

    openDrawer() {
        this.lastFocusedElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : this.triggerBtn;
        this.drawer.classList.add('open');
        this.overlay.classList.add('visible');
        this.drawer.setAttribute('aria-hidden', 'false');
        this.overlay.setAttribute('aria-hidden', 'false');
        this.triggerBtn.setAttribute('aria-expanded', 'true');
        this.triggerBtn.style.display = 'none';
        this.clearMessage();
        
        setTimeout(() => {
            if (this.drawer.classList.contains('open')) {
                this.textarea.focus();
            }
        }, 100);
    }

    closeDrawer() {
        this.drawer.classList.remove('open');
        this.overlay.classList.remove('visible');
        this.drawer.setAttribute('aria-hidden', 'true');
        this.overlay.setAttribute('aria-hidden', 'true');
        this.triggerBtn.setAttribute('aria-expanded', 'false');
        this.triggerBtn.style.display = 'flex';

        const restoreTarget = this.lastFocusedElement instanceof HTMLElement && document.contains(this.lastFocusedElement)
            ? this.lastFocusedElement
            : this.triggerBtn;
        restoreTarget.focus();
        this.lastFocusedElement = null;
    }

    handleDrawerKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            this.closeDrawer();
            return;
        }

        if (event.key !== 'Tab') return;

        const focusable = Array.from(this.drawer.querySelectorAll(
            'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )).filter((element) => element.getClientRects().length > 0);

        if (focusable.length === 0) {
            event.preventDefault();
            this.drawer.focus();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
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
        this.fileLabelText.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg> Прикрепить скриншот (до 5 МБ)';
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
