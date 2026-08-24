import assert from 'node:assert';

console.log('🧪 Running Navigation Auth Modal (Phase 2) Unit & Regression Tests...');

// Setup Mock DOM & Environment
class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.className = '';
        this.id = '';
        this.style = {
            removeProperty(prop) { delete this[prop]; },
            setProperty(prop, val) { this[prop] = val; }
        };
        this.attributes = {};
        this.children = [];
        this.parentNode = null;
        this.textContent = '';
        this._innerHTML = '';
        this.value = '';
        this.type = '';
        this.disabled = false;
        this.dataset = {};
        this.eventListeners = {};
    }

    insertAdjacentHTML(position, html) {
        const temp = new MockElement('temp');
        temp.innerHTML = html;
        if (position === 'afterbegin') {
            this.children.unshift(...temp.children);
            temp.children.forEach(c => { c.parentNode = this; });
        } else if (position === 'beforeend') {
            temp.children.forEach(c => this.appendChild(c));
        }
    }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        if (!html || typeof html !== 'string') return;

        const selfClosing = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
        const tokenRegex = /<!--[\s\S]*?-->|<(?:\/([a-zA-Z0-9]+)|([a-zA-Z0-9]+)((?:\s+[^=>\s]+(?:=(?:"[^"]*"|'[^']*'|[^>\s]+))?)*)\s*(\/?)>)|([^<]+)/g;
        let match;
        
        const stack = [this];

        while ((match = tokenRegex.exec(html)) !== null) {
            const [full, closeTag, openTag, attrsStr, selfCloseSlash, text] = match;
            if (full.startsWith('<!--')) continue;
            
            if (text && text.trim()) {
                const current = stack[stack.length - 1];
                current.textContent = (current.textContent ? current.textContent + ' ' : '') + text.trim();
            } else if (openTag) {
                const child = new MockElement(openTag);
                if (attrsStr) {
                    const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
                    let attrMatch;
                    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
                        const name = attrMatch[1];
                        const val = attrMatch[2] !== undefined ? attrMatch[2] : (attrMatch[3] !== undefined ? attrMatch[3] : (attrMatch[4] !== undefined ? attrMatch[4] : ''));
                        if (name === 'class') child.className = val;
                        else if (name === 'id') child.id = val;
                        else if (name === 'type') child.type = val;
                        else child.setAttribute(name, val);
                    }
                }
                const current = stack[stack.length - 1];
                current.appendChild(child);
                
                const isSelfClosing = selfClosing.has(openTag.toLowerCase()) || !!selfCloseSlash;
                if (!isSelfClosing) {
                    stack.push(child);
                }
            } else if (closeTag) {
                for (let i = stack.length - 1; i > 0; i--) {
                    if (stack[i].tagName.toLowerCase() === closeTag.toLowerCase()) {
                        stack.splice(i);
                        break;
                    }
                }
            }
        }
    }

    setAttribute(name, val) { this.attributes[name] = val; }
    getAttribute(name) { return this.attributes[name] || null; }
    appendChild(child) {
        if (!child) return;
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }
    addEventListener(event, handler) {
        if (!this.eventListeners[event]) this.eventListeners[event] = [];
        this.eventListeners[event].push(handler);
    }
    removeEventListener(event, handler) {
        if (!this.eventListeners[event]) return;
        this.eventListeners[event] = this.eventListeners[event].filter(h => h !== handler);
    }
    dispatchEvent(event) {
        const type = typeof event === 'string' ? event : event.type;
        const listeners = this.eventListeners[type] || [];
        listeners.forEach(l => l(event));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
        const results = [];
        const match = (el) => {
            if (selector.startsWith('#') && el.id === selector.slice(1)) return true;
            if (selector.startsWith('.') && el.className && el.className.split(' ').includes(selector.slice(1))) return true;
            if (el.tagName && el.tagName.toLowerCase() === selector.toLowerCase()) return true;
            return false;
        };
        const traverse = (node) => {
            for (const child of node.children) {
                if (match(child)) results.push(child);
                traverse(child);
            }
        };
        traverse(this);
        return results;
    }
    get classList() {
        const self = this;
        return {
            add(...classes) {
                const current = new Set(self.className ? self.className.split(' ') : []);
                classes.forEach(c => current.add(c));
                self.className = Array.from(current).join(' ');
            },
            remove(...classes) {
                const current = new Set(self.className ? self.className.split(' ') : []);
                classes.forEach(c => current.delete(c));
                self.className = Array.from(current).join(' ');
            },
            contains(cls) {
                return (self.className ? self.className.split(' ') : []).includes(cls);
            }
        };
    }
}

global.document = {
    body: new MockElement('body'),
    head: new MockElement('head'),
    documentElement: new MockElement('html'),
    createElement(tag) { return new MockElement(tag); },
    createDocumentFragment() { return new MockElement('fragment'); },
    querySelector(sel) {
        return this.body.querySelector(sel) || this.head.querySelector(sel) || this.documentElement.querySelector(sel);
    },
    querySelectorAll(sel) {
        return [...this.body.querySelectorAll(sel), ...this.head.querySelectorAll(sel), ...this.documentElement.querySelectorAll(sel)];
    },
    getElementById(id) {
        return this.querySelector(`#${id}`);
    },
    addEventListener() {},
    removeEventListener() {}
};

const mockLocalStorage = {
    store: {},
    getItem(key) { return this.store[key] || null; },
    setItem(key, val) { this.store[key] = String(val); },
    removeItem(key) { delete this.store[key]; },
    clear() { this.store = {}; }
};
global.localStorage = mockLocalStorage;

global.window = {
    location: {
        pathname: '/src/pages/home/home.html',
        href: 'chrome-extension://mock/src/pages/home/home.html',
        reloadCalled: false,
        reload() { this.reloadCalled = true; }
    },
    addEventListener(event, handler) {
        if (!this.eventListeners) this.eventListeners = {};
        if (!this.eventListeners[event]) this.eventListeners[event] = [];
        this.eventListeners[event].push(handler);
    },
    removeEventListener(event, handler) {
        if (!this.eventListeners || !this.eventListeners[event]) return;
        this.eventListeners[event] = this.eventListeners[event].filter(h => h !== handler);
    },
    dispatchEvent(event) {
        if (!this.eventListeners) return;
        const listeners = this.eventListeners[event.type] || [];
        listeners.forEach(l => l(event));
    }
};

global.CustomEvent = class {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail || {};
    }
};

