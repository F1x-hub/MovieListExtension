/**
 * Runs in every page before its own scripts. Nothing here changes dist/: the
 * pages load their real Firebase SDK and real code, only pointed elsewhere.
 */

/** Shifts the wall clock while keeping it running, so timeouts still elapse. */
function pinDate({ offsetMs }) {
    const RealDate = Date;
    const now = () => RealDate.now() + offsetMs;
    globalThis.Date = new Proxy(RealDate, {
        construct(target, args, newTarget) {
            return args.length ? Reflect.construct(target, args, newTarget) : new target(now());
        },
        apply() {
            return new RealDate(now()).toString();
        },
        get(target, property, receiver) {
            return property === 'now' ? now : Reflect.get(target, property, receiver);
        }
    });
}

/**
 * Catches the SDK as it assigns window.firebase and wraps initializeApp, which
 * also covers pages whose build concatenates the SDK into a bundle. If this
 * ever failed to run, the production endpoints are still unreachable: the
 * browser's proxy and host rules block everything except the emulator ports.
 */
function redirectFirebaseToEmulators({ projectId, authOrigin, firestoreHost, firestorePort }) {
    let sdk;
    Object.defineProperty(globalThis, 'firebase', {
        configurable: true,
        enumerable: true,
        get: () => sdk,
        set(value) {
            sdk = value;
            if (!value?.initializeApp || value.__e2eRedirected) return;
            const initializeApp = value.initializeApp;
            value.initializeApp = function (options, ...rest) {
                const app = initializeApp.call(this, { ...options, projectId, apiKey: 'demo-e2e-key' }, ...rest);
                if (typeof app.auth === 'function') app.auth().useEmulator(authOrigin, { disableWarnings: true });
                if (typeof app.firestore === 'function') app.firestore().useEmulator(firestoreHost, firestorePort);
                return app;
            };
            value.__e2eRedirected = true;
        }
    });
}

/**
 * For a single page, after redirectFirebaseToEmulators: Firebase answers late, so
 * the page has to paint before it knows who is there. How often that happens by
 * itself depends on the machine, and a test should not depend on it.
 */
function delayAuthAnswer({ delayMs }) {
    const { get, set } = Object.getOwnPropertyDescriptor(globalThis, 'firebase');
    Object.defineProperty(globalThis, 'firebase', {
        configurable: true,
        enumerable: true,
        get,
        set(value) {
            set(value);
            if (!value?.initializeApp || value.__e2eAuthDelayed) return;
            const initializeApp = value.initializeApp;
            value.initializeApp = function (...args) {
                const app = initializeApp.apply(this, args);
                const auth = app.auth();
                const listen = auth.onAuthStateChanged.bind(auth);
                auth.onAuthStateChanged = (next, ...rest) => listen(user => setTimeout(next, delayMs, user), ...rest);
                return app;
            };
            value.__e2eAuthDelayed = true;
        }
    });
}

/**
 * Records what the user would see over time: layout shifts and slow frames for
 * the whole document, plus per-frame geometry and opacity of tracked elements.
 */
function installMotionRecorder() {
    if (globalThis.__e2eMotion) return;
    const round = value => Math.round(value * 100) / 100;
    const describe = node => {
        if (!node || node.nodeType !== 1) return node?.nodeName || null;
        const id = node.id ? `#${node.id}` : '';
        const classes = typeof node.className === 'string' && node.className.trim()
            ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        return `${node.tagName.toLowerCase()}${id}${classes}`;
    };
    const box = rect => rect && { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height) };
    const shifts = [];
    const longFrames = [];
    const observe = (type, onEntry) => {
        try {
            new PerformanceObserver(list => list.getEntries().forEach(onEntry)).observe({ type, buffered: true });
        } catch { /* Unsupported entry type: that metric stays empty. */ }
    };
    observe('layout-shift', entry => shifts.push({
        t: round(entry.startTime),
        value: entry.value,
        hadRecentInput: entry.hadRecentInput,
        sources: (entry.sources || []).map(source => ({
            node: describe(source.node), from: box(source.previousRect), to: box(source.currentRect)
        }))
    }));
    observe('long-animation-frame', entry => longFrames.push({
        t: round(entry.startTime), duration: round(entry.duration), blocking: round(entry.blockingDuration)
    }));

    const effectiveOpacity = element => {
        let opacity = 1;
        for (let node = element; node?.nodeType === 1; node = node.parentElement) {
            opacity *= parseFloat(getComputedStyle(node).opacity);
        }
        return round(opacity);
    };
    const sample = selector => {
        const element = document.querySelector(selector);
        if (!element) return { present: false, visible: false };
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            present: true,
            visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden',
            x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height),
            opacity: effectiveOpacity(element)
        };
    };
    const metadataKeys = new Set(['offset', 'computedOffset', 'easing', 'composite']);
    let track = null;
    addEventListener('pointerdown', () => {
        if (track) track.inputAt ??= round(performance.now() - track.startedAt);
    }, true);

    globalThis.__e2eMotion = {
        startTrack(targets) {
            const current = { startedAt: performance.now(), frames: [], animated: {}, inputAt: null, running: true };
            const onFrame = time => {
                if (!current.running) return;
                const items = {};
                for (const [name, selector] of Object.entries(targets)) items[name] = sample(selector);
                current.frames.push({ t: round(time - current.startedAt), items });
                for (const animation of document.getAnimations()) {
                    if (animation.playState !== 'running' || !animation.effect?.getKeyframes) continue;
                    const target = describe(animation.effect.target);
                    for (const keyframe of animation.effect.getKeyframes()) {
                        for (const property of Object.keys(keyframe)) {
                            if (metadataKeys.has(property)) continue;
                            (current.animated[property] ||= {})[target] = true;
                        }
                    }
                }
                requestAnimationFrame(onFrame);
            };
            requestAnimationFrame(onFrame);
            track = current;
        },
        stopTrack() {
            if (!track) return { frames: [], animated: {}, inputAt: null };
            track.running = false;
            const { frames, animated, inputAt } = track;
            track = null;
            return {
                frames,
                inputAt,
                animated: Object.fromEntries(Object.entries(animated).map(([property, targets]) => [property, Object.keys(targets)]))
            };
        },
        read: () => ({ shifts: [...shifts], longFrames: [...longFrames] }),
        // Starts a new measuring window, e.g. once a page has finished loading.
        reset() {
            shifts.length = 0;
            longFrames.length = 0;
        }
    };
}

async function installInitScripts(context, { pinnedDate, projectId, authOrigin, firestoreHost, firestorePort }) {
    await context.addInitScript(pinDate, { offsetMs: new Date(pinnedDate).getTime() - Date.now() });
    await context.addInitScript(redirectFirebaseToEmulators, { projectId, authOrigin, firestoreHost, firestorePort });
    await context.addInitScript(installMotionRecorder);
}

module.exports = { installInitScripts, installMotionRecorder, delayAuthAnswer };
