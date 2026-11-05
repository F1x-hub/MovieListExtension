#!/usr/bin/env node
/**
 * Builds the extension, starts the Firebase emulators and runs the browser
 * specs inside them. Arguments are passed to Playwright, plus:
 *   --no-build   reuse the existing dist/
 *   --headed     open a visible browser (real GPU timing)
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT, EXTENSION_PATH, PROJECT_ID } = require('./lib/config.cjs');

const REQUIRED_JAVA = 21;

function javaMajorVersion(javaHome) {
    const executable = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (!fs.existsSync(executable)) return 0;
    const { stderr = '' } = spawnSync(executable, ['-version'], { encoding: 'utf8' });
    return Number(/version "(\d+)/.exec(stderr)?.[1]) || 0;
}

function childDirectories(parent) {
    try {
        return fs.readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(parent, entry.name));
    } catch {
        return [];
    }
}

/** The system Java is left alone: a newer JDK is used for this process only. */
function findJavaHome() {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const home = os.homedir();
    const candidates = [
        process.env.E2E_JAVA_HOME,
        process.env.JAVA_HOME,
        path.join(programFiles, 'Android', 'Android Studio', 'jbr'),
        ...childDirectories(path.join(home, '.gradle', 'jdks')),
        ...childDirectories(path.join(home, '.jdks')),
        ...childDirectories(path.join(programFiles, 'Eclipse Adoptium')),
        ...childDirectories(path.join(programFiles, 'Microsoft')),
        ...childDirectories(path.join(programFiles, 'Java'))
    ].filter(Boolean);
    return candidates.find(candidate => javaMajorVersion(candidate) >= REQUIRED_JAVA) || null;
}

function run(command, options = {}) {
    const { status } = spawnSync(command, { cwd: ROOT, stdio: 'inherit', shell: true, ...options });
    return status ?? 1;
}

function main() {
    const argv = process.argv.slice(2);
    const skipBuild = argv.includes('--no-build');
    const headed = argv.includes('--headed');
    const playwrightArgs = argv.filter(arg => arg !== '--no-build' && arg !== '--headed');
    // Baselines come from headless rendering; a GPU paints text differently.
    if (headed) playwrightArgs.push('--ignore-snapshots');

    const javaHome = findJavaHome();
    if (!javaHome) {
        console.error(`The Firebase emulators need Java ${REQUIRED_JAVA} or newer. Install a JDK or set E2E_JAVA_HOME to one.`);
        return 1;
    }
    if (!skipBuild) {
        const status = run('npm run build');
        if (status !== 0) return status;
    }
    if (!fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))) {
        console.error('dist/ has no manifest.json. Run without --no-build.');
        return 1;
    }
    return run(`firebase emulators:exec --project ${PROJECT_ID} --config firebase.e2e.json --only auth,firestore "node tests/e2e/lib/runPlaywright.cjs"`, {
        env: {
            ...process.env,
            JAVA_HOME: javaHome,
            PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH}`,
            E2E_HEADED: headed ? '1' : '',
            E2E_PLAYWRIGHT_ARGS: JSON.stringify(playwrightArgs)
        }
    });
}

process.exitCode = main();