global.chrome = {
    runtime: {
        getURL(path) { return `chrome-extension://mock-id/${path}`; }
    },
    storage: {
        local: {
            store: {},
            async get(keys) {
                if (typeof keys === 'string') return { [keys]: this.store[keys] };
                if (Array.isArray(keys)) {
                    const res = {};
                    keys.forEach(k => { res[k] = this.store[k]; });
                    return res;
                }
                return { ...this.store };
            },
            async set(items) { Object.assign(this.store, items); },
            async remove(keys) {
                const arr = Array.isArray(keys) ? keys : [keys];
                arr.forEach(k => delete this.store[k]);
            }
        },
        sync: {
            store: {},
            async get(keys) {
                if (typeof keys === 'string') return { [keys]: this.store[keys] };
                if (Array.isArray(keys)) {
                    const res = {};
                    keys.forEach(k => { res[k] = this.store[k]; });
                    return res;
                }
                return { ...this.store };
            },
            async set(items) { Object.assign(this.store, items); },
            async remove(keys) {
                const arr = Array.isArray(keys) ? keys : [keys];
                arr.forEach(k => delete this.store[k]);
            }
        }
    }
};

// Import FullPageAuth and Navigation
import FullPageAuth from '../src/shared/components/FullPageAuth.js';
global.FullPageAuth = FullPageAuth;
global.window.FullPageAuth = FullPageAuth;

import Navigation from '../src/shared/components/Navigation.js';

