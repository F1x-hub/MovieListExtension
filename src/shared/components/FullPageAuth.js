/**
 * FullPageAuth Component (Obsidian-Zinc Design System)
 * Reusable full-page authentication component for extension pages.
 * Supports Login, Registration, and Approval-Gate states without popup redirects.
 */

class FullPageAuth {
    /**
     * @param {Object} options
     * @param {HTMLElement|string} [options.container] - Target container element or selector
     * @param {'inline'|'modal'} [options.mode='inline'] - Render mode ('inline' or 'modal' overlay)
     * @param {'login'|'register'|'approval'} [options.initialView='login'] - Initial view to render
     * @param {string} [options.title] - Custom title
     * @param {string} [options.subtitle] - Custom subtitle
     * @param {Function} [options.onAuthSuccess] - Callback when user is successfully authenticated and approved: (user, profile) => void
     * @param {Function} [options.onCancel] - Callback on modal close / cancel: () => void
     * @param {Function} [options.onError] - Callback on auth errors: (error) => void
     * @param {Function} [options.onViewChange] - Callback when view changes: (viewName) => void
     */
    constructor(options = {}) {
        this.options = {
            mode: 'inline',
            initialView: 'login',
            title: null,
            subtitle: null,
            onAuthSuccess: null,
            onCancel: null,
            onError: null,
            onViewChange: null,
            ...options
        };

        this.currentView = this.options.initialView;
        this.approvalState = {
            status: 'pending',
            isNewRegistration: false
        };
        this.isLoading = false;
        this.rootElement = null;
        this.containerElement = null;

        if (this.options.container) {
            this.mount(this.options.container);
        }
    }

    /**
     * Translation helper with fallback
     * @param {string} key
     * @param {string} fallback
     * @returns {string}
     */
    t(key, fallback = '') {
        try {
            if (typeof i18n !== 'undefined' && i18n && typeof i18n.get === 'function') {
                const val = i18n.get(key);
                if (val && val !== key) return val;
            }
        } catch {
            // Ignore i18n resolution failure
        }
        return fallback;
    }

    /**
     * Mounts the component into a container
     * @param {HTMLElement|string} container
     */
    mount(container) {
        if (typeof container === 'string') {
            this.containerElement = document.querySelector(container);
        } else {
            this.containerElement = container;
        }

        if (!this.containerElement) {
            console.warn('[FullPageAuth] Invalid container specified for mount');
            return;
        }

        this.render();
    }

    /**
     * Unmounts the component and cleans up DOM
     */
    unmount() {
        if (this.rootElement && this.rootElement.parentNode) {
            this.rootElement.parentNode.removeChild(this.rootElement);
        }
        this.rootElement = null;
    }

    /**
     * Alias for unmount
     */
    destroy() {
        this.unmount();
    }

    /**
     * Switch current view
     * @param {'login'|'register'|'approval'} view
     * @param {Object} [params]
     */
    switchView(view, params = {}) {
        this.currentView = view;
        if (view === 'approval') {
            this.approvalState = {
                status: params.status || 'pending',
                isNewRegistration: !!params.isNewRegistration
            };
        }
        if (typeof this.options.onViewChange === 'function') {
            this.options.onViewChange(view);
        }
        this.render();
    }

