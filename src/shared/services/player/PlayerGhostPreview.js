(function(global) {
    'use strict';
class GhostPlayer {
    constructor({ progressContainer, getActiveVideo, getCurrentUrl, getCurrentType, getCurrentHls, HlsClass }) {
        this._progressContainer = progressContainer;
        this._getActiveVideo   = getActiveVideo;   // () => video element
        this._getCurrentUrl    = getCurrentUrl;    // () => string | null
        this._getCurrentType   = getCurrentType || (() => null);
        this._getCurrentHls    = getCurrentHls;    // () => Hls instance | null
        this._Hls              = HlsClass;         // Hls constructor (lazy-loaded)

        this._ghostHls   = null;
        this._lastUrl    = null;
        this._debounce   = null;

        this._tooltip    = null;
        this._ghostVideo = null;
        this._timeLabel  = null;
        this._targetTime = null;
        this._destroyed = false;
        this._hovering = false;
        this._hideTimer = null;
        this._showFrame = null;

        this._build();
        this._bind();
    }

    // ─── DOM ──────────────────────────────────────────────────────────────────

    _build() {
        this._tooltip = document.createElement('div');
        this._tooltip.className = 'ghost-tooltip';
        this._tooltip.setAttribute('aria-hidden', 'true');

        this._ghostVideo = document.createElement('video');
        this._ghostVideo.className   = 'ghost-video';
        this._ghostVideo.dataset.ghost = "true"; // Tag it for other scripts
        this._ghostVideo.muted       = true;
        this._ghostVideo.preload     = 'none';
        this._ghostVideo.controls    = false;
        this._ghostVideo.playsInline = true;

        this._timeLabel = document.createElement('span');
        this._timeLabel.className = 'ghost-time-label';

        this._tooltip.appendChild(this._ghostVideo);
        this._tooltip.appendChild(this._timeLabel);
        this._getTooltipHost().appendChild(this._tooltip);
        this._onMetadata = () => this._applyTarget();
        this._onSeeked = () => this._revealFrame();
        this._ghostVideo.addEventListener('loadedmetadata', this._onMetadata);
        this._ghostVideo.addEventListener('seeked', this._onSeeked);
        this._ghostVideo.addEventListener('loadeddata', this._onSeeked);
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    _bind() {
        this._onMove  = this._handleMove.bind(this);
        this._onLeave = this._handleLeave.bind(this);

        this._progressContainer.addEventListener('mousemove',  this._onMove);
        this._progressContainer.addEventListener('mouseleave', this._onLeave);
    }

    _handleMove(e) {
        if (this._destroyed) return;
        const video = this._getActiveVideo();

        if (!video) {
            return;
        }
        if (!Number.isFinite(video.duration) || video.duration <= 0) {
            return;
        }

        const rect     = this._progressContainer.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio    = global.PlayerMediaControls.Timeline.ratio(e.clientX, rect);
        if (ratio === null) return;
        const seekTime = Math.min(ratio * video.duration, Math.max(0, video.duration - 0.05));

        this._hovering = true;
        clearTimeout(this._hideTimer);
        this._targetTime = null;
        this._ghostVideo.style.visibility = 'hidden';

        this._showTooltip(e.clientX, rect.top, seekTime);

        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._seekGhost(seekTime), 120);
    }

    _handleLeave() {
        this._hovering = false;
        cancelAnimationFrame(this._showFrame);
        clearTimeout(this._debounce);
        this._targetTime = null;
        this._ghostHls?.stopLoad();
        this._ghostVideo.pause();
        this._tooltip.classList.remove('ghost-tooltip--visible');

        // Небольшая задержка перед реальным hide — плавный fade-out
        this._hideTimer = setTimeout(() => {
            if (!this._tooltip.classList.contains('ghost-tooltip--visible')) {
                this._tooltip.style.display = 'none';
            }
        }, 200);
    }

    // ─── Core ─────────────────────────────────────────────────────────────────

    _seekGhost(time) {
        if (this._destroyed) return;
        const url = this._getCurrentUrl();

        if (!url || url.startsWith('blob:')) {
            return;
        }

        this._targetTime = time;
        if (url !== this._lastUrl) {
            this._initSource(url);
            this._lastUrl = url;
        } else {
            this._ghostHls?.startLoad(time);
        }

        this._applyTarget();
    }

    _applyTarget() {
        if (this._destroyed || this._targetTime === null || this._ghostVideo.readyState < 1) return;
        // The preview has its own source and buffers. The primary video's MSE
        // range can cover only the current fragment, not the requested frame.
        this._ghostVideo.currentTime = this._targetTime;
        this._ghostVideo.pause();
        this._revealFrame();
    }

    _revealFrame() {
        if (this._destroyed || !this._hovering || this._targetTime === null
            || this._ghostVideo.readyState < 2 || this._ghostVideo.seeking) return;
        if (Math.abs(this._ghostVideo.currentTime - this._targetTime) < 0.5) {
            this._ghostVideo.style.visibility = 'visible';
            this._ghostHls?.stopLoad();
        }
    }

    _initSource(url) {
        // Уничтожаем предыдущий HLS инстанс
        if (this._ghostHls) {
            this._ghostHls.destroy();
            this._ghostHls = null;
        }
        this._ghostVideo.removeAttribute('src');

        const isHlsUrl = this._getCurrentType() === 'hls' || /\.m3u8(?:[?#]|$)/i.test(url);
        this._Hls ||= typeof Hls !== 'undefined' ? Hls : null;
        const activeConfig = this._getCurrentHls?.()?.config || {};
        const protectedHls = activeConfig.loader?.movieExtensionPolicyLoader === true;
        if (isHlsUrl && window.location.protocol === 'chrome-extension:' && !protectedHls) {
            this._ghostVideo.style.visibility = 'hidden';
            return;
        }

        if (isHlsUrl && this._Hls && this._Hls.isSupported()) {
            this._ghostHls = new this._Hls({
                // Keep source-specific loaders/authentication from the active
                // extension stream (including signed local torrent sessions).
                ...activeConfig,
                autoStartLoad: false,
                maxBufferLength:    8,
                maxMaxBufferLength: 16,
                backBufferLength: 0,
                startFragPrefetch: false,
            });
            const instance = this._ghostHls;
            this._ghostHls.on(this._Hls.Events.ERROR, (event, data) => {
                if (data.response?.text === 'POLICY_VIOLATION') {
                    if (this._ghostHls !== instance) return;
                    this._ghostHls = null;
                    this._ghostVideo.style.visibility = 'hidden';
                    instance.destroy();
                    return;
                }
                if (data.fatal) this._ghostVideo.style.visibility = 'hidden';
                console.debug('[GhostPlayer] Preview unavailable:', globalThis.PlayerDiagnostics?.sanitizeError(data) || { category: 'unknown' });
            });
            this._ghostHls.on(this._Hls.Events.MANIFEST_PARSED, () => {
                if (this._destroyed || this._ghostHls !== instance || this._targetTime === null) return;
                const levels = this._ghostHls.levels || [];
                const lowest = levels.reduce((best, level, index) =>
                    level.bitrate < levels[best].bitrate ? index : best, 0);
                if (levels.length) {
                    this._ghostHls.startLevel = lowest;
                    this._ghostHls.loadLevel = lowest;
                }
                this._ghostHls.startLoad(this._targetTime);
            });
            instance.loadSource(url);
            if (this._ghostHls === instance) instance.attachMedia(this._ghostVideo);
        } else if (isHlsUrl && protectedHls) {
            this._ghostVideo.style.visibility = 'hidden';
            return;
        } else if (isHlsUrl && this._ghostVideo && this._ghostVideo.canPlayType('application/vnd.apple.mpegurl')) {
            // Нативный HLS (Safari)
            this._ghostVideo.src = url;
            this._ghostVideo.load();
        } else {
            // MP4 или прямая ссылка
            this._ghostVideo.src = url;
            this._ghostVideo.load();
        }

        this._ghostVideo.addEventListener('error', (e) => {
            console.error('[GhostPlayer] ghostVideo error', { code: Number(this._ghostVideo.error?.code) || 0 });
        }, { once: true });
    }

    // ─── UI ───────────────────────────────────────────────────────────────────

    _getTooltipHost() {
        // Provider frames mount a fixed wrapper at the maximum z-index. A body
        // sibling is painted beneath that wrapper even when its own z-index is
        // very large. Keep the preview in the same player stacking context.
        return this._progressContainer.closest('.native-player-wrapper')
            || document.fullscreenElement || document.body;
    }

    _showTooltip(clientX, barTop, time) {
        const host = this._getTooltipHost();
        if (this._tooltip.parentElement !== host) host.appendChild(this._tooltip);
        this._tooltip.style.display = 'flex';
        // Принудительный reflow, чтобы offsetWidth был актуален
        const w = this._tooltip.offsetWidth || 180;
        const h = this._tooltip.offsetHeight || 116;

        const hostRect = host.getBoundingClientRect();
        const hostWidth = host.clientWidth || window.innerWidth;
        const scaleX = hostRect.width > 0 ? host.offsetWidth / hostRect.width : 1;
        const scaleY = hostRect.height > 0 ? host.offsetHeight / hostRect.height : 1;
        let left = (clientX - hostRect.left) * scaleX - w / 2;
        left = Math.max(8, Math.min(left, hostWidth - w - 8));

        const top = Math.max(8, (barTop - hostRect.top) * scaleY - h - 14);

        this._tooltip.style.left = `${left}px`;
        this._tooltip.style.top  = `${top}px`;

        this._timeLabel.textContent = this._formatTime(time);
        
        // Use requestAnimationFrame to ensure display: flex is applied before adding visibility class
        cancelAnimationFrame(this._showFrame);
        this._showFrame = requestAnimationFrame(() => {
            if (!this._destroyed && this._hovering) this._tooltip.classList.add('ghost-tooltip--visible');
        });

    }

    _formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const mm = String(m).padStart(2, '0');
        const ss = String(s).padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        clearTimeout(this._debounce);
        clearTimeout(this._hideTimer);
        cancelAnimationFrame(this._showFrame);
        this._progressContainer.removeEventListener('mousemove',  this._onMove);
        this._progressContainer.removeEventListener('mouseleave', this._onLeave);
        if (this._ghostHls) {
            this._ghostHls.destroy();
            this._ghostHls = null;
        }
        this._ghostVideo.removeEventListener('loadedmetadata', this._onMetadata);
        this._ghostVideo.removeEventListener('seeked', this._onSeeked);
        this._ghostVideo.removeEventListener('loadeddata', this._onSeeked);
        this._ghostVideo.pause();
        this._ghostVideo.removeAttribute('src');
        this._ghostVideo.load();
        this._tooltip.remove();
    }
}
    global.GhostPlayer = GhostPlayer;
})(typeof window !== 'undefined' ? window : globalThis);
