import assert from 'node:assert';
import UserService from '../src/shared/services/UserService.js';
import MigrationTool from '../src/shared/utils/MigrationTool.js';

console.log('🧪 Running User Approval & Migration Unit Tests...');

// Mock Firestore Implementation for testing
class MockDocRef {
    constructor(collection, id, store) {
        this.collection = collection;
        this.id = id;
        this.store = store;
    }

    async get() {
        const data = this.store.get(this.id);
        return {
            id: this.id,
            exists: !!data,
            data: () => data ? { ...data } : undefined
        };
    }

    async set(data) {
        this.store.set(this.id, { ...data });
        return true;
    }

    async update(data) {
        const existing = this.store.get(this.id);
        if (!existing) {
            throw new Error(`Doc ${this.id} does not exist`);
        }
        this.store.set(this.id, { ...existing, ...data });
        return true;
    }
}

class MockBatch {
    constructor(store) {
        this.store = store;
        this.operations = [];
    }

    update(docRef, data) {
        this.operations.push({ type: 'update', docRef, data });
    }

    set(docRef, data, options = {}) {
        this.operations.push({ type: 'set', docRef, data, options });
    }

    async commit() {
        for (const op of this.operations) {
            if (op.type === 'update') {
                await op.docRef.update(op.data);
            } else if (op.type === 'set') {
                if (op.options && op.options.merge) {
                    const existing = this.store.get(op.docRef.id) || {};
                    this.store.set(op.docRef.id, { ...existing, ...op.data });
                } else {
                    this.store.set(op.docRef.id, { ...op.data });
                }
            }
        }
        this.operations = [];
    }
}

class MockCollectionRef {
    constructor(name, store) {
        this.name = name;
        this.store = store;
    }

    doc(id) {
        return new MockDocRef(this, id, this.store);
    }

    async get() {
        const docs = [];
        this.store.forEach((value, key) => {
            docs.push({
                id: key,
                data: () => ({ ...value })
            });
        });
        return {
            size: docs.length,
            empty: docs.length === 0,
            docs,
            forEach: (cb) => docs.forEach(cb)
        };
    }
}

class MockFirestore {
    constructor() {
        this.collections = new Map();
    }

    getStore(name) {
        if (!this.collections.has(name)) {
            this.collections.set(name, new Map());
        }
        return this.collections.get(name);
    }

    collection(name) {
        return new MockCollectionRef(name, this.getStore(name));
    }

    batch() {
        return new MockBatch(this.getStore('users'));
    }
}

// -------------------------------------------------------------
// Test Suite 1: UserService Profile Creation & Update Behavior
// -------------------------------------------------------------
(async () => {
    const mockDb = new MockFirestore();
    const mockFirebaseManager = { db: mockDb };
    const userService = new UserService(mockFirebaseManager);

    // 1. Create a NEW user profile
    const newProfile = await userService.createOrUpdateUserProfile('user_new_1', {
        displayName: 'New Candidate',
        email: 'candidate@example.com'
    });

    assert.strictEqual(newProfile.approvalStatus, 'pending', 'Newly created user profile must default to approvalStatus: "pending"');

    const storedNewDoc = await mockDb.collection('users').doc('user_new_1').get();
    assert.strictEqual(storedNewDoc.data().approvalStatus, 'pending', 'Firestore document must contain approvalStatus: "pending"');

    // 2. Update the existing user profile (e.g. bio or displayName)
    const updatedProfile = await userService.createOrUpdateUserProfile('user_new_1', {
        displayName: 'New Candidate Updated',
        bio: 'Updated Bio'
    });

    assert.strictEqual(updatedProfile.approvalStatus, 'pending', 'Updating existing profile must preserve pending status');
    assert.strictEqual(updatedProfile.displayName, 'New Candidate Updated', 'DisplayName should be updated');

    // 3. User with manually approved status should not lose approved status on normal profile sync
    mockDb.getStore('users').set('user_approved_1', {
        displayName: 'Approved Person',
        email: 'approved@example.com',
        approvalStatus: 'approved'
    });

    const syncedApprovedProfile = await userService.createOrUpdateUserProfile('user_approved_1', {
        displayName: 'Approved Person Renamed',
        email: 'approved@example.com'
    });

    assert.strictEqual(syncedApprovedProfile.approvalStatus, 'approved', 'createOrUpdateUserProfile must NOT overwrite existing approvalStatus');

    console.log('✅ UserService createOrUpdateUserProfile tests passed!');
})();

