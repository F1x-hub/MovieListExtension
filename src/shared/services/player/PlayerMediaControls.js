/** Media state independent of the settings DOM; each wrapper owns one instance. */
(function(global) {
    'use strict';
    class PlayerVolumeController {
        constructor({ getVideo, storage, storageKey = 'movieExtension_videoVolume', onChange = () => {} }) {
            this.getVideo = getVideo; this.storage = storage; this.storageKey = storageKey; this.onChange = onChange;
            this.intended = 1; this.last = 1; this.enforcing = false; this.timer = null; this.disposed = false;
        }
        restore() {
            if (this.disposed) return;
            let saved;
            try { saved = this.storage?.getItem(this.storageKey); } catch { /* Media remains usable without storage. */ }
            const value = saved == null ? NaN : Number.parseFloat(saved);
            const video = this.getVideo();
            if (video && Number.isFinite(value) && value >= 0 && value <= 1) {
                video.volume = this.intended = value; video.muted = value === 0;
            }
            this.onChange();
        }
        set(value, muted = value === 0) {
            if (this.disposed || !Number.isFinite(value)) return;
            this.enforcing = true; this.intended = Math.max(0, Math.min(1, value));
            const video = this.getVideo();
            if (video) { video.volume = this.intended; video.muted = Boolean(muted); }
            try { this.storage?.setItem(this.storageKey, String(this.intended)); } catch { /* Optional local preference. */ }
            this.onChange();
            global.clearTimeout(this.timer);
            this.timer = global.setTimeout(() => { this.enforcing = false; this.timer = null; }, 50);
        }
        toggle() {
            const video = this.getVideo();
            if (!video || this.disposed) return;
            if (video.muted || video.volume === 0) this.set(this.last || 1, false);
            else { this.last = video.volume > 0 ? video.volume : 1; this.set(0, true); }
        }
        enforce(video, event) {
            if (this.disposed) return;
            if (!this.enforcing && Math.abs(video.volume - this.intended) > .01) {
                video.volume = this.intended; video.muted = this.intended === 0;
            }
            this.onChange(); event?.stopImmediatePropagation();
        }
        destroy() { this.disposed = true; global.clearTimeout(this.timer); this.timer = null; }
    }
    const PlaybackRate = Object.freeze({
        rates: Object.freeze([.5, .75, 1, 1.25, 1.5, 2]),
        set(video, rate) {
            if (!video || !Number.isFinite(rate) || rate < .25 || rate > 4) return false;
            video.playbackRate = rate; return true;
        },
        step(video, direction) { return video ? this.set(video, Math.max(.25, Math.min(4, video.playbackRate + (direction > 0 ? .25 : -.25)))) : false; }
    });
    const SubtitleAppearance = (() => {
    const DEFAULT_SUBTITLE_APPEARANCE = Object.freeze({
        version: 1,
        fontSizePercent: 100,
        color: '#ffffff',
        position: 'bottom',
        offsetPercent: 6,
        backgroundOpacity: 0.45,
        textShadow: 'strong'
    });

    const clampSubtitleAppearanceNumber = (value, min, max, fallback) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    };

    const normalizeSubtitleAppearanceStep = (value, min, max, step, fallback) => {
        const bounded = clampSubtitleAppearanceNumber(value, min, max, fallback);
        return Number((Math.round((bounded - min) / step) * step + min).toFixed(2));
    };

    const normalizeSubtitleAppearance = rawValue => {
        const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};
        const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color)
            ? raw.color.toLowerCase()
            : DEFAULT_SUBTITLE_APPEARANCE.color;
        const position = raw.position === 'top' ? 'top' : 'bottom';
        const textShadow = ['none', 'soft', 'strong'].includes(raw.textShadow)
            ? raw.textShadow
            : DEFAULT_SUBTITLE_APPEARANCE.textShadow;

        return {
            version: 1,
            fontSizePercent: normalizeSubtitleAppearanceStep(
                raw.fontSizePercent, 75, 200, 5, DEFAULT_SUBTITLE_APPEARANCE.fontSizePercent
            ),
            color,
            position,
            offsetPercent: normalizeSubtitleAppearanceStep(
                raw.offsetPercent, 2, 20, 1, DEFAULT_SUBTITLE_APPEARANCE.offsetPercent
            ),
            backgroundOpacity: normalizeSubtitleAppearanceStep(
                raw.backgroundOpacity, 0, 0.9, 0.05, DEFAULT_SUBTITLE_APPEARANCE.backgroundOpacity
            ),
            textShadow
        };
    };

    const getSubtitleAppearanceTextShadow = appearance => {
        if (appearance.textShadow === 'none') return 'none';
        if (appearance.textShadow === 'soft') return '0 1px 3px rgba(0, 0, 0, .82)';
        return '0 2px 4px rgba(0, 0, 0, .96), 0 0 2px rgba(0, 0, 0, .9)';
    };

    const getSubtitleAppearanceRgb = color => {
        const value = Number.parseInt(color.slice(1), 16);
        return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
    };
        return Object.freeze({ defaults: DEFAULT_SUBTITLE_APPEARANCE, normalize: normalizeSubtitleAppearance,
            shadow: getSubtitleAppearanceTextShadow, rgb: getSubtitleAppearanceRgb });
    })();
    const Timeline = Object.freeze({
        ratio(clientX, rect) {
            if (!Number.isFinite(clientX) || !Number.isFinite(rect?.left) || !Number.isFinite(rect?.width) || rect.width <= 0) return null;
            return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        },
        formatTime(seconds) {
            if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            return (h > 0 ? h + ':' : '') + (m < 10 && h > 0 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        }
    });
    global.PlayerMediaControls = Object.freeze({ PlayerVolumeController, PlaybackRate, SubtitleAppearance, Timeline });
})(typeof window !== 'undefined' ? window : globalThis);
