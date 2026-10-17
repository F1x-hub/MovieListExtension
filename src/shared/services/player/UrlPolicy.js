(function (global) {
    'use strict';

    // Grounded in existing Kodik fixtures and Rutube's declared CDN consumers.
    // New provider/CDN hosts need a reviewed update; this is not live availability proof.
    const MANIFEST_HOSTS = Object.freeze(['solodcdn.com', 'rtbcdn.ru', 'rutube.ru']);
    const KINDS = new Set(['manifest', 'level', 'init', 'fragment', 'key', 'file']);

    function publicV4(parts) {
        const [a, b, c] = parts;
        return !(a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
            || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
            || (a === 203 && b === 0 && c === 113));
    }

    function publicHost(value) {
        const host = value.toLowerCase().replace(/\.+$/, '');
        if (host.startsWith('[')) {
            const halves = host.slice(1, -1).split('::');
            const left = halves[0] ? halves[0].split(':').map(x => Number.parseInt(x, 16)) : [];
            const right = halves[1] ? halves[1].split(':').map(x => Number.parseInt(x, 16)) : [];
            const words = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : left;
            if (words.slice(0, 5).every(x => x === 0) && words[5] === 0xffff) {
                return publicV4([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255]);
            }
            // Only global unicast literals; exclude documentation and transition prefixes.
            return words[0] >= 0x2000 && words[0] <= 0x3fff && words[0] !== 0x2002
                && !(words[0] === 0x2001 && (words[1] < 0x200 || words[1] === 0xdb8))
                && !(words[0] === 0x3fff && words[1] < 0x1000);
        }
        if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return publicV4(host.split('.').map(Number));
        if (!host.includes('.') || /(?:^|\.)(localhost|local|internal|home|lan)$/.test(host) || host.endsWith('.home.arpa')) return false;
        // DNS resolution/rebinding is outside this string-based policy's guarantee.
        return true;
    }

    function kindOf(context) {
        if (context?.keyInfo) return 'key';
        if (context?.frag) return context.frag.sn === 'initSegment' ? 'init' : 'fragment';
        const types = { manifest: 'manifest', level: 'level', audioTrack: 'level', subtitleTrack: 'level' };
        return Object.hasOwn(types, context?.type) ? types[context.type] : null;
    }

    function create({ localOrigin = 'http://127.0.0.1:3000', manifestHosts = MANIFEST_HOSTS } = {}) {
        const local = new URL(localOrigin);
        if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1' || !local.port
            || local.username || local.password || local.pathname !== '/' || local.search || local.hash) {
            throw new TypeError('Local HLS origin must be an explicit HTTP loopback port');
        }
        const allowed = manifestHosts.map(host => String(host).toLowerCase().replace(/\.+$/, ''));
        function check(value, { kind = 'manifest', profile = 'remote' } = {}) {
            if (!KINDS.has(kind) || !['remote', 'local'].includes(profile)) return { ok: false, reason: 'unknown-context' };
            let url;
            try { url = new URL(value); } catch { return { ok: false, reason: 'invalid-url' }; }
            if (url.username || url.password) return { ok: false, reason: 'credentials' };
            // URL fragments are not sent over HTTP and are absent from Response.url.
            url.hash = '';
            if (profile === 'local') return url.protocol === 'http:' && url.origin === local.origin
                ? { ok: true, url: url.href } : { ok: false, reason: 'local-origin' };
            if (url.protocol !== 'https:' || !publicHost(url.hostname)) return { ok: false, reason: 'non-public-url' };
            const host = url.hostname.toLowerCase().replace(/\.+$/, '');
            if (['manifest', 'file'].includes(kind) && !allowed.some(base => host === base || host.endsWith(`.${base}`))) {
                return { ok: false, reason: 'unapproved-host' };
            }
            return { ok: true, url: url.href };
        }
        return Object.freeze({ check, kindOf });
    }

    global.UrlPolicy = Object.freeze({ ...create(), create, kindOf });
})(typeof window !== 'undefined' ? window : globalThis);
