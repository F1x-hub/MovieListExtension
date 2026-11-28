/**
 * Settings → «Телевизор». The Android TV app shows a 6-character code; the owner types
 * it here, sees which device asked and when, and confirms with «Это мой телевизор».
 * It has a Settings section of its own rather than a button on the profile, so only
 * someone who means to sign in a TV comes here. The server side is functions/tvLogin.js
 * (`tvLoginApprove`): a lookup first, then the confirmation, both with the user's ID token.
 */
import { i18n } from '../../shared/i18n/I18n.js';

export const TV_LOGIN_APPROVE_URL = 'https://us-central1-movielistdb-13208.cloudfunctions.net/tvLoginApprove';
// Same alphabet as the server: no 0/O, 1/I/L.
const USER_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

/** Upper case without separators («k7q·4md» → «K7Q4MD»); null when it cannot be a code. */
export function normalizeTvCode(value) {
    const code = String(value ?? '').toUpperCase().replace(/[\s·.\-_]/g, '');
    return USER_CODE_PATTERN.test(code) ? code : null;
}

const ERROR_KEYS = {
    CODE_NOT_FOUND: 'settings.tv_login.error_not_found',
    CODE_USED: 'settings.tv_login.error_used',
    RATE_LIMITED: 'settings.tv_login.error_rate',
    APPROVAL_REQUIRED: 'settings.tv_login.error_approval',
    AUTH_REQUIRED: 'settings.tv_login.error_auth',
};

export function tvLoginErrorMessage(code) {
    return i18n.get(ERROR_KEYS[code] || 'settings.tv_login.error_network');
}

export async function callTvLoginApprove({ user, userCode, confirm, fetchImpl = fetch }) {
    if (!user || typeof user.getIdToken !== 'function') {
        const error = new Error('Not signed in');
        error.code = 'AUTH_REQUIRED';
        throw error;
    }
    const token = await user.getIdToken();
    let response;
    try {
        response = await fetchImpl(TV_LOGIN_APPROVE_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ userCode, confirm: confirm === true }),
        });
    } catch (cause) {
        const error = new Error('Network error', { cause });
        error.code = 'NETWORK';
        throw error;
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(result?.error || 'TV sign-in failed');
        error.code = result?.code || 'NETWORK';
        throw error;
    }
    return result;
}

export class TvLoginPanel {
    /**
     * @param {Object} options
     * @param {() => Object|null} options.getUser - the signed-in Firebase user
     */
    constructor({ getUser, fetchImpl } = {}) {
        this.getUser = getUser;
        this.fetchImpl = fetchImpl || ((...args) => fetch(...args));
        this.userCode = null;
        this.busy = false;
        this.signedIn = false;
        this.step = 'none';
        // Async UI rule: every request remembers this number and its answer is dropped when the
        // panel was reset, signed out or edited meanwhile, so a late answer never shows or
        // approves a code the user has left.
        this.requestId = 0;
        const byId = (id) => document.getElementById(id);
        this.el = {
            panel: byId('tvLoginPanel'),
            signedOut: byId('tvLoginSignedOut'),
            form: byId('tvLoginCodeForm'),
            input: byId('tvLoginCodeInput'),
            codeError: byId('tvLoginCodeError'),
            confirmStep: byId('tvLoginConfirmStep'),
            deviceName: byId('tvLoginDeviceName'),
            deviceTime: byId('tvLoginDeviceTime'),
            confirmError: byId('tvLoginConfirmError'),
            doneStep: byId('tvLoginDoneStep'),
            find: byId('tvLoginFindBtn'),
            confirm: byId('tvLoginConfirmBtn'),
            cancel: byId('tvLoginCancelBtn'),
            again: byId('tvLoginAgainBtn'),
        };
    }