    /**
     * Main render function
     */
    render() {
        if (!this.containerElement) return;

        // Clean previous root
        if (this.rootElement && this.rootElement.parentNode) {
            this.rootElement.parentNode.removeChild(this.rootElement);
        }

        const isModal = this.options.mode === 'modal';
        const wrapper = document.createElement('div');
        wrapper.className = `full-page-auth-container${isModal ? ' full-page-auth--modal' : ''}`;
        this.rootElement = wrapper;

        const card = document.createElement('div');
        card.className = 'full-page-auth-card';

        // Close button if modal
        if (isModal) {
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'full-page-auth-close-btn';
            closeBtn.setAttribute('aria-label', 'Close');
            closeBtn.innerHTML = (typeof Icons !== 'undefined' && Icons.CLOSE) ? Icons.CLOSE : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            closeBtn.addEventListener('click', () => {
                if (typeof this.options.onCancel === 'function') {
                    this.options.onCancel();
                }
                this.unmount();
            });
            card.appendChild(closeBtn);
        }

        // Header
        const header = this.renderHeader();
        card.appendChild(header);

        // Error banner container
        const errorBanner = document.createElement('div');
        errorBanner.className = 'full-page-auth-error-banner';
        errorBanner.id = 'fpaErrorBanner';
        errorBanner.style.display = 'none';
        card.appendChild(errorBanner);

        // View Content
        const contentContainer = document.createElement('div');
        contentContainer.className = 'full-page-auth-body';

        if (this.currentView === 'login') {
            contentContainer.appendChild(this.renderLoginForm());
        } else if (this.currentView === 'register') {
            contentContainer.appendChild(this.renderRegisterForm());
        } else if (this.currentView === 'approval') {
            contentContainer.appendChild(this.renderApprovalState());
        }

        card.appendChild(contentContainer);
        wrapper.appendChild(card);

        // If modal, close on backdrop click
        if (isModal) {
            wrapper.addEventListener('click', (e) => {
                if (e.target === wrapper) {
                    if (typeof this.options.onCancel === 'function') {
                        this.options.onCancel();
                    }
                    this.unmount();
                }
            });
        }

        this.containerElement.appendChild(wrapper);
    }

    /**
     * Render common card header
     */
    renderHeader() {
        const header = document.createElement('div');
        header.className = 'full-page-auth-header';

        const logoWrapper = document.createElement('div');
        logoWrapper.className = 'full-page-auth-logo';
        
        let logoIcon = (typeof Icons !== 'undefined' && Icons.MOVIE_CLAPPER) ? Icons.MOVIE_CLAPPER : null;
        if (logoIcon) {
            logoWrapper.innerHTML = logoIcon;
        } else {
            const logoImg = document.createElement('img');
            logoImg.src = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
                ? chrome.runtime.getURL('src/shared/assets/icons/app/icon48.png')
                : '';
            logoImg.alt = 'Logo';
            logoWrapper.appendChild(logoImg);
        }
        header.appendChild(logoWrapper);

        const title = document.createElement('h2');
        title.className = 'full-page-auth-title';
        title.textContent = this.options.title || this.t('popup.header.title', 'Movie Ratings');
        header.appendChild(title);

        const subtitle = document.createElement('p');
        subtitle.className = 'full-page-auth-subtitle';
        if (this.currentView === 'login') {
            subtitle.textContent = this.options.subtitle || this.t('popup.auth.login_btn', 'Войти в аккаунт');
        } else if (this.currentView === 'register') {
            subtitle.textContent = this.options.subtitle || this.t('popup.auth.create_account', 'Создать новый аккаунт');
        } else {
            subtitle.textContent = this.options.subtitle || this.t('popup.header.not_authenticated', 'Проверка доступа');
        }
        header.appendChild(subtitle);

        return header;
    }

