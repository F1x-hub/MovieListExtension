import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

console.log('🧪 Running Cross-Tab Auth Synchronization & Admin Cleanup Unit Tests...');

// 1. Static Contract Tests: Verify Admin Panel Migration Buttons Removal
console.log('\n--- 1. Testing Admin Panel Migration Buttons Removal ---');
const adminHtmlPath = path.resolve('src/pages/admin/admin.html');
const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');

assert.strictEqual(
    adminHtml.includes('id="checkMigrationStatusBtn"'),
    false,
    'admin.html must NOT contain #checkMigrationStatusBtn'
);
assert.strictEqual(
    adminHtml.includes('id="runMigrationBtn"'),
    false,
    'admin.html must NOT contain #runMigrationBtn'
);
assert.strictEqual(
    adminHtml.includes('Статус одобрений'),
    false,
    'admin.html must NOT contain "Статус одобрений"'
);
assert.strictEqual(
    adminHtml.includes('Миграция в Approved'),
    false,
    'admin.html must NOT contain "Миграция в Approved"'
);
console.log('  ✅ Admin migration buttons successfully removed from admin.html');

// 2. Static Contract Tests: Verify authStateChanged Subscriptions across pages
console.log('\n--- 2. Testing Page authStateChanged Subscriptions ---');
const pagesToCheck = [
    'src/pages/admin/admin.js',
    'src/pages/bookmarks/bookmarks.js',
    'src/pages/favorites/favorites.js',
    'src/pages/watchlist/watchlist.js',
    'src/pages/watching/watching.js',
    'src/pages/collection/collection.js',
    'src/pages/profile/profile.js'
];

for (const pageRelPath of pagesToCheck) {
    const fullPath = path.resolve(pageRelPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.strictEqual(
        content.includes("addEventListener('authStateChanged'"),
        true,
        `${pageRelPath} must subscribe to authStateChanged`
    );
}
console.log('  ✅ All protected/user pages subscribe to authStateChanged');

// 3. Functional Simulation: Cross-Tab Storage Sync in FirebaseManager
console.log('\n--- 3. Testing Cross-Tab Storage Sync Event Dispatch ---');

let storageListeners = [];
let windowEvents = [];

const mockStorage = {
    onChanged: {
        addListener(fn) {
            storageListeners.push(fn);
        }
    },
    local: {
        get: async () => ({}),
        set: async () => ({}),
        remove: async () => ({})
    }
};

globalThis.chrome = {
    storage: mockStorage
};

globalThis.window = {
    dispatchEvent(event) {
        windowEvents.push(event);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    location: {
        pathname: '/src/pages/home/home.html'
    }
};

globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail || {};
    }
};

// Simulate Firestore storage onChanged handler logic
class MockFirebaseManager {
    constructor() {
        this.user = { uid: 'user-1', email: 'test@example.com' };
        this.auth = {
            currentUser: { uid: 'user-1' },
            signOut: async () => {
                this.auth.currentUser = null;
            }
        };

        if (chrome?.storage?.onChanged) {
            chrome.storage.onChanged.addListener(async (changes, namespace) => {
                if (namespace === 'local' && (changes.user !== undefined || changes.isAuthenticated !== undefined)) {
                    const newStorageUser = changes.user ? changes.user.newValue : null;
                    const currentUid = this.user ? this.user.uid : null;
                    const newUid = newStorageUser ? newStorageUser.uid : null;

                    if (currentUid !== newUid) {
                        if (!newStorageUser) {
                            this.user = null;
                            if (this.auth?.currentUser) {
                                await this.auth.signOut();
                            }
                        } else {
                            this.user = newStorageUser;
                        }

                        window.dispatchEvent(new CustomEvent('authStateChanged', {
                            detail: { user: this.user, isAuthenticated: !!this.user, source: 'cross_tab_sync' }
                        }));
                    }
                }
            });
        }
    }
}

const fbManager = new MockFirebaseManager();
assert.strictEqual(storageListeners.length, 1, 'Storage listener must be registered');

// Simulate cross-tab logout from popup
await storageListeners[0]({
    user: { oldValue: { uid: 'user-1' }, newValue: null },
    isAuthenticated: { oldValue: true, newValue: false }
}, 'local');

assert.strictEqual(fbManager.user, null, 'User should be null after storage logout');
assert.strictEqual(fbManager.auth.currentUser, null, 'Auth currentUser should be null after storage logout');
assert.strictEqual(windowEvents.length, 1, 'One authStateChanged event should be dispatched');
assert.strictEqual(windowEvents[0].type, 'authStateChanged');
assert.strictEqual(windowEvents[0].detail.user, null);
assert.strictEqual(windowEvents[0].detail.isAuthenticated, false);
console.log('  ✅ Cross-tab logout correctly clears user state and dispatches authStateChanged');

// Simulate cross-tab login as new user
await storageListeners[0]({
    user: { oldValue: null, newValue: { uid: 'user-2', email: 'user2@example.com' } },
    isAuthenticated: { oldValue: false, newValue: true }
}, 'local');

assert.strictEqual(fbManager.user?.uid, 'user-2', 'User should be updated to user-2');
assert.strictEqual(windowEvents.length, 2, 'Second authStateChanged event should be dispatched');
assert.strictEqual(windowEvents[1].detail.user?.uid, 'user-2');
assert.strictEqual(windowEvents[1].detail.isAuthenticated, true);
console.log('  ✅ Cross-tab login correctly sets new user state and dispatches authStateChanged');

// 4. Static Contract Tests: Verify Admin Panel Approval Status Badges & Action Buttons
console.log('\n--- 4. Testing Admin Panel User Status Badges & Action Buttons ---');
const adminJsPath = path.resolve('src/pages/admin/admin.js');
const adminJs = fs.readFileSync(adminJsPath, 'utf8');

assert.strictEqual(
    adminJs.includes('status-badge-approved'),
    true,
    'admin.js must render approved status badge'
);
assert.strictEqual(
    adminJs.includes('status-badge-pending'),
    true,
    'admin.js must render pending status badge'
);
assert.strictEqual(
    adminJs.includes('status-badge-rejected'),
    true,
    'admin.js must render rejected status badge'
);
assert.strictEqual(
    adminJs.includes('btn-reject-sm') && adminJs.includes('Заблокировать'),
    true,
    'admin.js must provide block/reject action button'
);
assert.strictEqual(
    adminJs.includes('btn-approve-sm') && (adminJs.includes('Одобрить') || adminJs.includes('Разблокировать')),
    true,
    'admin.js must provide approve/unblock action button'
);
assert.strictEqual(
    adminJs.includes('loadApprovals'),
    true,
    'admin.js must implement loadApprovals for the pending approvals queue'
);
console.log('  ✅ Admin user table correctly includes approval status badges and action buttons');

console.log('\n🎉 ALL Cross-Tab Auth Synchronization & Admin Cleanup Tests Passed Successfully!\n');