    bind() {
        const { el } = this;
        if (!el.panel) return;
        el.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.lookUp();
        });
        el.input.addEventListener('input', () => {
            el.codeError.textContent = '';
            el.input.removeAttribute('aria-invalid');
            if (this.busy) {
                this.requestId += 1;
                this.setBusy(null);
            }
        });
        el.confirm.addEventListener('click', () => this.approve());
        el.cancel.addEventListener('click', () => this.reset({ focus: true }));
        el.again.addEventListener('click', () => this.reset({ focus: true }));
        this.applyUser(this.getUser?.());
    }

    /**
     * A guest sees why there is no form; a change of account drops whatever was in
     * progress. The same account announced again keeps the current step.
     */
    applyUser(user) {
        const uid = user?.uid || null;
        if (this.bound && uid === this.uid) return;
        this.bound = true;
        this.uid = uid;
        this.signedIn = Boolean(uid);
        if (this.el.signedOut) this.el.signedOut.hidden = this.signedIn;
        this.reset();
    }

    /** Back to an empty code step; any answer still on its way is dropped. */
    reset({ focus = false } = {}) {
        const { el } = this;
        if (!el.panel) return;
        this.requestId += 1;
        this.userCode = null;
        this.setBusy(null);
        this.showStep(this.signedIn ? 'code' : 'none');
        el.input.value = '';
        el.codeError.textContent = '';
        el.confirmError.textContent = '';
        el.input.removeAttribute('aria-invalid');
        if (focus && this.signedIn) el.input.focus();
    }

    showStep(step) {
        const { el } = this;
        this.step = step;
        el.form.hidden = step !== 'code';
        el.confirmStep.hidden = step !== 'confirm';
        el.doneStep.hidden = step !== 'done';
    }

    setBusy(button) {
        this.busy = Boolean(button);
        for (const candidate of [this.el.find, this.el.confirm]) {
            const pending = candidate === button;
            candidate.classList.toggle('btn--pending', pending);
            candidate.disabled = pending;
            if (pending) candidate.setAttribute('aria-busy', 'true');
            else candidate.removeAttribute('aria-busy');
        }
    }

    formatRequestTime(millis) {
        const date = new Date(Number(millis) || Date.now());
        const locale = i18n.currentLocale === 'ru' ? 'ru-RU' : 'en-US';
        return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    }

    async lookUp() {
        if (this.busy || this.step !== 'code') return;
        const { el } = this;
        const code = normalizeTvCode(el.input.value);
        if (!code) {
            el.codeError.textContent = i18n.get('settings.tv_login.error_format');
            el.input.setAttribute('aria-invalid', 'true');
            el.input.focus();
            return;
        }
        const requestId = ++this.requestId;
        this.setBusy(el.find);
        try {
            const result = await callTvLoginApprove({ user: this.getUser(), userCode: code, confirm: false, fetchImpl: this.fetchImpl });
            if (requestId !== this.requestId) return;
            this.userCode = code;
            el.deviceName.textContent = result.deviceName || i18n.get('settings.tv_login.device_default');
            el.deviceTime.textContent = i18n.get('settings.tv_login.requested_at')
                .replace('{time}', this.formatRequestTime(result.requestedAt));
            el.confirmError.textContent = '';
            this.setBusy(null);
            this.showStep('confirm');
            el.confirm.focus();
        } catch (error) {
            if (requestId !== this.requestId) return;
            this.setBusy(null);
            el.codeError.textContent = tvLoginErrorMessage(error.code);
            el.input.setAttribute('aria-invalid', 'true');
            el.input.focus();
        }
    }

    async approve() {
        if (this.busy || !this.userCode || this.step !== 'confirm') return;
        const { el } = this;
        const requestId = ++this.requestId;
        const userCode = this.userCode;
        this.setBusy(el.confirm);
        try {
            await callTvLoginApprove({ user: this.getUser(), userCode, confirm: true, fetchImpl: this.fetchImpl });
            if (requestId !== this.requestId) return;
            this.setBusy(null);
            this.userCode = null;
            this.showStep('done');
            el.again.focus();
        } catch (error) {
            if (requestId !== this.requestId) return;
            this.setBusy(null);
            el.confirmError.textContent = tvLoginErrorMessage(error.code);
        }
    }
}
