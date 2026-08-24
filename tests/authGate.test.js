import assert from 'node:assert';

console.log('🧪 Running Auth Gate (Phase 2) Regression & Unit Tests...');

// Setup mock chrome API
global.chrome = {
    storage: {
        local: {
            store: {},
            async get(keys) {
                if (typeof keys === 'string') {
                    return { [keys]: this.store[keys] };
                }
                if (Array.isArray(keys)) {
                    const res = {};
                    keys.forEach(k => { res[k] = this.store[k]; });
                    return res;
                }
                return { ...this.store };
            },
            async set(items) {
                Object.assign(this.store, items);
            },
            async remove(keys) {
                const arr = Array.isArray(keys) ? keys : [keys];
                arr.forEach(k => delete this.store[k]);
            },
            async clear() {
                this.store = {};
            }
        }
    }
};

// Mock UserService & FirebaseManager
class MockUserService {
    constructor(userProfiles = {}) {
        this.profiles = userProfiles;
    }

    async getUserProfile(userId) {
        return this.profiles[userId] ? { ...this.profiles[userId] } : null;
    }

    async createOrUpdateUserProfile(userId, data) {
        if (!this.profiles[userId]) {
            this.profiles[userId] = {
                id: userId,
                approvalStatus: 'pending',
                ...data
            };
        } else {
            this.profiles[userId] = {
                ...this.profiles[userId],
                ...data
            };
        }
        return this.profiles[userId];
    }
}

// Logic harness matching PopupManager's Auth Gate
class AuthGateHarness {
    constructor(userService, initialAuthData = null) {
        this.userService = userService;
        this.signedOut = false;
        this.authCleared = false;
        this.lastBlockedStatus = null;
        this.lastIsNewRegistration = null;
        this.renderedScreen = null;
        this.activeUI = initialAuthData ? 'mainContent' : 'authSection';

        if (initialAuthData) {
            chrome.storage.local.store['user'] = initialAuthData.user;
            chrome.storage.local.store['authToken'] = initialAuthData.authToken || 'valid-token';
            chrome.storage.local.store['isAuthenticated'] = true;
        }
    }

    async signOut() {
        this.signedOut = true;
    }

    async clearAuthData() {
        this.authCleared = true;
        await chrome.storage.local.remove(['user', 'authToken', 'authTokenExpiry', 'isAuthenticated', 'refreshToken']);
    }

    showApprovalScreen({ status, isNewRegistration }) {
        this.renderedScreen = {
            view: 'approval',
            status,
            isNewRegistration,
            title: status === 'pending'
                ? (isNewRegistration ? 'Заявка на рассмотрении' : 'Аккаунт ожидает подтверждения')
                : 'Доступ ограничен',
            message: status === 'pending'
                ? (isNewRegistration
                    ? 'Ваш аккаунт успешно создан и ожидает подтверждения администратором. После одобрения вы получите полный доступ к расширению.'
                    : 'Ваша регистрация находится на рассмотрении у администратора. Доступ будет открыт сразу после проверки.')
                : 'Ваша регистрация была отклонена администратором.'
        };
    }

    async handleApprovalBlocked(status, isNewRegistration = false) {
        this.lastBlockedStatus = status;
        this.lastIsNewRegistration = isNewRegistration;
        await this.clearAuthData();
        await this.signOut();
        this.activeUI = 'authSection';
        this.showApprovalScreen({ status, isNewRegistration });
    }

    async validateUserApproval(userId, isNewRegistration = false) {
        if (!userId) return false;

        const profile = await this.userService.getUserProfile(userId);

        if (profile && profile.approvalStatus === 'pending') {
            await this.handleApprovalBlocked('pending', isNewRegistration);
            return false;
        }

        if (profile && profile.approvalStatus === 'rejected') {
            await this.handleApprovalBlocked('rejected', isNewRegistration);
            return false;
        }

        // approved OR missing field (legacy fallback) -> allow access
        return true;
    }

    async handleEmailLogin(userId) {
        const isApproved = await this.validateUserApproval(userId, false);
        if (!isApproved) {
            return false;
        }
        this.activeUI = 'mainContent';
        return true;
    }

    async handleRegisterFinal(userId, profileData) {
        await this.userService.createOrUpdateUserProfile(userId, profileData);
        const isApproved = await this.validateUserApproval(userId, true);
        if (!isApproved) {
            return false;
        }
        this.activeUI = 'mainContent';
        return true;
    }