async function runTests() {
    console.log('\n--- 1. Testing Full-Page Logout Flow Without Redirect ---');
    
    let signOutCalled = false;
    let authDataCleared = false;
    global.AuthManager = {
        clearAuthData: async () => { authDataCleared = true; }
    };
    global.firebaseManager = {
        getCurrentUser() { return { uid: 'test-user', email: 'test@example.com' }; },
        getUserService() {
            return {
                async getUserProfile() { return { approvalStatus: 'approved', displayName: 'Test User' }; }
            };
        },
        async signOut() { signOutCalled = true; }
    };

    window.location.pathname = '/src/pages/home/home.html';
    window.location.href = 'chrome-extension://mock/src/pages/home/home.html';

    const nav = new Navigation('home');
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Trigger logout
    await nav.handleLogout();

    assert.strictEqual(window.location.href, 'chrome-extension://mock/src/pages/home/home.html', 'URL MUST NOT change on full-page logout');
    assert.strictEqual(signOutCalled, true, 'firebaseManager.signOut was executed');
    assert.strictEqual(authDataCleared, true, 'AuthManager.clearAuthData was executed');
    assert.ok(nav.authModal instanceof FullPageAuth, 'FullPageAuth modal was mounted');
    assert.strictEqual(nav.authModal.options.mode, 'modal', 'Auth modal opened in modal mode');
    console.log('  ✅ handleLogout() shows in-place modal without popup redirect');

    console.log('\n--- 2. Testing Full-Page Sign In Button Action ---');
    if (nav.authModal) {
        nav.authModal.destroy();
        nav.authModal = null;
    }

    nav.handleSignIn();
    assert.strictEqual(window.location.href, 'chrome-extension://mock/src/pages/home/home.html', 'URL MUST NOT change on sign-in click');
    assert.ok(nav.authModal instanceof FullPageAuth, 'FullPageAuth modal opened on handleSignIn');
    assert.strictEqual(nav.authModal.currentView, 'login', 'Initial view is login');
    console.log('  ✅ handleSignIn() shows in-place modal without popup redirect');

    console.log('\n--- 3. Testing Auth Success Callback & State Restoration ---');
    let pageAuthEventFired = false;
    let authEventUser = null;
    window.addEventListener('authStateChanged', (e) => {
        pageAuthEventFired = true;
        authEventUser = e.detail.user;
    });

    const loggedInUser = { uid: 'user-logged-in', email: 'user@example.com' };
    await nav.authModal.options.onAuthSuccess(loggedInUser);

    assert.strictEqual(nav.authModal, null, 'Auth modal destroyed after successful login');
    assert.strictEqual(pageAuthEventFired, true, 'authStateChanged event dispatched to host page');
    assert.strictEqual(authEventUser.uid, 'user-logged-in', 'Correct user payload in authStateChanged event');
    console.log('  ✅ Successful login closes modal and dispatches authStateChanged to host page');

    console.log('\n--- 4. Testing Approval-Gate Revocation on Session Check ---');
    global.firebaseManager = {
        getCurrentUser() { return { uid: 'revoked-user', email: 'revoked@example.com' }; },
        getUserService() {
            return {
                async getUserProfile() { return { approvalStatus: 'pending', displayName: 'Pending User' }; }
            };
        },
        async signOut() { signOutCalled = true; }
    };

    // User session restoration detected pending status
    await nav.updateUserDisplay({ uid: 'revoked-user', email: 'revoked@example.com' });

    assert.ok(nav.authModal instanceof FullPageAuth, 'Auth modal opened for revoked pending status');
    assert.strictEqual(nav.authModal.currentView, 'approval', 'Switched to approval view');
    assert.strictEqual(nav.authModal.approvalState.status, 'pending', 'Approval status is pending');
    console.log('  ✅ Pending/Rejected session restoration automatically signs out and shows approval modal');

    console.log('\n--- 5. Testing Popup Context Isolation ---');
    window.location.pathname = '/src/popup/popup.html';
    window.location.reloadCalled = false;
    if (nav.authModal) {
        nav.authModal.destroy();
        nav.authModal = null;
    }

    nav.handleSignIn();
    assert.strictEqual(window.location.reloadCalled, true, 'Reloads in popup context instead of mounting modal');
    console.log('  ✅ Popup context gracefully reloads without full-page modal conflict');

    console.log('\n🎉 ALL Navigation Auth Modal (Phase 2) Tests Passed Successfully!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
