const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

module.exports = {
    ROOT,
    // The tests load the same dist/ that release packaging uses, unmodified.
    EXTENSION_PATH: path.join(ROOT, 'dist'),
    OUTPUT_DIR: path.join(ROOT, '.e2e-output'),
    // A "demo-" project can only ever reach emulators: firebase-tools refuses
    // to touch real resources for it.
    PROJECT_ID: 'demo-movielist-e2e',
    AUTH_ORIGIN: 'http://127.0.0.1:9199',
    FIRESTORE_HOST: '127.0.0.1',
    FIRESTORE_PORT: 8180,
    FIRESTORE_ORIGIN: 'http://127.0.0.1:8180',
    // Pages see this date, so release badges and seasonal decor (the Halloween
    // window, for one) do not change the screenshots from one day to the next.
    PINNED_DATE: '2026-06-15T12:00:00+03:00',
    TIMEZONE: 'Europe/Moscow',
    VIEWPORT: { width: 1440, height: 900 },
    TEST_USER: {
        uid: 'e2e-user-1',
        email: 'e2e-viewer@example.test',
        password: 'e2e-password-1',
        displayName: 'E2E Viewer'
    }
};
