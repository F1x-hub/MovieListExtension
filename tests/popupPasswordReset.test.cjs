const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/shared/firestore.js'), 'utf8');
const context = vm.createContext({ window: { firebaseManager: {} }, setTimeout() {} });
vm.runInContext(`${source}\nglobalThis.FirebaseManagerForTest = FirebaseManager;`, context);

(async () => {
    const manager = Object.create(context.FirebaseManagerForTest.prototype);
    let receivedEmail = null;
    manager.isInitialized = true;
    manager.auth = { currentUser: null, sendPasswordResetEmail: async email => { receivedEmail = email; } };
    await manager.sendPasswordResetEmail('viewer@example.test');
    assert.equal(receivedEmail, 'viewer@example.test', 'anonymous reset uses the existing compat Auth method');

    const failure = Object.assign(new Error('SDK private diagnostic'), { code: 'auth/network-request-failed' });
    manager.auth.sendPasswordResetEmail = async () => { throw failure; };
    await assert.rejects(manager.sendPasswordResetEmail('viewer@example.test'), error => error === failure, 'the UI can normalize the original SDK error');

    manager.isInitialized = false;
    await assert.rejects(manager.sendPasswordResetEmail('viewer@example.test'), /Firebase not initialized/);
    manager.isInitialized = true;
    manager.auth = null;
    await assert.rejects(manager.sendPasswordResetEmail('viewer@example.test'), /Firebase not initialized/);
    console.log('Popup password-reset service regressions passed (mock SDK only)');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