// -------------------------------------------------------------
// Test Suite 2: MigrationTool Approval Migration & Inspection
// -------------------------------------------------------------
(async () => {
    const mockDb = new MockFirestore();
    const mockFirebaseManager = { db: mockDb };
    const migrationTool = new MigrationTool(mockFirebaseManager);
    migrationTool.displayLog = false;

    // Seed mock database with a mixture of users:
    // - 2 legacy users (no approvalStatus)
    // - 1 pending user
    // - 1 rejected user
    // - 1 already approved user
    const usersStore = mockDb.getStore('users');
    usersStore.set('legacy_1', { displayName: 'Legacy User 1', email: 'legacy1@example.com' });
    usersStore.set('legacy_2', { displayName: 'Legacy User 2', email: 'legacy2@example.com', approvalStatus: null });
    usersStore.set('pending_1', { displayName: 'Pending User', email: 'pending@example.com', approvalStatus: 'pending' });
    usersStore.set('rejected_1', { displayName: 'Rejected User', email: 'rejected@example.com', approvalStatus: 'rejected' });
    usersStore.set('approved_1', { displayName: 'Approved User', email: 'approved@example.com', approvalStatus: 'approved' });

    // 1. Check initial stats
    const initialStats = await migrationTool.getUserApprovalStats();
    assert.strictEqual(initialStats.total, 5, 'Total users should be 5');
    assert.strictEqual(initialStats.approved, 1, 'Initially approved should be 1');
    assert.strictEqual(initialStats.pending, 1, 'Initially pending should be 1');
    assert.strictEqual(initialStats.rejected, 1, 'Initially rejected should be 1');
    assert.strictEqual(initialStats.unmigrated, 2, 'Unmigrated should be 2');

    // 2. Run Dry Run
    const dryRunResult = await migrationTool.migrateUserApprovalStatuses(true);
    assert.strictEqual(dryRunResult.dryRun, true, 'Dry run flag should be true');
    assert.strictEqual(dryRunResult.needsMigration, 2, 'Dry run should find 2 unmigrated users');
    // Ensure DB was not modified
    assert.strictEqual(usersStore.get('legacy_1').approvalStatus, undefined, 'Dry run must not modify documents');

    // 3. Run Live Migration
    const liveResult = await migrationTool.migrateUserApprovalStatuses(false);
    assert.strictEqual(liveResult.dryRun, false, 'Live run flag should be false');
    assert.strictEqual(liveResult.migratedCount, 2, 'Live migration should migrate 2 users');
    assert.strictEqual(liveResult.status, 'success', 'Migration status should be success');

    // Verify statuses in store
    assert.strictEqual(usersStore.get('legacy_1').approvalStatus, 'approved', 'Legacy 1 should now be approved');
    assert.strictEqual(usersStore.get('legacy_2').approvalStatus, 'approved', 'Legacy 2 should now be approved');
    assert.strictEqual(usersStore.get('pending_1').approvalStatus, 'pending', 'Pending user must NOT be changed');
    assert.strictEqual(usersStore.get('rejected_1').approvalStatus, 'rejected', 'Rejected user must NOT be changed');
    assert.strictEqual(usersStore.get('approved_1').approvalStatus, 'approved', 'Previously approved user must NOT be changed');

    // 4. Verify post-migration stats
    const postStats = await migrationTool.getUserApprovalStats();
    assert.strictEqual(postStats.total, 5);
    assert.strictEqual(postStats.approved, 3, 'Approved should now be 3');
    assert.strictEqual(postStats.pending, 1, 'Pending should remain 1');
    assert.strictEqual(postStats.rejected, 1, 'Rejected should remain 1');
    assert.strictEqual(postStats.unmigrated, 0, 'Unmigrated should be 0');

    // 5. Test Idempotency: re-running migration on already migrated store
    const rerunResult = await migrationTool.migrateUserApprovalStatuses(false);
    assert.strictEqual(rerunResult.migratedCount, 0, 'Re-run should migrate 0 users');
    assert.strictEqual(rerunResult.status, 'already_up_to_date', 'Re-run should indicate already_up_to_date');

    console.log('✅ MigrationTool approval migration & inspection tests passed!');
})();
