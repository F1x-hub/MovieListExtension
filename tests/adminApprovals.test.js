import assert from 'node:assert';
import AdminService from '../src/shared/services/AdminService.js';

console.log('🧪 Running Admin Approvals & User Status Management Unit Tests...');

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

    async commit() {
        for (const op of this.operations) {
            if (op.type === 'update') {
                await op.docRef.update(op.data);
            }
        }
        this.operations = [];
    }
}

class MockQuery {
    constructor(collection, filters = []) {
        this.collection = collection;
        this.filters = filters;
    }

    where(field, op, value) {
        return new MockQuery(this.collection, [...this.filters, { field, op, value }]);
    }

    async get() {
        let results = [];
        this.collection.store.forEach((data, id) => {
            let match = true;
            for (const f of this.filters) {
                if (f.op === '==' && data[f.field] !== f.value) {
                    match = false;
                    break;
                }
            }
            if (match) {
                results.push({
                    id,
                    data: () => ({ ...data })
                });
            }
        });

        return {
            size: results.length,
            docs: results,
            empty: results.length === 0
        };
    }

    count() {
        return {
            get: async () => {
                const res = await this.get();
                return {
                    data: () => ({ count: res.size })
                };
            }
        };
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

    where(field, op, value) {
        return new MockQuery(this, [{ field, op, value }]);
    }

    async get() {
        const query = new MockQuery(this);
        return query.get();
    }
}

class MockFirestore {
    constructor() {
        this.collections = new Map();
    }

    collection(name) {
        if (!this.collections.has(name)) {
            this.collections.set(name, new Map());
        }
        return new MockCollectionRef(name, this.collections.get(name));
    }

    batch() {
        const usersStore = this.collections.get('users') || new Map();
        return new MockBatch(usersStore);
    }
}

async function runTests() {
    const mockDb = new MockFirestore();
    const usersStore = mockDb.collections.get('users') || new Map();
    mockDb.collections.set('users', usersStore);

    // Populate initial state
    usersStore.set('admin-1', { id: 'admin-1', email: 'admin@test.com', isAdmin: true, approvalStatus: 'approved' });
    usersStore.set('regular-1', { id: 'regular-1', email: 'reg@test.com', isAdmin: false, approvalStatus: 'approved' });
    usersStore.set('pending-1', { id: 'pending-1', email: 'p1@test.com', displayName: 'Pending One', approvalStatus: 'pending', createdAt: new Date(1000) });
    usersStore.set('pending-2', { id: 'pending-2', email: 'p2@test.com', displayName: 'Pending Two', approvalStatus: 'pending', createdAt: new Date(2000) });
    usersStore.set('pending-3', { id: 'pending-3', email: 'p3@test.com', displayName: 'Pending Three', approvalStatus: 'pending', createdAt: new Date(3000) });
    usersStore.set('rejected-1', { id: 'rejected-1', email: 'r1@test.com', approvalStatus: 'rejected' });

    const adminService = new AdminService({
        db: mockDb,
        getMovieCacheService: () => ({})
    });

    console.log('\n--- 1. Testing Pending Approvals Retrieval & Count ---');
    const pendingList = await adminService.getPendingApprovals();
    assert.strictEqual(pendingList.length, 3, 'Should find 3 pending users');
    assert.strictEqual(pendingList[0].id, 'pending-3', 'Should sort newest first');
    assert.strictEqual(pendingList[2].id, 'pending-1', 'Should have oldest last');

    const pendingCount = await adminService.getPendingApprovalsCount();
    assert.strictEqual(pendingCount, 3, 'Count should match pending list length');
    console.log('✅ Pending queue retrieval & sorting passed');

    console.log('\n--- 2. Testing Single Approval ---');
    await adminService.updateUserApprovalStatus('pending-1', 'approved', 'admin-1');
    const approvedDoc = usersStore.get('pending-1');
    assert.strictEqual(approvedDoc.approvalStatus, 'approved');
    assert.ok(approvedDoc.approvalUpdatedAt, 'approvalUpdatedAt must be set');
    console.log('✅ Single approval passed');

    console.log('\n--- 3. Testing Single Rejection ---');
    await adminService.updateUserApprovalStatus('pending-2', 'rejected', 'admin-1');
    const rejectedDoc = usersStore.get('pending-2');
    assert.strictEqual(rejectedDoc.approvalStatus, 'rejected');
    console.log('✅ Single rejection passed');

    console.log('\n--- 4. Testing Batch Approval ---');
    usersStore.set('bulk-1', { id: 'bulk-1', approvalStatus: 'pending' });
    usersStore.set('bulk-2', { id: 'bulk-2', approvalStatus: 'pending' });
    const batchResult = await adminService.batchUpdateUserApprovalStatus(['pending-3', 'bulk-1', 'bulk-2'], 'approved', 'admin-1');
    assert.strictEqual(batchResult.updated, 3);
    assert.strictEqual(usersStore.get('pending-3').approvalStatus, 'approved');
    assert.strictEqual(usersStore.get('bulk-1').approvalStatus, 'approved');
    assert.strictEqual(usersStore.get('bulk-2').approvalStatus, 'approved');
    console.log('✅ Batch approval passed');

    console.log('\n--- 5. Testing Soft-Block (Approved -> Rejected) & Unblock (Rejected -> Approved) ---');
    // Block approved user
    await adminService.updateUserApprovalStatus('regular-1', 'rejected', 'admin-1');
    assert.strictEqual(usersStore.get('regular-1').approvalStatus, 'rejected', 'User must be soft-blocked');

    // Unblock rejected user
    await adminService.updateUserApprovalStatus('regular-1', 'approved', 'admin-1');
    assert.strictEqual(usersStore.get('regular-1').approvalStatus, 'approved', 'User must be unblocked');

    // Revert to pending
    await adminService.updateUserApprovalStatus('regular-1', 'pending', 'admin-1');
    assert.strictEqual(usersStore.get('regular-1').approvalStatus, 'pending', 'User must be reverted to pending');
    console.log('✅ Reversible transitions (block/unblock/pending) passed');

    console.log('\n--- 6. Testing Admin Authorization Security Check ---');
    let threwUnauthorized = false;
    try {
        await adminService.updateUserApprovalStatus('regular-1', 'approved', 'regular-1');
    } catch {
        threwUnauthorized = true;
    }
    assert.strictEqual(threwUnauthorized, true, 'Non-admin caller must throw Unauthorized');
    console.log('✅ Admin authorization verification passed');

    console.log('\n🎉 ALL Admin Approvals Unit Tests Passed Successfully!\n');
}

runTests().catch(err => {
    console.error('❌ Tests failed:', err);
    process.exit(1);
});
