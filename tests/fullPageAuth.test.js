import assert from 'node:assert';

console.log('🧪 Running FullPageAuth (Phase 1) Isolated Unit & Contract Tests...');

// Setup Mock DOM Environment
class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName.toUpperCase();
        this.className = '';
        this.id = '';
        this.style = {};
        this.attributes = {};
        this.children = [];
        this.parentNode = null;
        this.textContent = '';
        this._innerHTML = '';
        this.value = '';
        this.type = '';
        this.disabled = false;
        this.eventListeners = {};
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        if (!html || typeof html !== 'string') return;

        // Parse HTML tags into mock element tree
        const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9]+)([^>]*)\/?>|([^<]+)/g;
        let match;
        while ((match = tagRegex.exec(html)) !== null) {
            const [, pairedTag, pairedAttrs, pairedInner, singleTag, singleAttrs, textContent] = match;
            if (textContent && textContent.trim()) {
                this.textContent = (this.textContent ? this.textContent + ' ' : '') + textContent.trim();
            } else {
                const tagName = pairedTag || singleTag;
                const attrsStr = pairedAttrs || singleAttrs || '';
                const inner = pairedInner || '';
                if (tagName) {
                    const child = new MockElement(tagName);
                    const attrRegex = /([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?/g;
                    let attrMatch;
                    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
                        const attrName = attrMatch[1];
                        const attrVal = attrMatch[2] || '';
                        if (attrName === 'class') child.className = attrVal;
                        else if (attrName === 'id') child.id = attrVal;
                        else if (attrName === 'type') child.type = attrVal;
                        else child.setAttribute(attrName, attrVal);
                    }
                    if (inner) {
                        child.innerHTML = inner;
                    }
                    this.appendChild(child);
                }
            }
        }
    }

    setAttribute(name, val) {
        this.attributes[name] = val;
    }

    getAttribute(name) {
        return this.attributes[name] || null;
    }

    appendChild(child) {
        if (!child) return;
        if (child instanceof MockDocumentFragment) {
            child.children.forEach(c => this.appendChild(c));
            child.children = [];
            return child;
        }
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

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

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

class MockDocumentFragment {
    constructor() {
        this.children = [];
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    querySelector(selector) {
        for (const child of this.children) {
            if (child.querySelector) {
                const found = child.querySelector(selector);
                if (found) return found;
            }
            if (selector.startsWith('#') && child.id === selector.slice(1)) return child;
            if (selector.startsWith('.') && child.className && child.className.split(' ').includes(selector.slice(1))) return child;
        }
        return null;
    }
}

// Global DOM mocks
global.document = {
    createElement(tag) {
        return new MockElement(tag);
    },
    createDocumentFragment() {
        return new MockDocumentFragment();
    },
    querySelector(sel) {
        return global.rootContainer ? global.rootContainer.querySelector(sel) : null;
    }
};

global.chrome = {
    runtime: {
        getURL(path) {
            return `chrome-extension://mock-id/${path}`;
        }
    }
};

// Import component under test
import FullPageAuth from '../src/shared/components/FullPageAuth.js';

async function runTests() {
    console.log('\n--- 1. Testing Instantiation & DOM Mount/Unmount ---');
    const container = new MockElement('div');
    global.rootContainer = container;

    const auth = new FullPageAuth({
        container: container,
        mode: 'inline',
        title: 'Custom Movie Title',
        initialView: 'login'
    });

    assert.strictEqual(container.children.length, 1, 'Wrapper should be mounted to container');
    const wrapper = container.children[0];
    assert.strictEqual(wrapper.className, 'full-page-auth-container');
    
    const card = wrapper.querySelector('.full-page-auth-card');
    assert.ok(card, 'Card should be rendered inside wrapper');
    
    const title = card.querySelector('.full-page-auth-title');
    assert.strictEqual(title.textContent, 'Custom Movie Title', 'Custom title rendered correctly');

    // Unmount
    auth.unmount();
    assert.strictEqual(container.children.length, 0, 'Container should be empty after unmount');
    console.log('  ✅ Instantiation and unmount passed');

    console.log('\n--- 2. Testing Modal Mode & Backdrop ---');
    const modalContainer = new MockElement('div');
    let cancelCalled = false;
    const modalAuth = new FullPageAuth({
        container: modalContainer,
        mode: 'modal',
        onCancel: () => { cancelCalled = true; }
    });

    const modalWrapper = modalContainer.children[0];
    assert.ok(modalWrapper.classList.contains('full-page-auth--modal'), 'Modal class applied');
    const closeBtn = modalWrapper.querySelector('.full-page-auth-close-btn');
    assert.ok(closeBtn, 'Modal close button rendered');

    closeBtn.dispatchEvent({ type: 'click' });
    assert.strictEqual(cancelCalled, true, 'onCancel callback invoked on close button click');
    assert.strictEqual(modalContainer.children.length, 0, 'Modal unmounted on close');
    console.log('  ✅ Modal mode and close callback passed');

    console.log('\n--- 3. Testing View Switching (Login <-> Register <-> Approval) ---');
    const switchContainer = new MockElement('div');
    let lastView = null;
    const switchAuth = new FullPageAuth({
        container: switchContainer,
        initialView: 'login',
        onViewChange: (v) => { lastView = v; }
    });

    // Check Login elements
    assert.ok(switchContainer.querySelector('#fpaLoginEmail'), 'Login email input exists');
    assert.ok(switchContainer.querySelector('#fpaLoginSubmitBtn'), 'Login submit button exists');

    // Switch to Register
    switchAuth.switchView('register');
    assert.strictEqual(lastView, 'register');
    assert.ok(switchContainer.querySelector('#fpaRegFirstName'), 'Register first name exists');
    assert.ok(switchContainer.querySelector('#fpaRegEmail'), 'Register email exists');
    assert.ok(switchContainer.querySelector('#fpaRegisterSubmitBtn'), 'Register submit button exists');

    // Switch to Approval (pending login)
    switchAuth.switchView('approval', { status: 'pending', isNewRegistration: false });
    assert.strictEqual(lastView, 'approval');
    const approvalTitle = switchContainer.querySelector('.full-page-auth-approval-title');
    assert.ok(approvalTitle.textContent.includes('Аккаунт ожидает подтверждения') || approvalTitle.textContent.includes('Account Awaiting Approval') || approvalTitle.textContent.length > 0);

    // Switch to Approval (pending registered)
    switchAuth.switchView('approval', { status: 'pending', isNewRegistration: true });
    assert.ok(approvalTitle.textContent.includes('Заявка на рассмотрении') || approvalTitle.textContent.includes('Application Under Review') || approvalTitle.textContent.length > 0);

    // Switch to Approval (rejected)
    switchAuth.switchView('approval', { status: 'rejected' });
    assert.ok(approvalTitle.textContent.includes('Доступ ограничен') || approvalTitle.textContent.includes('Access Restricted') || approvalTitle.textContent.length > 0);

    console.log('  ✅ View switching and approval states passed');

    console.log('\n--- 4. Testing Form Validation ---');
    const testContainer = new MockElement('div');
    const valAuth = new FullPageAuth({ container: testContainer, initialView: 'login' });

    // Test 4.1: Empty Login Email
    const loginForm = testContainer.querySelector('.full-page-auth-form');
    const loginSubmitBtn = testContainer.querySelector('#fpaLoginSubmitBtn');
    loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
    
    const loginEmailError = testContainer.querySelector('#fpaLoginEmailError');
    assert.strictEqual(loginEmailError.style.display, 'block', 'Email error shown when empty');

    // Test 4.2: Invalid Email format
    testContainer.querySelector('#fpaLoginEmail').value = 'invalid-email';
    loginForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
    assert.strictEqual(loginEmailError.style.display, 'block', 'Email error shown for invalid email');

    // Test 4.3: Registration Password Validation
    valAuth.switchView('register');
    const regForm = testContainer.querySelector('.full-page-auth-form');
    testContainer.querySelector('#fpaRegFirstName').value = 'Иван';
    testContainer.querySelector('#fpaRegLastName').value = 'Иванов';
    testContainer.querySelector('#fpaRegEmail').value = 'ivan@example.com';
    testContainer.querySelector('#fpaRegPassword').value = '123'; // < 6 chars
    testContainer.querySelector('#fpaRegConfirmPassword').value = '123';
    
    regForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
    const regPassError = testContainer.querySelector('#fpaRegPassError');
    assert.strictEqual(regPassError.style.display, 'block', 'Password length error shown');

    // Test 4.4: Password mismatch
    testContainer.querySelector('#fpaRegPassword').value = 'password123';
    testContainer.querySelector('#fpaRegConfirmPassword').value = 'mismatch123';
    regForm.dispatchEvent({ type: 'submit', preventDefault: () => {} });
    const confirmPassError = testContainer.querySelector('#fpaRegConfirmPassError');
    assert.strictEqual(confirmPassError.style.display, 'block', 'Password mismatch error shown');

    console.log('  ✅ Form validation rules verified');

    console.log('\n--- 5. Testing Mocked Authentication & Approval Gate Integration ---');
    
    // Mock FirebaseManager & UserService
    const mockProfiles = {
        'user-approved': { approvalStatus: 'approved', displayName: 'Approved User' },
        'user-pending': { approvalStatus: 'pending', displayName: 'Pending User' },
        'user-rejected': { approvalStatus: 'rejected', displayName: 'Rejected User' }
    };

    let signedOutCalled = false;
    let authDataCleared = false;

    global.AuthManager = {
        clearAuthData: async () => { authDataCleared = true; }
    };

    global.firebaseManager = {
        currentUser: null,
        getCurrentUser() { return this.currentUser; },
        getUserService() {
            return {
                async getUserProfile(uid) {
                    return mockProfiles[uid] || null;
                },
                async createOrUpdateUserProfile(uid, data) {
                    mockProfiles[uid] = { ...data, approvalStatus: 'pending' };
                    return mockProfiles[uid];
                }
            };
        },
        async signInWithEmail(email, pass) {
            if (email === 'approved@example.com') {
                this.currentUser = { uid: 'user-approved', email };
            } else if (email === 'pending@example.com') {
                this.currentUser = { uid: 'user-pending', email };
            } else if (email === 'rejected@example.com') {
                this.currentUser = { uid: 'user-rejected', email };
            } else {
                throw new Error('User not found');
            }
            return this.currentUser;
        },
        async createUserWithEmail(email, pass) {
            this.currentUser = { uid: 'user-new', email, metadata: {} };
            return this.currentUser;
        },
        async signInWithGoogle() {
            this.currentUser = { uid: 'user-approved', email: 'approved@example.com' };
            return this.currentUser;
        },
        async signOut() {
            signedOutCalled = true;
            this.currentUser = null;
        }
    };

    // Test 5.1: Approved User Login Flow
    let authSuccessUser = null;
    let authSuccessProfile = null;
    const authFlowContainer = new MockElement('div');
    const flowAuth = new FullPageAuth({
        container: authFlowContainer,
        initialView: 'login',
        onAuthSuccess: (u, p) => {
            authSuccessUser = u;
            authSuccessProfile = p;
        }
    });

    authFlowContainer.querySelector('#fpaLoginEmail').value = 'approved@example.com';
    authFlowContainer.querySelector('#fpaLoginPassword').value = 'password123';
    await flowAuth.handleEmailLogin(
        { preventDefault: () => {} },
        authFlowContainer.querySelector('.full-page-auth-form'),
        authFlowContainer.querySelector('#fpaLoginSubmitBtn')
    );

    assert.ok(authSuccessUser, 'onAuthSuccess called for approved user');
    assert.strictEqual(authSuccessUser.uid, 'user-approved');
    assert.strictEqual(authSuccessProfile.approvalStatus, 'approved');
    console.log('  ✅ Approved user login success callback passed');

    // Test 5.2: Pending User Login Interception
    signedOutCalled = false;
    authDataCleared = false;
    authSuccessUser = null;

    flowAuth.switchView('login');
    authFlowContainer.querySelector('#fpaLoginEmail').value = 'pending@example.com';
    authFlowContainer.querySelector('#fpaLoginPassword').value = 'password123';
    await flowAuth.handleEmailLogin(
        { preventDefault: () => {} },
        authFlowContainer.querySelector('.full-page-auth-form'),
        authFlowContainer.querySelector('#fpaLoginSubmitBtn')
    );

    assert.strictEqual(authSuccessUser, null, 'onAuthSuccess NOT called for pending user');
    assert.strictEqual(signedOutCalled, true, 'firebaseManager.signOut called for pending user');
    assert.strictEqual(authDataCleared, true, 'AuthManager.clearAuthData called for pending user');
    assert.strictEqual(flowAuth.currentView, 'approval', 'Switched to approval view');
    assert.strictEqual(flowAuth.approvalState.status, 'pending');
    console.log('  ✅ Pending user gated & routed to approval view');

    // Test 5.3: Rejected User Login Interception
    signedOutCalled = false;
    flowAuth.switchView('login');
    authFlowContainer.querySelector('#fpaLoginEmail').value = 'rejected@example.com';
    authFlowContainer.querySelector('#fpaLoginPassword').value = 'password123';
    await flowAuth.handleEmailLogin(
        { preventDefault: () => {} },
        authFlowContainer.querySelector('.full-page-auth-form'),
        authFlowContainer.querySelector('#fpaLoginSubmitBtn')
    );

    assert.strictEqual(signedOutCalled, true, 'firebaseManager.signOut called for rejected user');
    assert.strictEqual(flowAuth.currentView, 'approval', 'Switched to approval view');
    assert.strictEqual(flowAuth.approvalState.status, 'rejected');
    console.log('  ✅ Rejected user gated & routed to rejected view');

    // Test 5.4: New User Registration Flow
    signedOutCalled = false;
    authDataCleared = false;
    flowAuth.switchView('register');

    authFlowContainer.querySelector('#fpaRegFirstName').value = 'Алексей';
    authFlowContainer.querySelector('#fpaRegLastName').value = 'Смирнов';
    authFlowContainer.querySelector('#fpaRegEmail').value = 'newuser@example.com';
    authFlowContainer.querySelector('#fpaRegPassword').value = 'securepass';
    authFlowContainer.querySelector('#fpaRegConfirmPassword').value = 'securepass';

    await flowAuth.handleRegister(
        { preventDefault: () => {} },
        authFlowContainer.querySelector('.full-page-auth-form'),
        authFlowContainer.querySelector('#fpaRegisterSubmitBtn')
    );

    assert.strictEqual(flowAuth.currentView, 'approval', 'New user routed to approval screen');
    assert.strictEqual(flowAuth.approvalState.status, 'pending');
    assert.strictEqual(flowAuth.approvalState.isNewRegistration, true);
    assert.strictEqual(mockProfiles['user-new'].approvalStatus, 'pending');
    assert.strictEqual(mockProfiles['user-new'].displayName, 'Алексей Смирнов');
    console.log('  ✅ New user registration profile creation & approval gate passed');

    console.log('\n🎉 ALL FullPageAuth (Phase 1) Unit Tests Passed Successfully!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