    async handleGoogleLogin(userId, profileData) {
        const existingProfile = await this.userService.getUserProfile(userId);
        const isNewRegistration = !existingProfile;
        await this.userService.createOrUpdateUserProfile(userId, profileData);

        const isApproved = await this.validateUserApproval(userId, isNewRegistration);
        if (!isApproved) {
            return false;
        }
        this.activeUI = 'mainContent';
        return true;
    }

    async initializeUI(cachedUserId) {
        const auth = await chrome.storage.local.get(['user', 'authToken']);
        if (auth && auth.user) {
            const isApproved = await this.validateUserApproval(auth.user.uid, false);
            if (!isApproved) {
                return false;
            }
            this.activeUI = 'mainContent';
            return true;
        }
        if (cachedUserId) {
            const isApproved = await this.validateUserApproval(cachedUserId, false);
            if (!isApproved) {
                return false;
            }
            this.activeUI = 'mainContent';
            return true;
        }
        this.activeUI = 'authSection';
        return false;
    }
}

async function runTests() {
    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`  ✅ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ ${name}`);
            console.error(err);
            failed++;
        }
    }

    async function asyncTest(name, fn) {
        try {
            await fn();
            console.log(`  ✅ ${name}`);
            passed++;
        } catch (err) {
            console.error(`  ❌ ${name}`);
            console.error(err);
            failed++;
        }
    }

    console.log('\n--- State 1: Pending User Access Gate ---');
    await asyncTest('Pending user is blocked on email login and sees "Аккаунт ожидает подтверждения"', async () => {
        const userService = new MockUserService({
            'user-pending-1': { id: 'user-pending-1', approvalStatus: 'pending', email: 'pending@test.com' }
        });
        const harness = new AuthGateHarness(userService);

        const allowed = await harness.handleEmailLogin('user-pending-1');
        assert.strictEqual(allowed, false, 'Pending user must NOT be allowed in');
        assert.strictEqual(harness.lastBlockedStatus, 'pending');
        assert.strictEqual(harness.lastIsNewRegistration, false);
        assert.strictEqual(harness.renderedScreen.title, 'Аккаунт ожидает подтверждения');
        assert.strictEqual(harness.renderedScreen.message.includes('находится на рассмотрении'), true);
        assert.strictEqual(harness.authCleared, true);
        assert.strictEqual(harness.signedOut, true);
        assert.strictEqual(harness.activeUI, 'authSection');
    });

    await asyncTest('Newly registered user gets pending status and sees "Заявка на рассмотрении"', async () => {
        const userService = new MockUserService({});
        const harness = new AuthGateHarness(userService);

        const allowed = await harness.handleRegisterFinal('user-new-1', { email: 'new@test.com', displayName: 'New User' });
        assert.strictEqual(allowed, false, 'New registration with pending status must NOT enter mainContent');
        assert.strictEqual(harness.lastBlockedStatus, 'pending');
        assert.strictEqual(harness.lastIsNewRegistration, true);
        assert.strictEqual(harness.renderedScreen.title, 'Заявка на рассмотрении');
        assert.strictEqual(harness.renderedScreen.message.includes('успешно создан и ожидает подтверждения'), true);
    });

    console.log('\n--- State 2: Rejected User Access Gate ---');
    await asyncTest('Rejected user is blocked, signed out, and sees standard rejection notice without reason', async () => {
        const userService = new MockUserService({
            'user-rejected-1': { id: 'user-rejected-1', approvalStatus: 'rejected', email: 'bad@test.com' }
        });
        const harness = new AuthGateHarness(userService);

        const allowed = await harness.handleEmailLogin('user-rejected-1');
        assert.strictEqual(allowed, false, 'Rejected user must be blocked');
        assert.strictEqual(harness.lastBlockedStatus, 'rejected');
        assert.strictEqual(harness.renderedScreen.title, 'Доступ ограничен');
        assert.strictEqual(harness.renderedScreen.message, 'Ваша регистрация была отклонена администратором.');
        assert.strictEqual(harness.authCleared, true);
        assert.strictEqual(harness.signedOut, true);
    });

    console.log('\n--- State 3: Approved User Access Gate ---');
    await asyncTest('Approved user is allowed full access to mainContent', async () => {
        const userService = new MockUserService({
            'user-approved-1': { id: 'user-approved-1', approvalStatus: 'approved', email: 'good@test.com' }
        });
        const harness = new AuthGateHarness(userService);

        const allowed = await harness.handleEmailLogin('user-approved-1');
        assert.strictEqual(allowed, true, 'Approved user must be granted access');
        assert.strictEqual(harness.lastBlockedStatus, null);
        assert.strictEqual(harness.activeUI, 'mainContent');
    });

    console.log('\n--- State 4: Missing-field Legacy Fallback ---');
    await asyncTest('Legacy user without approvalStatus field is allowed access (fallback)', async () => {
        const userService = new MockUserService({
            'user-legacy-1': { id: 'user-legacy-1', email: 'legacy@test.com' } // no approvalStatus
        });
        const harness = new AuthGateHarness(userService);

        const allowed = await harness.handleEmailLogin('user-legacy-1');
        assert.strictEqual(allowed, true, 'Legacy user without approvalStatus field must be allowed access');
        assert.strictEqual(harness.lastBlockedStatus, null);
        assert.strictEqual(harness.activeUI, 'mainContent');
    });

    console.log('\n--- State 5: Session Restoration with Changed Status ---');
    await asyncTest('Cached session is immediately revoked if admin changes status to rejected', async () => {
        const userService = new MockUserService({
            'user-session-1': { id: 'user-session-1', approvalStatus: 'rejected', email: 'session@test.com' }
        });
        // Initial state: user has stored auth data in chrome.storage.local
        const harness = new AuthGateHarness(userService, {
            user: { uid: 'user-session-1', email: 'session@test.com' },
            authToken: 'cached-jwt-token'
        });

        assert.strictEqual(harness.activeUI, 'mainContent');
        const restored = await harness.initializeUI('user-session-1');

        assert.strictEqual(restored, false, 'Restoration must fail when status is rejected in Firestore');
        assert.strictEqual(harness.activeUI, 'authSection');
        assert.strictEqual(harness.lastBlockedStatus, 'rejected');
        assert.strictEqual(harness.renderedScreen.message, 'Ваша регистрация была отклонена администратором.');
        
        // Verify storage was purged
        const storedUser = await chrome.storage.local.get('user');
        assert.strictEqual(storedUser.user, undefined, 'Cached user must be deleted from storage');
    });

    await asyncTest('Cached session is immediately revoked if admin changes status to pending', async () => {
        const userService = new MockUserService({
            'user-session-2': { id: 'user-session-2', approvalStatus: 'pending', email: 'session2@test.com' }
        });
        const harness = new AuthGateHarness(userService, {
            user: { uid: 'user-session-2', email: 'session2@test.com' },
            authToken: 'cached-jwt-token'
        });

        const restored = await harness.initializeUI('user-session-2');
        assert.strictEqual(restored, false);
        assert.strictEqual(harness.activeUI, 'authSection');
        assert.strictEqual(harness.lastBlockedStatus, 'pending');
        assert.strictEqual(harness.renderedScreen.title, 'Аккаунт ожидает подтверждения');
    });

    await asyncTest('Cached session is preserved and allowed if status is approved', async () => {
        const userService = new MockUserService({
            'user-session-3': { id: 'user-session-3', approvalStatus: 'approved', email: 'session3@test.com' }
        });
        const harness = new AuthGateHarness(userService, {
            user: { uid: 'user-session-3', email: 'session3@test.com' },
            authToken: 'cached-jwt-token'
        });

        const restored = await harness.initializeUI('user-session-3');
        assert.strictEqual(restored, true);
        assert.strictEqual(harness.activeUI, 'mainContent');
    });

    console.log('\n--- State 6: Google Sign-In Gate ---');
    await asyncTest('New Google user is created with pending status and blocked at gate', async () => {
        const userService = new MockUserService({});
        const harness = new AuthGateHarness(userService);

        const allowed = await harness.handleGoogleLogin('google-user-1', {
            displayName: 'Google User',
            email: 'google@gmail.com'
        });

        assert.strictEqual(allowed, false, 'New Google user must NOT bypass approval');
        assert.strictEqual(harness.lastBlockedStatus, 'pending');
        assert.strictEqual(harness.lastIsNewRegistration, true);
        assert.strictEqual(harness.renderedScreen.title, 'Заявка на рассмотрении');
    });

    await asyncTest('Existing approved Google user signs in successfully', async () => {
        const userService = new MockUserService({
            'google-user-2': { id: 'google-user-2', approvalStatus: 'approved', email: 'g2@gmail.com' }
        });
        const harness = new AuthGateHarness(userService);

        const allowed = await harness.handleGoogleLogin('google-user-2', {
            displayName: 'Google User 2',
            email: 'g2@gmail.com'
        });

        assert.strictEqual(allowed, true, 'Approved Google user is allowed');
        assert.strictEqual(harness.activeUI, 'mainContent');
    });

    console.log('\n--- State 7: Firestore Security Rules Self-Update Restrictions ---');
    // Function that mirrors exact Firestore security rule logic:
    // allow update: if isOwner(userId) && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['isAdmin', 'approvalStatus']);
    // allow update: if isAdmin();
    function evaluateUserUpdateRule({ authUid, targetUserId, userDocData, updatePayload, isCallerAdmin }) {
        if (!authUid) return false;
        if (isCallerAdmin) return true; // allow update: if isAdmin();

        const isOwner = authUid === targetUserId;
        if (!isOwner) return false;

        const mergedResourceData = { ...userDocData, ...updatePayload };
        
        // Calculate affected keys between old resource.data and new request.resource.data
        const affectedKeys = [];
        const allKeys = new Set([...Object.keys(userDocData), ...Object.keys(mergedResourceData)]);
        for (const k of allKeys) {
            if (userDocData[k] !== mergedResourceData[k]) {
                affectedKeys.push(k);
            }
        }

        const touchesProtectedFields = affectedKeys.some(k => ['isAdmin', 'approvalStatus'].includes(k));
        return !touchesProtectedFields;
    }

    test('Regular user cannot update ONLY isAdmin to true', () => {
        const userDoc = { id: 'u1', displayName: 'Regular User', approvalStatus: 'approved', isAdmin: false };
        const allowed = evaluateUserUpdateRule({
            authUid: 'u1',
            targetUserId: 'u1',
            userDocData: userDoc,
            updatePayload: { isAdmin: true },
            isCallerAdmin: false
        });
        assert.strictEqual(allowed, false, 'Self-updating only isAdmin MUST be rejected');
    });

    test('Regular user cannot update ONLY approvalStatus to approved', () => {
        const userDoc = { id: 'u2', displayName: 'Pending User', approvalStatus: 'pending', isAdmin: false };
        const allowed = evaluateUserUpdateRule({
            authUid: 'u2',
            targetUserId: 'u2',
            userDocData: userDoc,
            updatePayload: { approvalStatus: 'approved' },
            isCallerAdmin: false
        });
        assert.strictEqual(allowed, false, 'Self-updating only approvalStatus MUST be rejected');
    });

    test('Regular user cannot update BOTH isAdmin and approvalStatus in a single request', () => {
        const userDoc = { id: 'u3', displayName: 'User', approvalStatus: 'pending', isAdmin: false };
        const allowed = evaluateUserUpdateRule({
            authUid: 'u3',
            targetUserId: 'u3',
            userDocData: userDoc,
            updatePayload: { isAdmin: true, approvalStatus: 'approved' },
            isCallerAdmin: false
        });
        assert.strictEqual(allowed, false, 'Combined privilege escalation MUST be rejected');
    });

    test('Regular user CAN update allowed profile fields (displayName, bio, preferences)', () => {
        const userDoc = { id: 'u4', displayName: 'Old Name', bio: 'Old bio', approvalStatus: 'approved', isAdmin: false };
        const allowed = evaluateUserUpdateRule({
            authUid: 'u4',
            targetUserId: 'u4',
            userDocData: userDoc,
            updatePayload: { displayName: 'New Name', bio: 'Updated bio' },
            isCallerAdmin: false
        });
        assert.strictEqual(allowed, true, 'Regular profile updates MUST be allowed');
    });

    test('Admin user CAN modify approvalStatus and isAdmin on any user document', () => {
        const userDoc = { id: 'u5', displayName: 'Target User', approvalStatus: 'pending', isAdmin: false };
        const allowed = evaluateUserUpdateRule({
            authUid: 'admin-1',
            targetUserId: 'u5',
            userDocData: userDoc,
            updatePayload: { approvalStatus: 'approved', isAdmin: true },
            isCallerAdmin: true
        });
        assert.strictEqual(allowed, true, 'Admin updates MUST be permitted without restriction');
    });

    console.log(`\n📊 Tests complete: ${passed} passed, ${failed} failed.`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