    /**
     * Render Login Form
     */
    renderLoginForm() {
        const frag = document.createDocumentFragment();

        // Google Login Button
        const googleBtn = document.createElement('button');
        googleBtn.type = 'button';
        googleBtn.className = 'full-page-auth-google-btn';
        googleBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>${this.t('popup.auth.google_btn', 'Продолжить с Google')}</span>
        `;
        googleBtn.addEventListener('click', () => this.handleGoogleLogin(googleBtn));
        frag.appendChild(googleBtn);

        // Divider
        const divider = document.createElement('div');
        divider.className = 'full-page-auth-divider';
        divider.innerHTML = `<span class="full-page-auth-divider-text">${this.t('popup.auth.or', 'или')}</span>`;
        frag.appendChild(divider);

        // Form
        const form = document.createElement('form');
        form.className = 'full-page-auth-form';
        form.noValidate = true;

        // Email Group
        const emailGroup = document.createElement('div');
        emailGroup.className = 'full-page-auth-form-group';
        emailGroup.innerHTML = `
            <label class="full-page-auth-label" for="fpaLoginEmail">${this.t('popup.auth.email_label', 'Электронная почта')}</label>
            <div class="full-page-auth-input-wrapper">
                <input type="email" id="fpaLoginEmail" class="full-page-auth-input" placeholder="${this.t('popup.auth.email_placeholder', 'Ваш email')}" required autocomplete="email">
            </div>
            <div class="full-page-auth-field-error" id="fpaLoginEmailError" style="display:none;"></div>
        `;
        form.appendChild(emailGroup);

        // Password Group
        const passGroup = document.createElement('div');
        passGroup.className = 'full-page-auth-form-group';
        passGroup.innerHTML = `
            <label class="full-page-auth-label" for="fpaLoginPassword">${this.t('popup.auth.password_label', 'Пароль')}</label>
            <div class="full-page-auth-input-wrapper">
                <input type="password" id="fpaLoginPassword" class="full-page-auth-input has-toggle" placeholder="${this.t('popup.auth.password_placeholder', 'Ваш пароль')}" required autocomplete="current-password">
                <button type="button" class="full-page-auth-password-toggle" aria-label="Toggle password visibility">
                    ${(typeof Icons !== 'undefined' && Icons.EYE) ? Icons.EYE : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'}
                </button>
            </div>
            <div class="full-page-auth-field-error" id="fpaLoginPassError" style="display:none;"></div>
        `;
        
        // Password toggle listener
        const toggleBtn = passGroup.querySelector('.full-page-auth-password-toggle');
        const passInput = passGroup.querySelector('#fpaLoginPassword');
        toggleBtn.addEventListener('click', () => {
            const isPass = passInput.type === 'password';
            passInput.type = isPass ? 'text' : 'password';
            toggleBtn.innerHTML = isPass
                ? ((typeof Icons !== 'undefined' && Icons.EYE_OFF) ? Icons.EYE_OFF : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>')
                : ((typeof Icons !== 'undefined' && Icons.EYE) ? Icons.EYE : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>');
        });
        form.appendChild(passGroup);

        // Submit Button
        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.className = 'full-page-auth-submit-btn';
        submitBtn.id = 'fpaLoginSubmitBtn';
        submitBtn.innerHTML = `<span class="fpa-btn-text">${this.t('popup.auth.login_btn', 'Войти')}</span>`;
        form.appendChild(submitBtn);

        form.addEventListener('submit', (e) => this.handleEmailLogin(e, form, submitBtn));
        frag.appendChild(form);

        // Footer / Switch to Register
        const footer = document.createElement('div');
        footer.className = 'full-page-auth-footer';
        footer.innerHTML = `
            <span>${this.t('popup.auth.no_account', 'Нет аккаунта?')}</span>
            <button type="button" class="full-page-auth-switch-link" id="fpaGoToRegisterBtn">${this.t('popup.auth.register_btn', 'Регистрация')}</button>
        `;
        footer.querySelector('#fpaGoToRegisterBtn').addEventListener('click', () => {
            this.switchView('register');
        });
        frag.appendChild(footer);

        return frag;
    }

    /**
     * Render Register Form
     */
    renderRegisterForm() {
        const frag = document.createDocumentFragment();

        // Google Register Button
        const googleBtn = document.createElement('button');
        googleBtn.type = 'button';
        googleBtn.className = 'full-page-auth-google-btn';
        googleBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            <span>${this.t('popup.auth.google_btn', 'Продолжить с Google')}</span>
        `;
        googleBtn.addEventListener('click', () => this.handleGoogleLogin(googleBtn));
        frag.appendChild(googleBtn);

        // Divider
        const divider = document.createElement('div');
        divider.className = 'full-page-auth-divider';
        divider.innerHTML = `<span class="full-page-auth-divider-text">${this.t('popup.auth.or', 'или')}</span>`;
        frag.appendChild(divider);

        // Form
        const form = document.createElement('form');
        form.className = 'full-page-auth-form';
        form.noValidate = true;

        // Names Row (2-columns)
        const nameRow = document.createElement('div');
        nameRow.className = 'full-page-auth-row-2';
        nameRow.innerHTML = `
            <div class="full-page-auth-form-group">
                <label class="full-page-auth-label" for="fpaRegFirstName">${this.t('popup.auth.first_name_label', 'Имя')}</label>
                <div class="full-page-auth-input-wrapper">
                    <input type="text" id="fpaRegFirstName" class="full-page-auth-input" placeholder="${this.t('popup.auth.first_name_placeholder', 'Ваше имя')}" required autocomplete="given-name">
                </div>
                <div class="full-page-auth-field-error" id="fpaRegFirstNameError" style="display:none;"></div>
            </div>
            <div class="full-page-auth-form-group">
                <label class="full-page-auth-label" for="fpaRegLastName">${this.t('popup.auth.last_name_label', 'Фамилия')}</label>
                <div class="full-page-auth-input-wrapper">
                    <input type="text" id="fpaRegLastName" class="full-page-auth-input" placeholder="${this.t('popup.auth.last_name_placeholder', 'Ваша фамилия')}" required autocomplete="family-name">
                </div>
                <div class="full-page-auth-field-error" id="fpaRegLastNameError" style="display:none;"></div>
            </div>
        `;
        form.appendChild(nameRow);

        // Email Group
        const emailGroup = document.createElement('div');
        emailGroup.className = 'full-page-auth-form-group';
        emailGroup.innerHTML = `
            <label class="full-page-auth-label" for="fpaRegEmail">${this.t('popup.auth.email_label', 'Электронная почта')}</label>
            <div class="full-page-auth-input-wrapper">
                <input type="email" id="fpaRegEmail" class="full-page-auth-input" placeholder="${this.t('popup.auth.email_placeholder', 'Ваш email')}" required autocomplete="email">
            </div>
            <div class="full-page-auth-field-error" id="fpaRegEmailError" style="display:none;"></div>
        `;
        form.appendChild(emailGroup);

        // Password Group
        const passGroup = document.createElement('div');
        passGroup.className = 'full-page-auth-form-group';
        passGroup.innerHTML = `
            <label class="full-page-auth-label" for="fpaRegPassword">${this.t('popup.auth.password_label', 'Пароль')}</label>
            <div class="full-page-auth-input-wrapper">
                <input type="password" id="fpaRegPassword" class="full-page-auth-input has-toggle" placeholder="${this.t('popup.auth.password_placeholder', 'Придумайте пароль')}" required autocomplete="new-password">
                <button type="button" class="full-page-auth-password-toggle" aria-label="Toggle password visibility">
                    ${(typeof Icons !== 'undefined' && Icons.EYE) ? Icons.EYE : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'}
                </button>
            </div>
            <div class="full-page-auth-field-error" id="fpaRegPassError" style="display:none;"></div>
        `;
        const toggleBtn1 = passGroup.querySelector('.full-page-auth-password-toggle');
        const passInput1 = passGroup.querySelector('#fpaRegPassword');
        toggleBtn1.addEventListener('click', () => {
            const isPass = passInput1.type === 'password';
            passInput1.type = isPass ? 'text' : 'password';
            toggleBtn1.innerHTML = isPass
                ? ((typeof Icons !== 'undefined' && Icons.EYE_OFF) ? Icons.EYE_OFF : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>')
                : ((typeof Icons !== 'undefined' && Icons.EYE) ? Icons.EYE : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>');
        });
        form.appendChild(passGroup);

        // Confirm Password Group
        const confirmPassGroup = document.createElement('div');
        confirmPassGroup.className = 'full-page-auth-form-group';
        confirmPassGroup.innerHTML = `
            <label class="full-page-auth-label" for="fpaRegConfirmPassword">${this.t('popup.auth.confirm_password_label', 'Повторите пароль')}</label>
            <div class="full-page-auth-input-wrapper">
                <input type="password" id="fpaRegConfirmPassword" class="full-page-auth-input has-toggle" placeholder="${this.t('popup.auth.confirm_password_placeholder', 'Повторите пароль')}" required autocomplete="new-password">
                <button type="button" class="full-page-auth-password-toggle" aria-label="Toggle confirm password visibility">
                    ${(typeof Icons !== 'undefined' && Icons.EYE) ? Icons.EYE : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'}
                </button>
            </div>
            <div class="full-page-auth-field-error" id="fpaRegConfirmPassError" style="display:none;"></div>
        `;
        const toggleBtn2 = confirmPassGroup.querySelector('.full-page-auth-password-toggle');
        const passInput2 = confirmPassGroup.querySelector('#fpaRegConfirmPassword');
        toggleBtn2.addEventListener('click', () => {
            const isPass = passInput2.type === 'password';
            passInput2.type = isPass ? 'text' : 'password';
            toggleBtn2.innerHTML = isPass
                ? ((typeof Icons !== 'undefined' && Icons.EYE_OFF) ? Icons.EYE_OFF : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>')
                : ((typeof Icons !== 'undefined' && Icons.EYE) ? Icons.EYE : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>');
        });
        form.appendChild(confirmPassGroup);

        // Submit Button
        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.className = 'full-page-auth-submit-btn';
        submitBtn.id = 'fpaRegisterSubmitBtn';
        submitBtn.innerHTML = `<span class="fpa-btn-text">${this.t('popup.auth.create_account', 'Зарегистрироваться')}</span>`;
        form.appendChild(submitBtn);

        form.addEventListener('submit', (e) => this.handleRegister(e, form, submitBtn));
        frag.appendChild(form);

        // Footer / Switch to Login
        const footer = document.createElement('div');
        footer.className = 'full-page-auth-footer';
        footer.innerHTML = `
            <span>${this.t('popup.auth.have_account', 'Уже есть аккаунт?')}</span>
            <button type="button" class="full-page-auth-switch-link" id="fpaGoToLoginBtn">${this.t('popup.auth.login_btn', 'Войти')}</button>
        `;
        footer.querySelector('#fpaGoToLoginBtn').addEventListener('click', () => {
            this.switchView('login');
        });
        frag.appendChild(footer);

        return frag;
    }

    /**
     * Render Approval Gate Status Screen
     */
    renderApprovalState() {
        const { status, isNewRegistration } = this.approvalState;
        const container = document.createElement('div');
        container.className = 'full-page-auth-approval-card';

        // Icon
        const iconWrapper = document.createElement('div');
        iconWrapper.className = `full-page-auth-approval-icon status-${status}`;
        if (status === 'pending') {
            iconWrapper.innerHTML = (typeof Icons !== 'undefined' && Icons.CLOCK) ? Icons.CLOCK : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
        } else {
            iconWrapper.innerHTML = (typeof Icons !== 'undefined' && Icons.SHIELD_ALERT) ? Icons.SHIELD_ALERT : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        }
        container.appendChild(iconWrapper);

        // Title
        const titleEl = document.createElement('h3');
        titleEl.className = 'full-page-auth-approval-title';
        if (status === 'pending') {
            titleEl.textContent = isNewRegistration
                ? this.t('popup.approval.pending_registered_title', 'Заявка на рассмотрении')
                : this.t('popup.approval.pending_login_title', 'Аккаунт ожидает подтверждения');
        } else {
            titleEl.textContent = this.t('popup.approval.rejected_title', 'Доступ ограничен');
        }
        container.appendChild(titleEl);

        // Message
        const msgEl = document.createElement('p');
        msgEl.className = 'full-page-auth-approval-msg';
        if (status === 'pending') {
            msgEl.textContent = isNewRegistration
                ? this.t('popup.approval.pending_registered_msg', 'Ваш аккаунт успешно создан и ожидает подтверждения администратором. После одобрения вы получите полный доступ к расширению.')
                : this.t('popup.approval.pending_login_msg', 'Ваша регистрация находится на рассмотрении у администратора. Доступ будет открыт сразу после проверки.');
        } else {
            msgEl.textContent = this.t('popup.approval.rejected_msg', 'Ваша регистрация была отклонена администратором.');
        }
        container.appendChild(msgEl);

        // Action Button: Back to Login
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'full-page-auth-submit-btn';
        backBtn.textContent = this.t('popup.approval.back_to_login', 'Вернуться ко входу');
        backBtn.addEventListener('click', () => {
            this.switchView('login');
        });
        container.appendChild(backBtn);

        return container;
    }

    /**
     * Show general error banner
     * @param {string} message
     */
    showError(message) {
        const banner = this.rootElement ? this.rootElement.querySelector('#fpaErrorBanner') : null;
        if (banner) {
            banner.textContent = message;
            banner.style.display = 'flex';
        }
        if (typeof this.options.onError === 'function') {
            this.options.onError(new Error(message));
        }
    }

    /**
     * Clear error banner and field errors
     */
    clearErrors() {
        const banner = this.rootElement ? this.rootElement.querySelector('#fpaErrorBanner') : null;
        if (banner) {
            banner.textContent = '';
            banner.style.display = 'none';
        }
        if (this.rootElement) {
            const inputs = this.rootElement.querySelectorAll('.full-page-auth-input');
            inputs.forEach(i => i.classList.remove('error'));
            const fieldErrors = this.rootElement.querySelectorAll('.full-page-auth-field-error');
            fieldErrors.forEach(fe => {
                fe.textContent = '';
                fe.style.display = 'none';
            });
        }
    }

    /**
     * Show error on a specific field
     * @param {HTMLElement} inputEl
     * @param {HTMLElement} errorEl
     * @param {string} message
     */
    showFieldError(inputEl, errorEl, message) {
        if (inputEl) inputEl.classList.add('error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    /**
     * Toggle button loading state
     * @param {HTMLButtonElement} btn
     * @param {boolean} isLoading
     * @param {string} [loadingTextKey]
     */
    setButtonLoading(btn, isLoading, loadingTextKey = '') {
        if (!btn) return;
        btn.disabled = isLoading;
        if (isLoading) {
            const text = loadingTextKey ? this.t(loadingTextKey, 'Загрузка...') : 'Загрузка...';
            btn.innerHTML = `<span class="full-page-auth-spinner"></span> <span>${text}</span>`;
        } else {
            const defaultText = this.currentView === 'register'
                ? this.t('popup.auth.create_account', 'Зарегистрироваться')
                : this.t('popup.auth.login_btn', 'Войти');
            btn.innerHTML = `<span>${defaultText}</span>`;
        }
    }

    /**
     * Validate email format
     * @param {string} email
     * @returns {boolean}
     */
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /**
     * Handle email & password login
     */
    async handleEmailLogin(e, form, submitBtn) {
        e.preventDefault();
        this.clearErrors();

        const emailInput = form.querySelector('#fpaLoginEmail');
        const passInput = form.querySelector('#fpaLoginPassword');
        const emailError = form.querySelector('#fpaLoginEmailError');
        const passError = form.querySelector('#fpaLoginPassError');

        const email = emailInput ? emailInput.value.trim() : '';
        const password = passInput ? passInput.value : '';

        if (!email) {
            this.showFieldError(emailInput, emailError, this.t('popup.auth.fill_all', 'Пожалуйста, введите email'));
            return;
        }

        if (!this.isValidEmail(email)) {
            this.showFieldError(emailInput, emailError, this.t('popup.auth.fill_all', 'Некорректный формат email'));
            return;
        }

        if (!password) {
            this.showFieldError(passInput, passError, this.t('popup.auth.fill_all', 'Пожалуйста, введите пароль'));
            return;
        }

        this.setButtonLoading(submitBtn, true, 'popup.auth.loading_login');

        try {
            if (typeof firebaseManager === 'undefined' || !firebaseManager) {
                throw new Error('FirebaseManager is not available');
            }

            await firebaseManager.signInWithEmail(email, password);
            const user = firebaseManager.getCurrentUser();
            
            // Check approval status
            const isApproved = await this.validateUserApproval(user?.uid, false);
            if (!isApproved) {
                return;
            }

            // Fetch profile for callback
            let profile = null;
            if (firebaseManager.getUserService && user) {
                try {
                    const userService = firebaseManager.getUserService();
                    profile = await userService.getUserProfile(user.uid);
                } catch (pe) {
                    console.warn('[FullPageAuth] Error getting user profile:', pe);
                }
            }

            if (typeof this.options.onAuthSuccess === 'function') {
                this.options.onAuthSuccess(user, profile);
            }
        } catch (err) {
            console.error('[FullPageAuth] Login error:', err);
            this.showError(`${this.t('popup.auth.loading_login', 'Ошибка входа')}: ${err.message}`);
        } finally {
            this.setButtonLoading(submitBtn, false);
        }
    }

    /**
     * Handle Google Sign-In
     */
    async handleGoogleLogin(btn) {
        this.clearErrors();
        if (btn) btn.disabled = true;

        try {
            if (typeof firebaseManager === 'undefined' || !firebaseManager) {
                throw new Error('FirebaseManager is not available');
            }

            const user = await firebaseManager.signInWithGoogle();
            if (!user) {
                throw new Error('Google sign in did not return user');
            }

            // Check approval status
            const isApproved = await this.validateUserApproval(user.uid, false);
            if (!isApproved) {
                return;
            }

            let profile = null;
            if (firebaseManager.getUserService) {
                try {
                    const userService = firebaseManager.getUserService();
                    profile = await userService.getUserProfile(user.uid);
                } catch (pe) {
                    console.warn('[FullPageAuth] Error getting user profile:', pe);
                }
            }

            if (typeof this.options.onAuthSuccess === 'function') {
                this.options.onAuthSuccess(user, profile);
            }
        } catch (err) {
            console.error('[FullPageAuth] Google Sign-In error:', err);
            this.showError(`${this.t('popup.auth.loading_google', 'Ошибка входа Google')}: ${err.message}`);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    /**
     * Handle email registration
     */
    async handleRegister(e, form, submitBtn) {
        e.preventDefault();
        this.clearErrors();

        const firstNameInput = form.querySelector('#fpaRegFirstName');
        const lastNameInput = form.querySelector('#fpaRegLastName');
        const emailInput = form.querySelector('#fpaRegEmail');
        const passInput = form.querySelector('#fpaRegPassword');
        const confirmPassInput = form.querySelector('#fpaRegConfirmPassword');

        const firstNameError = form.querySelector('#fpaRegFirstNameError');
        const lastNameError = form.querySelector('#fpaRegLastNameError');
        const emailError = form.querySelector('#fpaRegEmailError');
        const passError = form.querySelector('#fpaRegPassError');
        const confirmPassError = form.querySelector('#fpaRegConfirmPassError');

        const firstName = firstNameInput ? firstNameInput.value.trim() : '';
        const lastName = lastNameInput ? lastNameInput.value.trim() : '';
        const email = emailInput ? emailInput.value.trim() : '';
        const password = passInput ? passInput.value : '';
        const confirmPassword = confirmPassInput ? confirmPassInput.value : '';

        if (!firstName) {
            this.showFieldError(firstNameInput, firstNameError, this.t('popup.auth.fill_all', 'Введите имя'));
            return;
        }

        if (!lastName) {
            this.showFieldError(lastNameInput, lastNameError, this.t('popup.auth.fill_all', 'Введите фамилию'));
            return;
        }

        if (!email) {
            this.showFieldError(emailInput, emailError, this.t('popup.auth.fill_all', 'Введите email'));
            return;
        }

        if (!this.isValidEmail(email)) {
            this.showFieldError(emailInput, emailError, this.t('popup.auth.fill_all', 'Некорректный email'));
            return;
        }

        if (!password) {
            this.showFieldError(passInput, passError, this.t('popup.auth.fill_all', 'Придумайте пароль'));
            return;
        }

        if (password.length < 6) {
            this.showFieldError(passInput, passError, this.t('popup.auth.password_min_length', 'Пароль должен быть не менее 6 символов'));
            return;
        }

        if (!confirmPassword) {
            this.showFieldError(confirmPassInput, confirmPassError, this.t('popup.auth.fill_all', 'Повторите пароль'));
            return;
        }

        if (password !== confirmPassword) {
            this.showFieldError(confirmPassInput, confirmPassError, this.t('popup.auth.passwords_dont_match', 'Пароли не совпадают'));
            return;
        }

        this.setButtonLoading(submitBtn, true, 'popup.auth.loading_register');

        try {
            if (typeof firebaseManager === 'undefined' || !firebaseManager) {
                throw new Error('FirebaseManager is not available');
            }

            await firebaseManager.createUserWithEmail(email, password);
            const user = firebaseManager.getCurrentUser();

            // Create user profile in Firestore
            if (firebaseManager.getUserService && user) {
                const userService = firebaseManager.getUserService();
                const displayName = `${firstName} ${lastName}`.trim() || user.email.split('@')[0];
                await userService.createOrUpdateUserProfile(user.uid, {
                    displayName: displayName,
                    firstName: firstName,
                    lastName: lastName,
                    photoURL: user.photoURL || null,
                    email: user.email,
                    createdAt: user.metadata?.creationTime || new Date().toISOString()
                });
            }

            // Approval Gate check for new registration
            const isApproved = await this.validateUserApproval(user?.uid, true);
            if (!isApproved) {
                return;
            }

            if (typeof this.options.onAuthSuccess === 'function') {
                this.options.onAuthSuccess(user, null);
            }
        } catch (err) {
            console.error('[FullPageAuth] Registration error:', err);
            this.showError(`${this.t('popup.auth.loading_register', 'Ошибка регистрации')}: ${err.message}`);
        } finally {
            this.setButtonLoading(submitBtn, false);
        }
    }

    /**
     * Validate user approval status with Firestore
     * @param {string} userId
     * @param {boolean} isNewRegistration
     * @returns {Promise<boolean>}
     */
    async validateUserApproval(userId, isNewRegistration = false) {
        if (!userId) return false;

        try {
            if (typeof firebaseManager === 'undefined' || !firebaseManager || !firebaseManager.getUserService) {
                return true;
            }

            const userService = firebaseManager.getUserService();
            const profile = await userService.getUserProfile(userId);

            if (profile && profile.approvalStatus === 'pending') {
                await this.handleApprovalBlocked('pending', isNewRegistration);
                return false;
            }

            if (profile && profile.approvalStatus === 'rejected') {
                await this.handleApprovalBlocked('rejected', isNewRegistration);
                return false;
            }

            // Approved or legacy fallback
            return true;
        } catch (error) {
            console.error('[FullPageAuth] Error validating user approval status:', error);
            return true;
        }
    }

    /**
     * Handle gated sign out when user is pending or rejected
     * @param {'pending'|'rejected'} status
     * @param {boolean} isNewRegistration
     */
    async handleApprovalBlocked(status, isNewRegistration = false) {
        try {
            if (typeof AuthManager !== 'undefined' && AuthManager.clearAuthData) {
                await AuthManager.clearAuthData();
            }
            if (typeof firebaseManager !== 'undefined' && firebaseManager && firebaseManager.signOut) {
                await firebaseManager.signOut();
            }
        } catch (err) {
            console.error('[FullPageAuth] Error clearing auth on block:', err);
        }

        this.switchView('approval', { status, isNewRegistration });
    }
}

// Export for ES modules and global browser scope
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FullPageAuth;
} else if (typeof window !== 'undefined') {
    window.FullPageAuth = FullPageAuth;
} else {
    self.FullPageAuth = FullPageAuth;
}
