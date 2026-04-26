// player-cleaner.js - Replaces third-party player UI with native video player
(function() {
    'use strict';
    

    // Only run if we are in an iframe (optional, but good practice since we expect to be embedded)
    if (window.self === window.top) {
    } else {
    }

    let observer = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 100; // Increased attempts
    let currentVoiceoverOptions = []; // Shared state for voiceovers
    let permanentVideo = null; // Our single persistent video element
    let hlsInstance = null;
    let lastRealSource = null;
    let pendingActiveEpisodeLabel = null; // Track clicked episode label
    
    // UI References (Module Level)
    let episodeDropdown = null;
    let seasonDropdown = null;
    
    // Anime Skip State
    let animeSkipData = null; // { startTime, endTime, episodeLength }
    let skipButtonVisible = false;
    let skipButton = null;
    
    // Subtitle Persistence Keys (Shared)
    const SUB_ENABLED_KEY = 'movieExtension_subs_enabled';
    const SUB_TRACK_KEY = 'movieExtension_subs_track';

    // === Anime Skip Button Logic (Global Scope) ===
    const showSkipButton = () => {
        if (!skipButtonVisible && skipButton) {
            skipButton.style.display = 'flex';
            skipButtonVisible = true;
            console.log('[MovieExtension] Skip button shown');
        }
    };
    
    const hideSkipButton = () => {
        if (skipButtonVisible && skipButton) {
            skipButton.style.display = 'none';
            skipButtonVisible = false;
            console.log('[MovieExtension] Skip button hidden');
        }
    };
    
    // Check skip button visibility based on current time
    const checkSkipButtonVisibility = (currentTime) => {
        // Fix: Use Number.isFinite for startTime to allow 0 (start of video)
        if (!animeSkipData || !Number.isFinite(animeSkipData.startTime) || !animeSkipData.endTime) {
            hideSkipButton();
            return;
        }
        
        const { startTime, endTime } = animeSkipData;
        const preShowTime = 3; // Show 3 seconds before opening starts
        
        // Show button if: within (startTime - 3s) to endTime range
        if (currentTime >= (startTime - preShowTime) && currentTime < endTime) {
            if (!skipButtonVisible) {
                console.log(`[SkipError] Skip window active (t=${currentTime.toFixed(1)}s, range: ${startTime}-${endTime}s) — showing button`);
            }
            showSkipButton();
        } else {
            hideSkipButton();
        }
    };

    // Shared Subtitle Restoration Logic
    const restoreSubtitlesLogic = (videoEl, wrapperEl) => {
        const isEnabled = localStorage.getItem(SUB_ENABLED_KEY) === 'true';
        if (!isEnabled) return;

        // Helper to update button (searched in wrapper)
        const updateBtn = (active) => {
            if (!wrapperEl) return;
            const btn = wrapperEl.querySelector('.subtitles-toggle-btn');
            if (btn) {
                btn.style.opacity = active ? '1' : '0.7';
                const path = btn.querySelector('path');
                if (path) path.setAttribute('fill', active ? '#4da6ff' : '#fff');
            }
        };

        // Wait for tracks to load
        let attempts = 0;
        const checkTracks = setInterval(() => {
            attempts++;
            const tracks = Array.from(videoEl.textTracks || []);
            
            if (tracks.length > 0) {
                clearInterval(checkTracks);
                
                const savedLabel = localStorage.getItem(SUB_TRACK_KEY);
                let targetTrack = null;

                if (savedLabel) {
                    targetTrack = tracks.find(t => t.label === savedLabel);
                }

                if (!targetTrack) {
                     targetTrack = tracks.find(t => {
                        const l = (t.label || '').toLowerCase();
                        const lang = (t.language || '').toLowerCase();
                        return l.includes('rus') || l.includes('рус') || lang === 'ru';
                    });
                }
                
                if (!targetTrack && tracks.length > 0) targetTrack = tracks[0];

                if (targetTrack) {
                    tracks.forEach(t => t.mode = 'disabled');
                    targetTrack.mode = 'showing';
                    updateBtn(true);
                }
            }

            if (attempts > 20) clearInterval(checkTracks);
        }, 500);
    };
    
    // Inject preventative script to suppress AbortErrors from the site's own code
    // This runs efficiently once at startup
    try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content-scripts/suppress-errors.js');
        (document.head || document.documentElement).appendChild(script);
        script.onload = () => script.remove();
    } catch(e) {}

    /**
     * Проверяет, является ли src настоящим медиа-источником,
     * а не HTML-страницей или пустышкой.
     */
    function isValidMediaSrc(src) {
        if (!src || src === '' || src === 'about:blank') return false;
        
        // blob: URL — всегда валидный медиа-источник
        if (src.startsWith('blob:')) return true;
        
        // Прямые медиа-форматы
        if (/\.(mp4|webm|ogg|m3u8|mpd|ts|mkv)(\?|#|$)/i.test(src)) return true;
        
        // HLS/DASH манифесты через API-пути
        if (/\/(manifest|playlist|stream|hls|dash|video)\//i.test(src)) return true;
        
        // data: URI (poster/thumbnail как video — редко, но допустимо)
        if (src.startsWith('data:video/')) return true;
        
        // Всё остальное (embed-страницы, html-страницы) — не медиа
        return false;
    }

    // Function to change video source while preserving state
    function changeVideoSource(newSrc, autoPlay = true) {
        console.log(`[playerError] changeVideoSource called: url=${newSrc}, caller=${new Error().stack.split('\n')[2]}, timestamp=${Date.now()}`);
        if (!permanentVideo || !newSrc) return;
        
        lastRealSource = newSrc; // Update tracker
        console.log('[MovieExtension] Changing video source to:', newSrc);
        
        // Save current state
        const currentState = {
            volume: permanentVideo.volume,
            playbackRate: permanentVideo.playbackRate,
            muted: permanentVideo.muted,
            activeSubtitle: null
        };
        
        // Stop previous loading if any
        try {
            permanentVideo.pause();
        } catch(e) {}
        
        // Find active subtitle track
        const tracks = Array.from(permanentVideo.textTracks || []);
        const activeTrack = tracks.find(t => t.mode === 'showing');
        if (activeTrack) {
            currentState.activeSubtitle = {
                label: activeTrack.label,
                language: activeTrack.language
            };
        }
        
        // Handle different source types
        if (newSrc.includes('.m3u8')) {
            // HLS stream
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                if (!hlsInstance) {
                    hlsInstance = new Hls();
                    hlsInstance.attachMedia(permanentVideo);
                }
                hlsInstance.loadSource(newSrc);
            } else if (permanentVideo.canPlayType('application/vnd.apple.mpegurl')) {
                // Native HLS support (Safari)
                permanentVideo.src = newSrc;
                permanentVideo.load();
            }
        } else {
            // Regular video file or blob URL
            permanentVideo.src = newSrc;
            // Catch load errors
            try {
                permanentVideo.load(); 
            } catch(e) {
                console.log('[MovieExtension] Load interrupted (expected)');
            }
        }
        
        // Restore state after load
        permanentVideo.volume = currentState.volume;
        permanentVideo.playbackRate = currentState.playbackRate;
        permanentVideo.muted = currentState.muted;
        
        // Auto-play if requested
        if (autoPlay) {
            // Wait for video to be ready before playing
            const tryPlay = () => {
                if (permanentVideo.readyState >= 2) { // HAVE_CURRENT_DATA
                    const playPromise = permanentVideo.play();
                    if (playPromise) {
                        playPromise.catch((e) => {
                            // Ignore AbortError which happens when video source changes quickly
                            if (e.name !== 'AbortError') {
                                console.log('[MovieExtension] Auto-play prevented:', e.message);
                            }
                        });
                    }
                } else {
                    // Retry after a short delay
                    setTimeout(tryPlay, 100);
                }
            };
            tryPlay();
        }
        
        // Restore subtitles after metadata loads
        if (currentState.activeSubtitle) {
            permanentVideo.addEventListener('loadedmetadata', () => {
                const newTracks = Array.from(permanentVideo.textTracks || []);
                const matchingTrack = newTracks.find(t => 
                    t.label === currentState.activeSubtitle.label ||
                    t.language === currentState.activeSubtitle.language
                );
                if (matchingTrack) {
                    newTracks.forEach(t => t.mode = 'disabled');
                    matchingTrack.mode = 'showing';
                }
            }, { once: true });
        }
        
        console.log('[MovieExtension] Video source changed, state preserved');
    }

    // BUG 3 FIX: Listen for reset signal from extension page when switching sources
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'RESET_PERMANENT_VIDEO') {
            console.log('[DEBUG PlayerCleaner] Received RESET_PERMANENT_VIDEO signal, clearing permanentVideo');
            permanentVideo = null;
        }
    });

    // Expose for internal use
    window.MovieExtension_PlayerCleaner = {
        init: replacePlayer
    };

    function replacePlayer() {
        console.log('[DEBUG PlayerCleaner] === replacePlayer() CALLED ===');
        console.log('[DEBUG PlayerCleaner] Current URL:', window.location.href);
        console.log('[DEBUG PlayerCleaner] protocol:', window.location.protocol);
        
        // Isolation: Strict check to ensure we are running inside OUR Extension
        let isInsideExtension = false;
        
        // 1. Check if we are the extension page itself
        if (window.location.protocol === 'chrome-extension:') {
            isInsideExtension = true;
            console.log('[DEBUG PlayerCleaner] Detected: running as chrome-extension page');
        }
        
        // 2. Check if embedded in iframe by extension (original logic)
        try {
            const selfId = chrome.runtime.id;
            if (window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0) {
                // Check the top-most ancestor
                const topOrigin = window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1];
                console.log('[DEBUG PlayerCleaner] ancestorOrigins topOrigin:', topOrigin);
                if (topOrigin && topOrigin.startsWith('chrome-extension://' + selfId)) {
                    isInsideExtension = true;
                    console.log('[DEBUG PlayerCleaner] Detected: inside extension iframe');
                }
            }
        } catch (e) {
            console.log('[DEBUG PlayerCleaner] ancestorOrigins check error:', e.message);
        }

        if (!isInsideExtension) {
            console.log('[DEBUG PlayerCleaner] NOT inside extension, aborting');
            return;
        }

        const allVideos = Array.from(document.querySelectorAll('video')).filter(v => v.dataset.ghost !== 'true' && !v.classList.contains('ghost-video'));
        const allIframes = document.querySelectorAll('iframe');
        const allNativeWrappers = document.querySelectorAll('.native-player-wrapper');
        
        // Only log census if there's something to potentially clean or if inside an iframe
        if (allVideos.length > 0 || allIframes.length > 0 || window.self !== window.top) {
            console.log('[DEBUG PlayerCleaner] DOM census: videos:', allVideos.length, 'iframes:', allIframes.length, 'native-player-wrappers:', allNativeWrappers.length);
            allVideos.forEach((v, i) => console.log(`[DEBUG PlayerCleaner] video[${i}]: src=${v.src?.substring(0,80)}, parent=${v.parentElement?.className}, controls=${v.controls}`));
        }

        // EARLY EXIT: If we already have a permanentVideo and it's inside our wrapper, we're done
        // BUG 2 FIX: Also verify the element is actually in the document (not detached)
        if (permanentVideo 
            && document.contains(permanentVideo) 
            && permanentVideo.closest('.native-player-wrapper')) {
            // Before exiting, check if the site spawned a NEW video outside our wrapper
            const outsideVideo = document.querySelector('video:not(.native-player-wrapper video):not(.ghost-video)');
            if (!outsideVideo || (!outsideVideo.src && !outsideVideo.currentSrc)) {
                console.log('[DEBUG PlayerCleaner] permanentVideo is already safely mounted inside wrapper. Exiting.');
                return;
            }
            
            // Validate: don't proceed to swap if the outside video has a non-media src
            const outsideSrc = outsideVideo.src || outsideVideo.currentSrc || '';
            if (outsideSrc && !isValidMediaSrc(outsideSrc)) {
                console.log('[DEBUG PlayerCleaner] Outside video has invalid/non-media src, ignoring. src:', outsideSrc);
                return;
            }
            
            // Don't downgrade from a working blob: src to a non-blob src
            const currentPermanentSrc = permanentVideo.src || permanentVideo.currentSrc || '';
            if (isValidMediaSrc(currentPermanentSrc) && currentPermanentSrc.startsWith('blob:') && !outsideSrc.startsWith('blob:')) {
                console.log('[DEBUG PlayerCleaner] permanentVideo has better blob src, refusing downgrade swap. newSrc:', outsideSrc);
                return;
            }
            
            console.log('[DEBUG PlayerCleaner] permanentVideo mounted BUT new site video detected outside wrapper — proceeding to swap.');
        }

        // Check if player already exists
        const existingWrapper = document.querySelector('.native-player-wrapper');
        if (existingWrapper && permanentVideo) {
            console.log('[DEBUG PlayerCleaner] Player already exists (native-player-wrapper found). permanentVideo src:', permanentVideo.src?.substring(0,80));
            // Player already initialized, check for new video from site
            const siteVideo = document.querySelector('video:not(.native-player-wrapper video)');
            if (siteVideo && siteVideo.src) {
                const newSrc = siteVideo.src || siteVideo.currentSrc || '';
                
                // Validate: skip swap if new video has non-media src (e.g. embed page URL)
                if (!isValidMediaSrc(newSrc)) {
                    console.log('[DEBUG PlayerCleaner] New site video has invalid/non-media src, skipping swap. src:', newSrc);
                    return;
                }
                
                // Don't downgrade from a working blob: src to a non-blob src
                const currentSrc = permanentVideo.src || permanentVideo.currentSrc || '';
                if (isValidMediaSrc(currentSrc) && currentSrc.startsWith('blob:') && !newSrc.startsWith('blob:')) {
                    console.log('[DEBUG PlayerCleaner] permanentVideo has better blob src, refusing downgrade swap. newSrc:', newSrc);
                    return;
                }
                
                console.log('[DEBUG PlayerCleaner] Detected new video from site (outside wrapper), swapping. siteVideo.src:', siteVideo.src?.substring(0,80));
                console.log('[MovieExtension] Detected new video from site, swapping video element');
                
                // FIX: Verify and clear buffer visual state immediately to prevent "ghost" segments
                const bufferContainer = existingWrapper.querySelector('.native-buffer-container');
                if (bufferContainer) bufferContainer.innerHTML = ''; // Clear old buffer segments
                
                const progressFilled = existingWrapper.querySelector('.native-progress-filled');
                if (progressFilled) progressFilled.style.width = '0%'; // Reset progress bar
                
                // Save current settings from old video
                const savedSettings = {
                    volume: permanentVideo.volume,
                    playbackRate: permanentVideo.playbackRate,
                    muted: permanentVideo.muted,
                    currentTime: 0 // Start from beginning for new episode
                };
                
                // Save active subtitle
                let activeSubtitle = null;
                const tracks = Array.from(permanentVideo.textTracks || []);
                const activeTrack = tracks.find(t => t.mode === 'showing');
                if (activeTrack) {
                    activeSubtitle = {
                        label: activeTrack.label,
                        language: activeTrack.language
                    };
                }
                
                // Remove old video
                const oldVideo = permanentVideo;
                if (oldVideo) {
                    oldVideo.pause();
                    oldVideo.removeAttribute('src'); // Detach source
                    oldVideo.removeAttribute('src'); // Detach source
                    try { oldVideo.load(); } catch(e) {} // Force release of media resources
                    oldVideo.remove(); // Remove from DOM
                    oldVideo.src = ''; // Double check
                }
                permanentVideo = null; // Clear reference strictly before reassigning
                
                // Configure new video from site
                siteVideo.removeAttribute('controls');
                siteVideo.autoplay = true;
                siteVideo.playsInline = true;
                siteVideo.style.width = '100%';
                siteVideo.style.height = '100%';
                siteVideo.style.objectFit = 'contain';
                siteVideo.style.position = 'relative';
                siteVideo.style.zIndex = 'auto';
                
                // Apply saved settings
                siteVideo.volume = savedSettings.volume;
                siteVideo.playbackRate = savedSettings.playbackRate;
                siteVideo.muted = savedSettings.muted;
                
                // Insert new video in the same position (before controls overlay)
                const controlsOverlay = existingWrapper.querySelector('div[style*="pointer-events: none"]');
                existingWrapper.insertBefore(siteVideo, controlsOverlay);
                
                // Update permanent video reference
                permanentVideo = siteVideo;
                
                // Re-attach event listeners to new video
                if (typeof window._movieExtension_setupListeners === 'function') {
                    window._movieExtension_setupListeners(permanentVideo);
                    // Trigger volume update to sync UI (icon/slider) which depends on valid video reference
                    permanentVideo.dispatchEvent(new Event('volumechange'));
                }

                // Sync Episode Selector Logic
                // Try to determine new episode label. The clicked item sent us here, 
                // but we need to update the UI on the new persistent player.
                // We'll trust that the user just clicked something that matches currently loading video.
                // However, without parsing the number from src (which is blob), we rely on 
                // re-scanning series data OR using the last clicked item if we tracked it.
                // Since we don't track it globally easily here, we will trigger a re-scan.
                
                // Ideally, we find the horizontal selector and update it.
                // Ideally, we find the horizontal selector and update it.
                if (episodeDropdown && episodeDropdown.setVideoActive && pendingActiveEpisodeLabel) {
                    episodeDropdown.setVideoActive(pendingActiveEpisodeLabel);
                    pendingActiveEpisodeLabel = null; // Reset
                }

                
                // Re-apply correct initial state for subtitles
                // Disable all by default first to ensure clean state
                Array.from(permanentVideo.textTracks || []).forEach(t => t.mode = 'disabled');
                
                // Then try to restore user preference
                if (typeof restoreSubtitlesLogic === 'function') {
                    // Delay slightly to let metadata load or rely on its internal interval
                    restoreSubtitlesLogic(permanentVideo, existingWrapper);
                    // Also hook metadata for faster reaction
                    permanentVideo.addEventListener('loadedmetadata', () => restoreSubtitlesLogic(permanentVideo, existingWrapper), {once:true});
                }
                
                // Auto-play if flag is set
                if (localStorage.getItem('movieExtension_autoplay_next') === 'true') {
                    localStorage.removeItem('movieExtension_autoplay_next');
                    localStorage.removeItem('movieExtension_autoplay_next');
                    permanentVideo.play().catch(e => {
                        if (e.name !== 'AbortError') console.log('[MovieExtension] Autoplay next failed:', e);
                    });
                }
                
                // Re-scan for voiceovers/qualities (Site likely re-rendered them)
                // Re-scan for voiceovers/qualities (Site likely re-rendered them)
                // We reuse the controlsOverlay reference from above to exclude it
                console.log('[MovieExtension] Re-scanning voiceovers for new episode...');
                if (typeof findAndRenderVoiceovers === 'function') {
                    // Delay slightly to ensure site has rendered the new lists
                    setTimeout(() => {
                        findAndRenderVoiceovers(controlsOverlay, existingWrapper);
                        console.log('[MovieExtension] Voiceover scan complete. Count:', currentVoiceoverOptions.length);
                    }, 1500); // Increased delay slightly to be safe
                }
                
                console.log('[MovieExtension] Video element swapped successfully');
            }
            
            // Clean up stale iframes NOT part of our custom player
            // Scoped to videoPlayerModal to avoid touching trailer iframes or other components
            const modalContainer = document.getElementById('videoPlayerModal') 
                                || document.querySelector('.video-container')
                                || document;
            const staleIframes = modalContainer.querySelectorAll('iframe');
            staleIframes.forEach(iframe => {
                if (iframe.closest('.native-player-wrapper')) return;
                console.log('[PlayerCleaner] Removed stale iframe:', iframe.src || '(no src)');
                iframe.remove();
            });
            
            // Final DOM state (scoped to modalContainer)
            const finalVideos = modalContainer.querySelectorAll('video').length;
            const finalIframes = modalContainer.querySelectorAll('iframe').length;
            const finalWrappers = modalContainer.querySelectorAll('.native-player-wrapper').length;
            console.log(`[PlayerCleaner] DOM after cleanup (scoped): videos: ${finalVideos} iframes: ${finalIframes} wrappers: ${finalWrappers}`);
            
            return; // Player exists, nothing more to do
        }
        
        // Find site's video element to extract source
        const siteVideo = document.querySelector('video');
        console.log('[DEBUG PlayerCleaner] Looking for site video. Found:', !!siteVideo, siteVideo ? `src=${siteVideo.src?.substring(0,80)}, controls=${siteVideo.controls}` : '');
        
        // Scan for potential translator/season lists BEFORE we hide them
        // Common selectors in these players: .season-list, .episode-list, .translate-list, .box-list
        if (!window.extractedSources) {
            const potentialLists = document.querySelectorAll('ul, .dropdown, select, .list');
            
            potentialLists.forEach(el => {
                // Check content for keywords
                const text = el.textContent || '';
                if (text.includes('Original') || text.includes('Dubbing') || text.includes('Дубляж') || text.includes('TVShows')) {
                }
            });
        }
        
        if (!siteVideo) {
            // Only log if we are in an environment where we EXPECT a video
            if (window.self !== window.top) {
                console.log('[DEBUG PlayerCleaner] No video found yet, waiting...');
            }
            return; // No video found yet
        }
        
        if (!siteVideo.src && !siteVideo.currentSrc && siteVideo.querySelectorAll('source').length === 0) {
            console.log('[DEBUG PlayerCleaner] Video has no source yet, waiting...');
            return; // Video has no source
        }
        
        // Filter out video elements with non-media src (e.g. embed page URLs)
        const candidateSrc = siteVideo.src || siteVideo.currentSrc || '';
        if (candidateSrc && !isValidMediaSrc(candidateSrc)) {
            console.log('[DEBUG PlayerCleaner] Site video has invalid/non-media src, skipping. src:', candidateSrc);
            return;
        }
        
        // Extract source from site's video
        const initialSrc = siteVideo.src || siteVideo.currentSrc || (siteVideo.querySelector('source') ? siteVideo.querySelector('source').src : '');
        
        if (!initialSrc) {
            return; // No valid source
        }
        
        console.log('[MovieExtension] Found initial video source:', initialSrc);
        
        // IMPORTANT: Use site's original video element as our permanent element
        // This is critical for blob: URLs which are tied to the specific element
        permanentVideo = siteVideo;
        lastRealSource = siteVideo.src || siteVideo.currentSrc; // Initial source track
        
        // Configure the existing video element
        permanentVideo.removeAttribute('controls'); // Remove native controls
        permanentVideo.autoplay = true;
        permanentVideo.playsInline = true;
        permanentVideo.style.width = '100%';
        permanentVideo.style.height = '100%';
        permanentVideo.style.objectFit = 'contain';
        permanentVideo.style.position = 'relative';
        permanentVideo.style.zIndex = 'auto';
        
        console.log('[MovieExtension] Using site video as permanent element:', permanentVideo);
        console.log('[MovieExtension] Video src:', permanentVideo.src);
        console.log('[MovieExtension] Video sources:', permanentVideo.querySelectorAll('source').length);
        console.log('[MovieExtension] Video readyState:', permanentVideo.readyState);
        console.log('[DEBUG PlayerCleaner] Video controls attribute:', permanentVideo.controls, 'hasAttribute("controls"):', permanentVideo.hasAttribute('controls'));
        console.log('[DEBUG PlayerCleaner] Video parent chain:', permanentVideo.parentElement?.tagName, '->', permanentVideo.parentElement?.parentElement?.tagName);
        
        // Check for other players/elements in the same container that could overlay
        const videoParent = permanentVideo.parentElement;
        if (videoParent) {
            const siblings = Array.from(videoParent.children).filter(el => el !== permanentVideo);
            console.log('[DEBUG PlayerCleaner] Video siblings in parent:', siblings.length, siblings.map(s => s.tagName + '.' + s.className?.substring(0,30)));
        }
        
        // DON'T remove site's video - we're using it!
        // siteVideo.remove(); // REMOVED
        
        // Use permanentVideo as 'video' reference for the rest of the function
        const video = permanentVideo;

                       
            
            // Create container to hold our new player
            const newContainer = document.createElement('div');
            // script.remove(); removed from here
            
            newContainer.className = 'native-player-wrapper';
            const PLAYER_WRAPPER_CLASS = 'native-player-wrapper';

            // Global left-click enforcer for the custom player UI
            const clickEnforcer = (e) => {
                if ('button' in e && e.button !== 0) {
                    e.stopPropagation();
                    if (e.button === 1) e.preventDefault(); // Block middle click
                }
            };
            newContainer.addEventListener('mousedown', clickEnforcer, true);
            newContainer.addEventListener('mouseup', clickEnforcer, true);
            newContainer.addEventListener('click', clickEnforcer, true);
            
            // Check if we are running in the extension modal context
            // If so, we want to respect the parent container's layout
            const isEmbedded = window.location.protocol === 'chrome-extension:' || document.querySelector('.video-container');

            if (isEmbedded) {
                 newContainer.style.position = 'relative'; // Keep in flow
                 newContainer.style.width = '100%';
                 newContainer.style.height = '100%'; // Or 'auto' if flex handles it, but 100% is safe usually
                 newContainer.style.flex = '1'; // Occupy remaining space
                 newContainer.style.backgroundColor = '#000';
                 newContainer.style.display = 'flex';
                 newContainer.style.alignItems = 'center';
                 newContainer.style.justifyContent = 'center';
                 newContainer.style.zIndex = '1'; // Standard z-index
            } else {
                 // Standalone / Fullscreen overlay mode (Original behavior)
                 newContainer.style.position = 'fixed';
                 newContainer.style.top = '0';
                 newContainer.style.left = '0';
                 newContainer.style.width = '100%';
                 newContainer.style.height = '100%';
                 newContainer.style.backgroundColor = '#000';
                 newContainer.style.zIndex = '2147483647'; // Max z-index
                 newContainer.style.display = 'flex';
                 newContainer.style.alignItems = 'center';
                 newContainer.style.justifyContent = 'center';
            }

            // Controls Overlay for Center Button
            const controlsOverlay = document.createElement('div');
            controlsOverlay.style.position = 'absolute';
            controlsOverlay.style.top = '0';
            controlsOverlay.style.left = '0';
            controlsOverlay.style.width = '100%';
            controlsOverlay.style.height = '100%';
            controlsOverlay.style.pointerEvents = 'none'; // Click-through mostly
            controlsOverlay.style.zIndex = '2147483620';

            // Viewing Position Indicator (Top-Left)
            const viewingPositionIndicator = document.createElement('div');
            viewingPositionIndicator.style.position = 'absolute';
            viewingPositionIndicator.style.top = '30px'; // Align with volume indicator roughly
            viewingPositionIndicator.style.left = '30px';
            viewingPositionIndicator.style.fontSize = '18px';
            viewingPositionIndicator.style.fontWeight = 'bold';
            viewingPositionIndicator.style.color = '#ffffff';
            viewingPositionIndicator.style.textShadow = '0 2px 4px rgba(0,0,0,0.8)';
            viewingPositionIndicator.style.pointerEvents = 'none';
            viewingPositionIndicator.style.zIndex = '2147483648';
            viewingPositionIndicator.style.opacity = '1'; 
            viewingPositionIndicator.style.transition = 'opacity 0.3s ease';
            viewingPositionIndicator.style.display = 'none'; // Hidden by default
            viewingPositionIndicator.className = 'viewing-position-indicator';
            controlsOverlay.appendChild(viewingPositionIndicator);

            const updateViewingIndicatorText = (season, episode) => {
                if (!episode) {
                     viewingPositionIndicator.style.display = 'none';
                     return;
                }
                viewingPositionIndicator.style.display = 'block';
                
                // Clean up labels if needed (e.g. remove "Сезон" word if we want just numbers, 
                // but user asked for "Сезон 2, Серия 4" or "Серия 4")
                // The labels from site usually contain "X сезон" or "Y серия".
                
                if (season) {
                    viewingPositionIndicator.textContent = `${season}, ${episode}`;
                } else {
                    viewingPositionIndicator.textContent = `${episode}`;
                }
            };

            // Center Play/Pause Button
            const centerPlayBtn = document.createElement('div');
            centerPlayBtn.style.position = 'absolute';
            centerPlayBtn.style.top = '50%';
            centerPlayBtn.style.left = '50%';
            centerPlayBtn.style.transform = 'translate(-50%, -50%)';
            centerPlayBtn.style.background = 'rgba(0,0,0,0.5)';
            centerPlayBtn.style.border = 'none';
            centerPlayBtn.style.borderRadius = '50%';
            centerPlayBtn.style.width = '80px';
            centerPlayBtn.style.height = '80px';
            centerPlayBtn.style.cursor = 'pointer';
            centerPlayBtn.style.pointerEvents = 'auto';
            centerPlayBtn.style.display = 'flex';
            centerPlayBtn.style.alignItems = 'center';
            centerPlayBtn.style.justifyContent = 'center';
            centerPlayBtn.style.transition = 'opacity 0.2s, transform 0.1s';
            centerPlayBtn.style.backdropFilter = 'blur(4px)';

            // Hover effect for center button
            centerPlayBtn.addEventListener('mouseenter', () => centerPlayBtn.style.transform = 'translate(-50%, -50%) scale(1.1)');
            centerPlayBtn.addEventListener('mouseleave', () => centerPlayBtn.style.transform = 'translate(-50%, -50%) scale(1.0)');

            centerPlayBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentVid = permanentVideo || video;
                if (currentVid) currentVid.focus(); // Fix focus
                console.log('[MovieExtension] Center Play clicked');
                if (currentVid.paused) {
                     currentVid.play().catch(e => {
                        if (e.name !== 'AbortError') console.log('[MovieExtension] Play failed:', e);
                     });
                } else {
                     currentVid.pause();
                }
            });

            controlsOverlay.appendChild(centerPlayBtn);

            // Seek Indicators (+10 / -10)
            const leftSeekIndicator = document.createElement('div');
            leftSeekIndicator.style.position = 'absolute';
            leftSeekIndicator.style.top = '50%';
            leftSeekIndicator.style.left = '15%';
            leftSeekIndicator.style.transform = 'translate(-50%, -50%)';
            leftSeekIndicator.style.fontSize = '48px';
            leftSeekIndicator.style.fontWeight = 'bold';
            leftSeekIndicator.style.color = '#ffffff';
            leftSeekIndicator.style.textShadow = '0 0 10px rgba(0,0,0,0.8)';
            leftSeekIndicator.style.opacity = '0';
            leftSeekIndicator.style.pointerEvents = 'none';
            leftSeekIndicator.style.zIndex = '2147483648';
            leftSeekIndicator.style.transition = 'opacity 0.2s ease';
            leftSeekIndicator.textContent = '-10';
            controlsOverlay.appendChild(leftSeekIndicator);

            const rightSeekIndicator = document.createElement('div');
            rightSeekIndicator.style.position = 'absolute';
            rightSeekIndicator.style.top = '50%';
            rightSeekIndicator.style.right = '15%';
            rightSeekIndicator.style.transform = 'translate(50%, -50%)';
            rightSeekIndicator.style.fontSize = '48px';
            rightSeekIndicator.style.fontWeight = 'bold';
            rightSeekIndicator.style.color = '#ffffff';
            rightSeekIndicator.style.textShadow = '0 0 10px rgba(0,0,0,0.8)';
            rightSeekIndicator.style.opacity = '0';
            rightSeekIndicator.style.pointerEvents = 'none';
            rightSeekIndicator.style.zIndex = '2147483648';
            rightSeekIndicator.style.transition = 'opacity 0.2s ease';
            rightSeekIndicator.textContent = '+10';
            controlsOverlay.appendChild(rightSeekIndicator);

            // Indicator animation timers
            let leftSeekTimeout = null;
            let rightSeekTimeout = null;

            // Show seek indicator with animation
            const showSeekIndicator = (indicator, timeoutRef) => {
                // Clear existing timeout if any
                if (timeoutRef === 'left' && leftSeekTimeout) {
                    clearTimeout(leftSeekTimeout);
                    leftSeekTimeout = null;
                }
                if (timeoutRef === 'right' && rightSeekTimeout) {
                    clearTimeout(rightSeekTimeout);
                    rightSeekTimeout = null;
                }
                
                // Force hide first to reset animation
                indicator.style.opacity = '0';
                
                // Show with slight delay to ensure reset
                setTimeout(() => {
                    indicator.style.opacity = '1';
                    
                    // Hide after 1 second
                    const timeout = setTimeout(() => {
                        indicator.style.opacity = '0';
                    }, 1000);
                    
                    if (timeoutRef === 'left') {
                        leftSeekTimeout = timeout;
                    } else {
                        rightSeekTimeout = timeout;
                    }
                }, 50);
            };

            // Volume Indicator (top-center)
            const volumeIndicator = document.createElement('div');
            volumeIndicator.style.position = 'absolute';
            volumeIndicator.style.top = '30px';
            volumeIndicator.style.left = '50%';
            volumeIndicator.style.transform = 'translateX(-50%)';
            volumeIndicator.style.fontSize = '28px';
            volumeIndicator.style.fontWeight = 'bold';
            volumeIndicator.style.color = '#ffffff';
            volumeIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
            volumeIndicator.style.padding = '8px 20px';
            volumeIndicator.style.borderRadius = '8px';
            volumeIndicator.style.opacity = '0';
            volumeIndicator.style.pointerEvents = 'none';
            volumeIndicator.style.zIndex = '2147483648';
            volumeIndicator.style.transition = 'opacity 0.3s ease';
            volumeIndicator.textContent = '50%';
            controlsOverlay.appendChild(volumeIndicator);

            // Volume indicator animation timer
            let volumeIndicatorTimeout = null;

            // Show volume indicator with animation
            const showVolumeIndicator = (volumePercent) => {
                // Clear existing timeout
                if (volumeIndicatorTimeout) {
                    clearTimeout(volumeIndicatorTimeout);
                    volumeIndicatorTimeout = null;
                }
                
                // Update text
                volumeIndicator.textContent = Math.round(volumePercent) + '%';
                
                // Force show
                volumeIndicator.style.opacity = '0';
                
                setTimeout(() => {
                    volumeIndicator.style.opacity = '1';
                    
                    // Hide after 1.5 seconds
                    volumeIndicatorTimeout = setTimeout(() => {
                        volumeIndicator.style.opacity = '0';
                    }, 1500);
                }, 50);
            };


            // Video element is now permanently created, no need for injection logic




            // Move the video into our container
            const originalParent = video.parentElement;
            console.log('[MovieExtension] Appending video to container...');
            newContainer.appendChild(video);
            console.log('[MovieExtension] Video appended. Parent:', video.parentElement);
            newContainer.appendChild(controlsOverlay); // Append controls


            if (isEmbedded && originalParent) {
                 // Embedded mode: specific injection
                 originalParent.appendChild(newContainer);
                 // Do NOT hide other elements
            } else {
                // Standalone mode: fullscreen body injection
                document.body.appendChild(newContainer);

                // Hide everything else in body except our container
                Array.from(document.body.children).forEach(child => {
                    if (child !== newContainer) {
                        child.style.display = 'none';
                        // Optional: remove if you want to be aggressive, but hiding is safer for scripts
                    }
                });
            }
            
            // Force focus
            video.focus();
            
            // State for Voiceovers (Removed local decl, using global)
            
            // Inject Dynamic Styles for Subtitles
            const subParams = document.createElement('style');
            subParams.textContent = `
                /* Move subtitles up when controls are visible */
                .native-player-wrapper.controls-visible video::-webkit-media-text-track-display {
                    transform: translateY(-80px) !important;
                    transition: transform 0.3s ease !important;
                }
                /* Reset when controls hidden */
                .native-player-wrapper:not(.controls-visible) video::-webkit-media-text-track-display {
                    transform: translateY(0) !important;
                    transition: transform 0.3s ease !important;
                }

                /* Remove default focus outline from player buttons */
                .native-player-wrapper button:focus-visible {
                    outline: none !important;
                }


            `;
            document.head.appendChild(subParams);

            // Custom Bottom Controls
            const bottomControls = document.createElement('div');
            bottomControls.style.position = 'absolute';
            bottomControls.style.bottom = '0';
            bottomControls.style.left = '0';
            bottomControls.style.width = '100%';
            bottomControls.style.boxSizing = 'border-box'; // Fix overflow due to padding
            bottomControls.style.padding = '10px 20px';
            bottomControls.style.background = 'linear-gradient(transparent, rgba(0,0,0,0.8))';
            bottomControls.style.display = 'flex';
            bottomControls.style.alignItems = 'center';
            bottomControls.style.gap = '15px';
            bottomControls.style.opacity = '0';
            bottomControls.style.transition = 'opacity 0.3s';
            bottomControls.style.zIndex = '2147483625'; 

            // --- PROGRESS BAR WITH THUMBNAIL PREVIEW START ---
            const progressContainer = document.createElement('div');
            progressContainer.style.position = 'absolute';
            progressContainer.style.bottom = '55px'; // "Slightly above" controls
            progressContainer.style.left = '20px';
            progressContainer.style.right = '20px'; // 20px padding from sides
            progressContainer.style.height = '5px';
            progressContainer.style.backgroundColor = 'rgba(255,255,255,0.3)';
            progressContainer.style.cursor = 'pointer';
            progressContainer.style.borderRadius = '2px';
            progressContainer.style.zIndex = '2147483640';
            // Increase hit area
            progressContainer.style.borderTop = '10px solid transparent';
            progressContainer.style.borderBottom = '10px solid transparent';
            progressContainer.style.backgroundClip = 'padding-box';
            progressContainer.style.boxSizing = 'content-box'; // FIX: Prevent height collapse on sites with border-box reset

            // Buffer Indicator Container
            const bufferContainer = document.createElement('div');
            bufferContainer.style.position = 'absolute';
            bufferContainer.style.top = '0';
            bufferContainer.style.left = '0';
            bufferContainer.style.width = '100%';
            bufferContainer.style.height = '100%';
            bufferContainer.style.borderRadius = '2px';
            bufferContainer.style.zIndex = '1'; // Behind progressFilled
            bufferContainer.style.pointerEvents = 'none';
            bufferContainer.className = 'native-buffer-container'; // ADDED CLASS for selection
            progressContainer.appendChild(bufferContainer);

            const progressFilled = document.createElement('div');
            progressFilled.style.height = '100%';
            progressFilled.style.width = '0%';
            progressFilled.style.backgroundColor = '#4da6ff'; // Blue theme
            progressFilled.style.borderRadius = '2px';
            progressFilled.style.position = 'relative';
            progressFilled.style.zIndex = '2'; // Above buffer
            progressFilled.className = 'native-progress-filled'; // ADDED CLASS for selection
            progressContainer.appendChild(progressFilled);

            // Thumbnail Tooltip (Time Only)
            const thumbTooltip = document.createElement('div');
            thumbTooltip.style.position = 'absolute';
            thumbTooltip.style.bottom = '20px'; // Above bar
            thumbTooltip.style.left = '0';
            thumbTooltip.style.transform = 'translateX(-50%)';
            thumbTooltip.style.backgroundColor = 'rgba(0,0,0,0.8)';
            thumbTooltip.style.color = 'white';
            thumbTooltip.style.padding = '4px 8px';
            thumbTooltip.style.borderRadius = '4px';
            thumbTooltip.style.fontSize = '12px';
            thumbTooltip.style.fontWeight = '500';
            thumbTooltip.style.pointerEvents = 'none';
            thumbTooltip.style.display = 'none';
            thumbTooltip.style.zIndex = '2147483641';
            thumbTooltip.textContent = '0:00';
            progressContainer.appendChild(thumbTooltip);

            // Progress Bar Logic
            const updateBuffer = () => {
                const currentVid = permanentVideo || video;
                if (!currentVid) return;

                const duration = currentVid.duration;
                if (!Number.isFinite(duration) || duration <= 0) return;

                const buffered = currentVid.buffered;
                
                // Clear existing segments
                bufferContainer.innerHTML = '';

                // Render segments
                // Render segments
                for (let i = 0; i < buffered.length; i++) {
                    let start = buffered.start(i);
                    const end = buffered.end(i);
                    
                    // Visual fix: If buffer starts slightly ahead of current time (< 2s),
                    // snap it to current time to avoid visual gap
                    if (start > currentVid.currentTime && (start - currentVid.currentTime) < 2) {
                        start = currentVid.currentTime;
                    }
                    
                    const widthPercent = ((end - start) / duration) * 100;
                    const leftPercent = (start / duration) * 100;

                    const segment = document.createElement('div');
                    segment.style.position = 'absolute';
                    segment.style.top = '0';
                    segment.style.left = `${leftPercent}%`;
                    segment.style.width = `${widthPercent}%`;
                    segment.style.height = '100%';
                    segment.style.backgroundColor = 'rgba(255, 255, 255, 0.4)'; // Gray/White transparent
                    segment.style.borderRadius = '2px';
                    bufferContainer.appendChild(segment);
                }
            };

            video.addEventListener('timeupdate', () => {
                const percent = (video.currentTime / video.duration) * 100;
                progressFilled.style.width = `${percent}%`;
            });
            
            video.addEventListener('progress', updateBuffer);
            video.addEventListener('timeupdate', updateBuffer); // Also update on time as buffer might change
            video.addEventListener('loadedmetadata', updateBuffer);

            // --- PERSISTENT PROGRESS START ---
            
            // Helper to scan for series data with robust wildcard selectors
            // Moved here to be accessible by progress logic
            const scanForSeriesData = () => {
                const data = {
                    seasons: [],
                    episodes: [],
                    hasSeries: false
                };

                // Robust strategy: Match partial class names as they seem to be hashed but keep prefixes
                // Known prefixes: list_, dropdown_, item_, headText_
                
                // 1. Find the main list container
                const listContainer = document.querySelector('div[class*="list_"]');
                if (!listContainer) return data;

                // 2. Find all dropdowns
                const dropdowns = listContainer.querySelectorAll('div[class*="dropdown_"]');
                
                dropdowns.forEach(dropdown => {
                    // Try to find header text to identify if this is Seasons or Episodes
                    let headerText = '';
                    const headerSpan = dropdown.querySelector('span[class*="headText_"]');
                    if (headerSpan) {
                        headerText = headerSpan.textContent || '';
                    } else {
                        // Fallback: check first child text
                        headerText = dropdown.textContent || ''; 
                    }
                    
                    // Find items
                    const items = Array.from(dropdown.querySelectorAll('div[class*="item_"]'));
                    
                    if (items.length === 0) return;

                    const listData = items.map((item, index) => ({
                        label: item.textContent.trim(),
                        isActive: item.className.includes('active') || item.classList.contains('active_1RhfH'), // Keep old specific check just in case, but rely on 'includes' for safety
                        element: item,
                        index: index
                    }));

                    // Heuristic to decide if it's Season or Episode list
                    const firstItemText = listData[0]?.label.toLowerCase() || '';
                    const lowerHeader = headerText.toLowerCase();
                    
                    if (firstItemText.includes('сезон') || lowerHeader.includes('сезон')) {
                        data.seasons = listData;
                    } else if (firstItemText.includes('серия') || lowerHeader.includes('серия')) {
                        data.episodes = listData;
                    }
                });

                if (data.seasons.length > 0 || data.episodes.length > 0) {
                    data.hasSeries = true;
                }
                
                // DIAGNOSTIC LOG (scanForSeriesData)
                // Only log if something interesting happens to avoid spamming every frame
                if (data.hasSeries) {
                   // console.log('=== ДИАГНОСТИКА player-cleaner (scanForSeriesData) ===', data);
                }

                return data;
            };

            const getActiveSeriesInfo = () => {
                const data = scanForSeriesData();
                let season = null;
                let episode = null;

                if (data.seasons.length > 0) {
                     const activeS = data.seasons.find(s => s.isActive);
                     if (activeS) season = activeS.label;
                }
                
                if (data.episodes.length > 0) {
                     const activeE = data.episodes.find(e => e.isActive);
                     if (activeE) episode = activeE.label;
                }
                
                return { season, episode };
            };

            const getProgressKey = () => {
                let key = 'movieExtension_progress_' + window.location.pathname.replace(/\W/g, '_');
                const info = getActiveSeriesInfo();
                if (info.season) key += '_' + info.season.replace(/\s+/g, '');
                if (info.episode) key += '_' + info.episode.replace(/\s+/g, '');
                return key;
            };
            
            const saveProgress = () => {
                if (video.currentTime > 5 && video.duration > 0) {
                    const key = getProgressKey();
                    // Don't save if near the end (e.g. < 30s remaining) to avoid stuck at credits
                    if (video.duration - video.currentTime > 30) {
                        localStorage.setItem(key, video.currentTime);
                    } else {
                        localStorage.removeItem(key); 
                    }
                }
            };

            const restoreProgress = () => {
                const key = getProgressKey();
                const savedTime = parseFloat(localStorage.getItem(key));
                // console.log('[MovieExtension] Restoring progress for key:', key, 'Time:', savedTime);
                if (savedTime && !isNaN(savedTime) && video.duration) {
                    // Sanity check
                    if (savedTime < video.duration - 5) {
                        // Restore with -10 seconds rewind for context
                        video.currentTime = Math.max(0, savedTime - 10);
                    }
                }
            };

            // Save periodically
            setInterval(saveProgress, 5000);
            video.addEventListener('pause', saveProgress);
            window.addEventListener('beforeunload', saveProgress);
            
            // Restore
            video.addEventListener('loadedmetadata', restoreProgress);
            // Try immediately if ready
            if (video.readyState >= 1) restoreProgress();
            
            video.addEventListener('ended', () => {
                localStorage.removeItem(getProgressKey());
            });
            // --- PERSISTENT PROGRESS END ---

            progressContainer.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus(); // Fix focus
                const rect = progressContainer.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const width = rect.width;
                const percent = Math.max(0, Math.min(1, clickX / width));
                
                // Use current video
                const currentVid = permanentVideo || video;
                
                console.log('[MovieExtension] Progress click. Percent:', percent, 'Duration:', currentVid.duration);

                if (Number.isFinite(currentVid.duration) && currentVid.duration > 0) {
                     const newTime = currentVid.duration * percent;
                     
                     // Update progress bar IMMEDIATELY (visual feedback)
                     progressFilled.style.width = `${percent * 100}%`;
                     
                     currentVid.currentTime = newTime;
                     console.log('[MovieExtension] Seeked to:', newTime);
                     
                     // Update time display immediately (don't wait for timeupdate event)
                     if (timeDisplay) {
                         timeDisplay.textContent = `${formatTime(newTime)} / ${formatTime(currentVid.duration)}`;
                     }
                } else {
                    console.warn('[MovieExtension] Cannot seek - invalid duration:', currentVid.duration);
                }
            });

            // Hover Logic (Time Only)
            progressContainer.addEventListener('mousemove', (e) => {
                const rect = progressContainer.getBoundingClientRect();
                const hoverX = e.clientX - rect.left;
                const width = rect.width;
                const percent = Math.max(0, Math.min(1, hoverX / width));
                
                // Show tooltip visual position immediately
                thumbTooltip.style.display = 'block';
                thumbTooltip.style.left = `${percent * 100}%`;

                // Calculate time and format with hours
                // Use permanentVideo if available to ensure we check current video
                const currentVid = permanentVideo || video;
                const duration = Number.isFinite(currentVid.duration) ? currentVid.duration : 0;
                const time = duration * percent;
                thumbTooltip.textContent = formatTime(time);
            });

            progressContainer.addEventListener('mouseleave', () => {
                thumbTooltip.style.display = 'none';
            });
            // --- PROGRESS BAR END ---

            bottomControls.appendChild(progressContainer);
            
            // Loader
            const loader = document.createElement('div');
            loader.innerHTML = `
                <svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="25" cy="25" r="20" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-dasharray="80 200">
                        <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/>
                    </circle>
                </svg>
            `;
            loader.style.position = 'absolute';
            loader.style.top = '50%';
            loader.style.left = '50%';
            loader.style.transform = 'translate(-50%, -50%)';
            loader.style.zIndex = '2147483647';
            loader.style.pointerEvents = 'none';
            loader.style.display = 'none'; 
            controlsOverlay.appendChild(loader);

            // Visibility Logic
            let isHovering = false;
            let isLoading = false;
            let isUserInactive = false;
            let inactivityTimeout;
            
            const updateVisibility = () => {
                const currentVid = permanentVideo || video;
                const shouldShow = (isHovering && !isUserInactive) || (currentVid ? currentVid.paused : true);
                const opacity = shouldShow ? '1' : '0';
                
                // Hide cursor when controls are hidden (and inactive)
                newContainer.style.cursor = shouldShow ? 'default' : 'none';
                
                // Update bottom controls
                bottomControls.style.opacity = opacity;
                
                // Toggle class for CSS-based subtitle movement
                if (shouldShow) {
                    newContainer.classList.add('controls-visible');
                } else {
                    newContainer.classList.remove('controls-visible');
                }
                
                // Update viewing indicator
                if (viewingPositionIndicator) {
                     viewingPositionIndicator.style.opacity = opacity;
                }
                
                // Update center button visibility
                // Hide center button if loading
                centerPlayBtn.style.opacity = (shouldShow && !isLoading) ? opacity : '0';

                // Also update top-left selector if needed (wrapper)
                const voiceoverSelect = newContainer.querySelector('#nativeVoiceoverSelect')?.parentElement;
                if (voiceoverSelect) {
                    voiceoverSelect.style.opacity = opacity;
                    voiceoverSelect.style.transition = 'opacity 0.3s';
                }
            };

            const showLoader = () => {
                isLoading = true;
                loader.style.display = 'block';
                // Force update visibility to hide play button immediately
                updateVisibility();
            };

            const hideLoader = () => {
                isLoading = false;
                loader.style.display = 'none';
                updateVisibility();
            };

            // Loading Events
            // Handled in setupVideoListeners now
            /*
            video.addEventListener('waiting', showLoader);
            video.addEventListener('seeking', showLoader);
            
            video.addEventListener('playing', hideLoader);
            video.addEventListener('seeked', hideLoader);
            video.addEventListener('canplay', hideLoader);
            video.addEventListener('canplaythrough', hideLoader);
            
            video.addEventListener('playing', hideLoader);
            video.addEventListener('canplay', hideLoader);
            video.addEventListener('pause', hideLoader);
            video.addEventListener('error', hideLoader);
            */

            newContainer.addEventListener('mouseenter', () => {
                isHovering = true;
                isUserInactive = false;
                updateVisibility();
                resetInactivityTimer();
            });
            
            newContainer.addEventListener('mouseleave', () => {
                isHovering = false;
                updateVisibility();
                clearTimeout(inactivityTimeout);
            });

            // Activity / Inactivity Logic
            const resetInactivityTimer = () => {
                clearTimeout(inactivityTimeout);
                isUserInactive = false;
                updateVisibility(); // Show immediately on movement
                
                const currentVid = permanentVideo || video;
                
                if (isHovering && currentVid && !currentVid.paused) {
                    inactivityTimeout = setTimeout(() => {
                        isUserInactive = true;
                        updateVisibility();
                    }, 3000);
                }
            };
            
            newContainer.addEventListener('mousemove', resetInactivityTimer);
            newContainer.addEventListener('click', resetInactivityTimer);
            document.addEventListener('keydown', (e) => {
                // Ensure player is active
                if (!document.body.contains(newContainer)) return;

                resetInactivityTimer();
                
                 // Method 3: Global keydown handler to ensure shortcuts work
                // regardless of what element is focused (buttons, etc.)
                const currentVid = permanentVideo || video;
                if (!currentVid) return;

                // Ignore if user is typing in an input
                if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

                switch(e.key) {
                    case 'ArrowLeft':
                        e.preventDefault();
                        e.stopPropagation();
                        if (Number.isFinite(currentVid.duration)) {
                             currentVid.currentTime = Math.max(0, currentVid.currentTime - 5);
                             // Trigger timeupdate manually or wait for event? Event will fire.
                             // But for instant update if paused:
                             if (typeof updateTime === 'function') updateTime();
                             
                             // Show progress bar update?
                             if (progressFilled) {
                                  const percent = (currentVid.currentTime / currentVid.duration) * 100;
                                  progressFilled.style.width = `${percent}%`;
                             }
                        }
                        break;
                    case 'ArrowRight':
                         e.preventDefault();
                         e.stopPropagation();
                         if (Number.isFinite(currentVid.duration)) {
                             currentVid.currentTime = Math.min(currentVid.duration, currentVid.currentTime + 5);
                             if (typeof updateTime === 'function') updateTime();
                              if (progressFilled) {
                                  const percent = (currentVid.currentTime / currentVid.duration) * 100;
                                  progressFilled.style.width = `${percent}%`;
                             }
                        }
                         break;
                    case ' ':
                    case 'Space': 
                        e.preventDefault();
                        e.stopPropagation();
                        if (currentVid.paused) currentVid.play().catch(()=>{});
                        else currentVid.pause();
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        e.stopPropagation();
                         if (currentVid.volume < 1) {
                             currentVid.volume = Math.min(1, currentVid.volume + 0.1);
                             currentVid.muted = false;
                         }
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        e.stopPropagation();
                         if (currentVid.volume > 0) currentVid.volume = Math.max(0, currentVid.volume - 0.1);
                        break;
                     case 'f':
                     case 'F':
                        e.preventDefault();
                        e.stopPropagation();
                        if (typeof toggleFullscreen === 'function') toggleFullscreen();
                        break;
                }
            });

            // Call updateVisibility immediately so controls are visible on initial load when paused
            updateVisibility();

            console.log('=== ПРОВЕРКА DOM ===');
            const horizontalEpisodesCheck = document.querySelector('.horizontal-episodes'); // Note: Class might not exist, checking anyway
            console.log('Элемент horizontal-episodes найден (если есть):', horizontalEpisodesCheck);
            // Check for our custom wrapper
            console.log('Native Player Wrapper:', newContainer);

            // Play/Pause Button
            const playPauseBtn = document.createElement('button');
            playPauseBtn.style.background = 'none';
            playPauseBtn.style.border = 'none';
            playPauseBtn.style.cursor = 'pointer';
            playPauseBtn.style.color = 'white';
            playPauseBtn.style.padding = '5px';
            
            const updatePlayBtnIcon = () => {
                // Use current video always
                const currentVid = permanentVideo || video;
                
                if (currentVid.paused) {
                    // Bottom Btn: Play
                    playPauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>';
                    // Center Btn: Play (Large)
                    centerPlayBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>';
                } else {
                    // Bottom Btn: Pause
                    playPauseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
                    // Center Btn: Pause (Large)
                    centerPlayBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
                }
            };
            
            updatePlayBtnIcon();
            playPauseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentVid = permanentVideo || video;
                if (currentVid) currentVid.focus(); // Fix focus
                console.log('[MovieExtension] Play/Pause clicked. Current state:', currentVid.paused ? 'paused' : 'playing');
                if (currentVid.paused) {
                     currentVid.play().catch(err => console.error('[MovieExtension] Play error:', err));
                } else {
                     currentVid.pause();
                }
            });

            // --- SERIES / SEASON SELECTORS START ---


            const createCustomDropdown = (items, placeholder, onSelect) => {
                const container = document.createElement('div');
                container.style.position = 'relative';
                container.style.marginLeft = '10px';
                container.style.pointerEvents = 'auto'; // Ensure clickable
                container.className = 'custom-series-dropdown'; 

                const trigger = document.createElement('button');
                trigger.style.background = 'rgba(0, 0, 0, 0.6)';
                trigger.style.border = '1px solid rgba(255, 255, 255, 0.2)';
                trigger.style.borderRadius = '4px';
                trigger.style.color = 'white';
                trigger.style.padding = '8px 12px';
                trigger.style.cursor = 'pointer';
                trigger.style.fontSize = '14px';
                trigger.style.lineHeight = '1.2';
                trigger.style.boxSizing = 'border-box';
                trigger.style.height = '35.2px';
                trigger.style.display = 'flex';
                trigger.style.alignItems = 'center';
                trigger.style.gap = '5px';
                trigger.style.backdropFilter = 'blur(4px)';

                // Find active item
                let activeItem = items.find(i => i.isActive) || items[0];
                const activeLabel = document.createElement('span');
                activeLabel.textContent = activeItem ? activeItem.label : placeholder;
                trigger.appendChild(activeLabel);

                const arrow = document.createElement('div');
                arrow.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
                trigger.appendChild(arrow);

                container.appendChild(trigger);

                // Dropdown Menu
                const menu = document.createElement('div');
                menu.style.position = 'absolute';
                menu.style.top = '100%';
                menu.style.left = '0';
                menu.style.width = 'max-content';
                menu.style.minWidth = '100%';
                menu.style.maxHeight = '300px';
                menu.style.overflowY = 'auto';
                menu.style.background = 'rgba(28, 28, 30, 0.95)';
                menu.style.border = '1px solid rgba(255, 255, 255, 0.1)';
                menu.style.borderRadius = '4px';
                menu.style.marginTop = '4px';
                menu.style.display = 'none';
                menu.style.flexDirection = 'column';
                menu.style.zIndex = '2147483642';
                menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';

                items.forEach(item => {
                    const option = document.createElement('div');
                    option.style.padding = '8px 12px';
                    option.style.cursor = 'pointer';
                    option.style.color = item.isActive ? '#4da6ff' : 'white'; 
                    option.style.fontSize = '13px';
                    option.style.transition = 'background 0.2s';
                    option.textContent = item.label;

                    option.addEventListener('mouseenter', () => {
                        option.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    });
                    option.addEventListener('mouseleave', () => {
                        option.style.backgroundColor = 'transparent';
                    });

                    option.addEventListener('click', (e) => {
                        e.stopPropagation();
                        activeLabel.textContent = item.label;
                        menu.style.display = 'none';
                        if (onSelect) onSelect(item);
                    });

                    menu.appendChild(option);
                });

                container.appendChild(menu);

                // Toggle
                trigger.addEventListener('click', (e) => {
                    e.stopPropagation(); // prevent window click
                    // close others
                    document.querySelectorAll('.custom-series-dropdown > div').forEach(el => {
                         if (el !== menu) el.style.display = 'none';
                    });
                    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
                });

                // Close on outside click
                document.addEventListener('click', (e) => {
                    if (!container.contains(e.target)) {
                        menu.style.display = 'none';
                    }
                });

                // Update items method
                container.updateItems = (newItems) => {
                    menu.innerHTML = '';
                    items = newItems; // update closure
                    activeItem = items.find(i => i.isActive) || items[0];
                    activeLabel.textContent = activeItem ? activeItem.label : placeholder;
                    
                    items.forEach(item => {
                        const option = document.createElement('div');
                        option.textContent = item.label;
                        option.style.padding = '8px 12px';
                        option.style.cursor = 'pointer';
                        option.style.color = item.isActive ? '#4da6ff' : 'white';
                         option.style.fontSize = '13px';
                        option.style.transition = 'background 0.2s';
                        
                        option.addEventListener('mouseenter', () => option.style.backgroundColor = 'rgba(255, 255, 255, 0.1)');
                        option.addEventListener('mouseleave', () => option.style.backgroundColor = 'transparent');
                        
                        option.addEventListener('click', (e) => {
                            e.stopPropagation();
                            activeLabel.textContent = item.label;
                            menu.style.display = 'none';
                            if (onSelect) onSelect(item);
                        });
                        menu.appendChild(option);
                    });
                };

                return container;
            };

            // --- Watched Episodes Persistence ---
            const getWatchedKey = () => `movieExtension_watched_${window.location.pathname}`;
            
            const getWatchedEpisodes = () => {
                try {
                    const key = getWatchedKey();
                    return JSON.parse(localStorage.getItem(key) || '[]');
                } catch (e) { return []; }
            };

            const markEpisodeAsWatched = (label) => {
                try {
                    const key = getWatchedKey();
                    const watched = getWatchedEpisodes();
                    if (!watched.includes(label)) {
                        watched.push(label);
                        localStorage.setItem(key, JSON.stringify(watched));
                    }
                } catch (e) {}
            };

            const createHorizontalEpisodeSelector = (items, seasons, placeholder, onSelect) => {
                console.log('=== РЕНДЕРИНГ HORIZONTAL-EPISODES ===');
                console.log('Items (Episodes):', items ? items.length : 0);
                console.log('Seasons passed to component:', seasons);
                console.log('Должен ли отображаться селектор (seasons.length > 1):', seasons && seasons.length > 1);
                // Removed container and trigger creation
                // Removed trigger styles and activeLabel/arrowIcon creation

                // Mark current as watched immediately
                let activeItem = items.find(i => i.isActive) || items[0];
                let activeIndex = items.indexOf(activeItem);
                if (activeItem) markEpisodeAsWatched(activeItem.label);

                // Modal Container - Positioned at Bottom
                const modal = document.createElement('div');
                modal.style.position = 'absolute';
                modal.style.bottom = '70px'; // Position above progress bar
                modal.style.top = 'unset';   // Remove top positioning
                modal.style.left = '20px';
                modal.style.right = '20px';
                modal.style.width = 'auto';
                modal.style.height = '140px';
                modal.style.background = 'rgba(0,0,0,0.95)';
                modal.style.backdropFilter = 'blur(10px)';
                modal.style.borderRadius = '12px';
                modal.style.display = 'none';
                modal.style.alignItems = 'center';
                modal.style.justifyContent = 'space-between';
                modal.style.padding = '0';
                modal.style.zIndex = '2147483630';
                modal.style.opacity = '0';
                modal.style.transition = 'opacity 0.2s ease';
                modal.style.boxSizing = 'border-box';
                modal.style.pointerEvents = 'auto';

                // Add to main player logic
                controlsOverlay.appendChild(modal);

                // Left Arrow
                const leftArrow = document.createElement('button');
                leftArrow.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" stroke="white" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>';
                leftArrow.style.background = 'transparent';
                leftArrow.style.border = 'none';
                leftArrow.style.cursor = 'pointer';
                leftArrow.style.padding = '0 20px';
                leftArrow.style.height = '100%';
                leftArrow.style.zIndex = '2';
                // Listener moved to end for accelerated scroll setup
                modal.appendChild(leftArrow);

                // Create inner wrappers
                const innerWrapper = document.createElement('div');
                innerWrapper.style.display = 'flex';
                innerWrapper.style.flexDirection = 'column';
                innerWrapper.style.width = '100%';
                innerWrapper.style.flex = '1'; // FIX: Allow shrinking/growing
                innerWrapper.style.minWidth = '0'; // FIX: Allow flex child to be smaller than content
                innerWrapper.style.overflow = 'hidden'; // FIX: Contain children
                innerWrapper.style.position = 'relative';

                // Season Tabs Container (Only if seasons exist)
                let seasonContainer = null;
                let lastKnownSeasonLabel = null; // Track current season for indicator

                // Helper to render seasons (defined here to capture scope)
                const renderSeasons = (seasonList) => {
                    if (!seasonContainer) {
                        seasonContainer = document.createElement('div');
                        seasonContainer.style.display = 'flex';
                        seasonContainer.style.flexDirection = 'row';
                        seasonContainer.style.gap = '10px';
                        seasonContainer.style.padding = '0 10px 10px 10px'; // Bottom padding
                        seasonContainer.style.overflowX = 'auto';
                        seasonContainer.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
                        seasonContainer.style.marginBottom = '10px';
                        seasonContainer.classList.add('hide-scrollbar'); // Reuse style
                        if (innerWrapper.firstChild === seasonContainer || !innerWrapper.contains(seasonContainer)) {
                             // Assuming it should be first
                             innerWrapper.insertBefore(seasonContainer, innerWrapper.firstChild);
                        }
                    }

                    seasonContainer.innerHTML = ''; // Clear old tabs

                    if (!seasonList || seasonList.length <= 1) {
                         seasonContainer.style.display = 'none';
                         console.log('Season container hidden (<= 1 season)');
                         return;
                    } else {
                         seasonContainer.style.display = 'flex';
                         console.log('Season container shown');
                    }

                    seasonList.forEach(season => {
                        const tab = document.createElement('div');
                        tab.textContent = season.label; // e.g., "1 сезон"
                        tab.style.padding = '4px 12px';
                        tab.style.borderRadius = '4px';
                        tab.style.fontSize = '13px'; // Slightly smaller
                        tab.style.fontWeight = '500';
                        tab.style.cursor = 'pointer';
                        tab.style.whiteSpace = 'nowrap';
                        tab.style.transition = 'all 0.2s';

                        const isActiveSeason = season.isActive;
                        if (isActiveSeason) {
                            tab.style.background = '#4da6ff';
                            tab.style.color = 'white';
                            lastKnownSeasonLabel = season.label; // Capture active season
                        } else {
                            tab.style.background = 'transparent';
                            tab.style.color = 'rgba(255,255,255,0.7)';
                        }

                        tab.addEventListener('mouseenter', () => {
                             if (!isActiveSeason) tab.style.color = 'white';
                        });
                        tab.addEventListener('mouseleave', () => {
                             if (!isActiveSeason) tab.style.color = 'rgba(255,255,255,0.7)';
                        });

                        tab.addEventListener('click', (e) => {
                             e.stopPropagation();
                             if (!isActiveSeason && season.element) {
                                 // Trigger original logic
                                 const evt = new MouseEvent('click', {bubbles: true, cancelable: true, view: window});
                                 evt.isInternalMovieExtensionClick = true; // FIX: Flag to ignore in document listener
                                 season.element.dispatchEvent(evt);

                                 // Optimistic UI update
                                 Array.from(seasonContainer.children).forEach(c => {
                                     c.style.background = 'transparent';
                                     c.style.color = 'rgba(255,255,255,0.7)';
                                 });
                                 tab.style.background = '#4da6ff';
                                 tab.style.color = 'white';

                                 // Wait for site to process and update our data
                                 setTimeout(() => {
                                     const newData = scanForSeriesData(); // Scans new DOM

                                     // Update Episodes
                                     if (returnedInterface.updateItems && newData.episodes.length > 0) {
                                         returnedInterface.updateItems(newData.episodes);
                                     }

                                     // FIX: Update Seasons (to get fresh element references)
                                     if (returnedInterface.updateSeasons && newData.seasons.length > 0) {
                                         returnedInterface.updateSeasons(newData.seasons);
                                     }

                                    // FIX: Re-scan voiceovers as they likely changed with the season
                                    console.log('[MovieExtension] Season changed, re-scanning voiceovers...');
                                    if (typeof findAndRenderVoiceovers === 'function') {
                                         // Give a bit more time for site to render the new voiceover list
                                         setTimeout(() => {
                                             findAndRenderVoiceovers(controlsOverlay, newContainer);
                                         }, 500);
                                    }
                                 }, 800);
                             }
                        });

                        seasonContainer.appendChild(tab);
                    });
                };

                console.log('=== ПРОВЕРКА ОТОБРАЖЕНИЯ СЕЛЕКТОРА ===');
                console.log('Seasons check:', seasons);
                if (seasons && seasons.length > 1) {
                    console.log('Rendering seasons...');
                    renderSeasons(seasons);
                } else {
                    console.log('Skipping season rendering (not enough seasons)');
                }



                // Scroll Container (Episodes)
                const scrollContainer = document.createElement('div');
                scrollContainer.style.display = 'flex';
                scrollContainer.style.gap = '10px';
                scrollContainer.style.overflowX = 'auto';
                scrollContainer.style.scrollBehavior = 'smooth';
                scrollContainer.style.width = '100%'; // FIX: Ensure it takes full width of wrapper
                scrollContainer.style.height = '100%';
                scrollContainer.style.alignItems = 'center';
                scrollContainer.style.padding = '0 10px';
                scrollContainer.style.scrollbarWidth = 'none'; // Firefox
                // Hide scrollbar chrome
                const style = document.createElement('style');
                style.textContent = `.horizontal-episodes::-webkit-scrollbar { display: none; .hide-scrollbar::-webkit-scrollbar { display: none; } }`;
                modal.appendChild(style);
                scrollContainer.classList.add('horizontal-episodes');

                // Add episodes to inner
                innerWrapper.appendChild(scrollContainer);

                // Toggle Logic
                const toggleModal = () => {
                   if (modal.style.display === 'flex') {
                        modal.style.opacity = '0';
                        setTimeout(() => modal.style.display = 'none', 200);
                    } else {
                        modal.style.display = 'flex';
                        // Trigger reflow
                        modal.offsetHeight;
                        modal.style.opacity = '1';
                        // Scroll to active INSTANTLY (disable smooth)
                        scrollContainer.style.scrollBehavior = 'auto';
                        const activeCard = scrollContainer.children[activeIndex];
                        if (activeCard) {
                            activeCard.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
                        }
                        // Re-enable smooth scroll for user interactions
                        setTimeout(() => {
                            scrollContainer.style.scrollBehavior = 'smooth';
                        }, 50);
                    }
                };

                // Add document listener for clicking OUTSIDE
                document.addEventListener('click', (e) => {
                    // Check if it's our internal proxy event
                    if (e.isInternalMovieExtensionClick) return;

                    // Note: We need to handle the trigger check externally or assign it later
                    // Ideally we should just check if click is NOT in modal
                    // but we also need to avoid checking the button that opened it (which is handled by stopPropagation there)
                    if (modal.style.display === 'flex' && !modal.contains(e.target)) {
                        // Check if target is the new episode button (we'll rely on stopPropagation in the button click)
                        modal.style.display = 'none';
                    }
                });

                const renderItems = (itemList) => {
                    const watchedEpisodes = getWatchedEpisodes();
                    scrollContainer.innerHTML = '';
                    // Recalc active
                    activeItem = itemList.find(i => i.isActive) || itemList[0];
                    activeIndex = itemList.indexOf(activeItem);
                    
                    // Update indicator
                    if (activeItem) {
                        updateViewingIndicatorText(lastKnownSeasonLabel, activeItem.label);
                    }

                    itemList.forEach((item, index) => {
                        const card = document.createElement('div');
                        card.style.minWidth = '80px';
                        card.style.height = '30px'; // 50px as requested
                        card.style.background = 'rgba(255,255,255,0.05)';
                        card.style.border = '1px solid rgba(255,255,255,0.1)';
                        card.style.borderRadius = '6px';
                        card.style.display = 'flex';
                        card.style.flexDirection = 'column';
                        card.style.justifyContent = 'center';
                        card.style.padding = '0 10px'; // Reduced vertical padding
                        card.style.cursor = 'pointer';
                        card.style.transition = 'all 0.2s';
                        card.style.position = 'relative';
                        card.style.flexShrink = '0'; // Prevent shrinking

                        const seriesName = document.createElement('div');
                        seriesName.textContent = item.label;
                        seriesName.style.fontSize = '14px'; // Slightly smaller to fit better
                        seriesName.style.fontWeight = '500';
                        seriesName.style.textAlign = 'center';
                        seriesName.style.whiteSpace = 'nowrap';
                        seriesName.style.overflow = 'hidden';
                        seriesName.style.textOverflow = 'ellipsis';
                        card.appendChild(seriesName);

                        // Styling based on state
                        // Styling based on state
                        if (index === activeIndex) {
                            // Current Active -> Blue
                            card.style.color = '#4da6ff';
                            card.style.borderColor = '#4da6ff';
                            card.style.background = 'rgba(77, 166, 255, 0.1)';

                            // Blue dot indicator
                            const indicator = document.createElement('div');
                            indicator.style.width = '6px';
                            indicator.style.height = '6px';
                            indicator.style.background = '#4da6ff';
                            indicator.style.borderRadius = '50%';
                            indicator.style.position = 'absolute';
                            indicator.style.top = '6px'; // adjusted for 50px height
                            indicator.style.right = '6px';
                            card.appendChild(indicator);
                        } else if (watchedEpisodes.includes(item.label)) {
                            // Watched -> Gray
                            card.style.color = '#888';
                            card.style.borderColor = 'rgba(255,255,255,0.05)';
                        } else {
                            // Unwatched/Future -> White
                            card.style.color = 'white';
                            card.style.borderColor = 'rgba(255,255,255,0.1)';
                        }

                        card.addEventListener('mouseenter', () => {
                             if (index !== activeIndex) card.style.background = 'rgba(255,255,255,0.1)';
                        });
                        card.addEventListener('mouseleave', () => {
                            if (index === activeIndex) card.style.background = 'rgba(77, 166, 255, 0.1)';
                            else if (watchedEpisodes.includes(item.label)) card.style.background = 'rgba(255,255,255,0.05)';
                            else card.style.background = 'rgba(255,255,255,0.05)';
                        });


                        card.addEventListener('click', (e) => {
                            e.stopPropagation();
                            markEpisodeAsWatched(item.label); // Mark as watched
                            modal.style.display = 'none';
                            modal.style.opacity = '0';

                            // Set Auto-Play Flag
                            localStorage.setItem('movieExtension_autoplay_next', 'true');
                            localStorage.setItem('movieExtension_autoplay_start_time', Date.now().toString());

                            // Update Internal State & UI
                            items.forEach(i => i.isActive = false);
                            item.isActive = true;
                            activeIndex = index;
                            activeItem = item;
                            renderItems(itemList);

                            // Track for Sync
                            pendingActiveEpisodeLabel = item.label;
                            
                            sendProgressUpdate(item.label); // Send update on click

                            if (onSelect) onSelect(item);
                        });


                        scrollContainer.appendChild(card);
                    });
                };
                modal.appendChild(innerWrapper); // FIX: Ensure content is added to modal
                // controlsOverlay.appendChild(modal); // Already appended above

                const rightArrow = document.createElement('button');
                rightArrow.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" stroke="white" stroke-width="2" fill="none"><polyline points="9 18 15 12 9 6"></polyline></svg>';
                rightArrow.style.background = 'transparent';
                rightArrow.style.border = 'none';
                rightArrow.style.cursor = 'pointer';
                rightArrow.style.padding = '0 20px';
                rightArrow.style.height = '100%';
                rightArrow.style.zIndex = '2';
                // Listener moved to end for accelerated scroll setup
                modal.appendChild(rightArrow);

                // Initial Render
                renderItems(items);

                // Removed trigger.addEventListener('click', ...)

                // Public update method for external calls (like when season changes)
                // Removed container.updateItems = ...

                // Removed container.updateItems = ... (duplicate)

                // Removed container.updateSeasons = ...

                // Removed container.setVideoActive = ...

                // Removed container.getNavState = ...

                // Removed container.navigate = ...

                // Accelerated Scrolling Logic
                const setupAcceleratedScroll = (btn, direction) => {
                    let intervalId = null;
                    let startTime = 0;
                    const baseSpeed = 10; // pixels per frame (start speed)
                    // At 60fps, 10px = 600px/s.
                    // Max speed 5x = 50px/frame = 3000px/s.

                    const startScroll = (e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        startTime = Date.now();
                        let isContinuous = false;

                        const loop = () => {
                            const now = Date.now();
                            const elapsed = now - startTime;

                            if (elapsed > 200) { // Enter continuous mode after 200ms hold
                                isContinuous = true;
                                if (scrollContainer.style.scrollBehavior !== 'auto') {
                                    scrollContainer.style.scrollBehavior = 'auto'; // Disable smooth for direct manipulation
                                }

                                // Acceleration: 0 to 10s -> 1x to 5x
                                const accelTime = Math.min(elapsed - 200, 10000);
                                const factor = 1 + (accelTime / 10000) * 4;
                                const step = baseSpeed * factor;

                                scrollContainer.scrollLeft += step * direction;

                                // Boundary check (optional, browser handles it but good to stop loop if stuck?)
                                // But scrolling past end is harmless.
                            }

                            intervalId = requestAnimationFrame(loop);
                        };

                        intervalId = requestAnimationFrame(loop);

                        const stopScroll = () => {
                            if (intervalId) {
                                cancelAnimationFrame(intervalId);
                                intervalId = null;
                            }

                            document.removeEventListener('mouseup', stopScroll);
                            document.removeEventListener('mouseleave', stopScroll);
                            btn.removeEventListener('mouseleave', stopScroll);

                            // Reset scroll behavior
                            scrollContainer.style.scrollBehavior = 'smooth';

                            // If short click, do standard jump
                            if (!isContinuous) {
                                scrollContainer.scrollBy({ left: 300 * direction, behavior: 'smooth' });
                            }
                        };

                        document.addEventListener('mouseup', stopScroll);
                        document.addEventListener('mouseleave', stopScroll); // Stop if mouse leaves window
                        btn.addEventListener('mouseleave', stopScroll); // Stop if mouse leaves button
                    };

                    btn.addEventListener('mousedown', startScroll);
                };

                setupAcceleratedScroll(leftArrow, -1);
                setupAcceleratedScroll(rightArrow, 1);

                // --- PROGRESS UPDATE HELPER ---
                const sendProgressUpdate = (episodeLabel, previousTimestamp) => {
                    try {
                        const currentSeasonLabel = seasonContainer ? 
                            (Array.from(seasonContainer.children).find(c => c.style.background === 'rgb(77, 166, 255)' || c.style.background === '#4da6ff')?.textContent || seasons[0]?.label || '') 
                            : '';
                        
                        // Use previousTimestamp if provided (saving progress of episode we're LEAVING)
                        const ts = (typeof previousTimestamp === 'number' && previousTimestamp > 0) 
                            ? Math.floor(previousTimestamp) 
                            : 0;
                        
                        console.log('[MovieExtension] Sending progress update:', currentSeasonLabel, episodeLabel, 'timestamp:', ts);
                        
                        window.parent.postMessage({
                            type: 'UPDATE_WATCHING_PROGRESS',
                            season: currentSeasonLabel,
                            episode: episodeLabel,
                            timestamp: ts
                        }, '*');
                        
                        // Also notify about episode change for anime skip functionality
                        // Extract episode number from label (e.g., "1 серия" -> 1)
                        const episodeMatch = episodeLabel.match(/(\d+)/);
                        const episodeNumber = episodeMatch ? parseInt(episodeMatch[1], 10) : 1;
                        
                        window.parent.postMessage({
                            type: 'EPISODE_CHANGED',
                            episode: episodeNumber,
                            episodeLabel: episodeLabel
                        }, '*');
                        
                        // Clear current skip data until new data arrives
                        animeSkipData = null;
                        if (skipButton) {
                            skipButton.style.display = 'none';
                            skipButtonVisible = false;
                        }
                        
                    } catch (err) {
                        console.error('[MovieExtension] Failed to send progress update:', err);
                    }
                };
                // -----------------------------

                // Return Interface Object
                const returnedInterface = {
                    updateItems: (newItems) => {
                        items = newItems; // items is closure variable
                        renderItems(items);
                        // Update label logic removed as label is gone from trigger
                        activeItem = items.find(i => i.isActive) || items[0];
                    },
                    updateSeasons: (newSeasons) => {
                        seasons = newSeasons;
                        renderSeasons(seasons);
                    },
                    setVideoActive: (label) => {
                         console.log('[MovieExtension] setVideoActive called for:', label);
                         const idx = items.findIndex(i => i.label === label);
                         console.log('[MovieExtension] Found index:', idx);
                         if (idx !== -1) {
                             items.forEach(i => i.isActive = false);
                             items[idx].isActive = true;
                             activeIndex = idx;
                             activeItem = items[idx];
                             renderItems(items);
                             if (typeof callbacks.triggerUpdate === 'function') {
                                 callbacks.triggerUpdate();
                             }
                         }
                    },
                    getNavState: () => {
                        return {
                            hasPrev: activeIndex > 0,
                            hasNext: activeIndex < items.length - 1,
                            prevItem: activeIndex > 0 ? items[activeIndex - 1] : null,
                            nextItem: activeIndex < items.length - 1 ? items[activeIndex + 1] : null,
                            currentItem: activeItem
                        };
                    },
                    navigate: (direction) => {
                         const newIndex = activeIndex + direction;
                         if (newIndex >= 0 && newIndex < items.length) {
                             const targetItem = items[newIndex];
                             markEpisodeAsWatched(targetItem.label);
                             items.forEach(i => i.isActive = false);
                             targetItem.isActive = true;
                             activeIndex = newIndex;
                             activeItem = targetItem;
                             renderItems(items);
                             sendProgressUpdate(targetItem.label); // Send update on navigation
                             if (onSelect) onSelect(targetItem);
                             return true;
                         }
                         return false;
                    },
                    toggle: toggleModal,
                    // Self-reference placeholder
                    triggerUpdate: null
                };
                return returnedInterface;
            };

            // Helper for triggerUpdate
            const callbacks = { triggerUpdate: null }; // Shared object to simulate container.triggerUpdate

            const seriesData = scanForSeriesData();

            // Top Controls Bar
            let topControls = controlsOverlay.querySelector('.top-controls-bar');
            if (!topControls) {
                topControls = document.createElement('div');
                topControls.style.position = 'absolute';
                topControls.style.top = '20px';
                topControls.style.left = '20px';
                topControls.style.display = 'flex';
                topControls.style.gap = '10px';
                topControls.style.zIndex = '2147483625';
                topControls.style.pointerEvents = 'auto'; // Enable clicks
                topControls.className = 'top-controls-bar';
                controlsOverlay.appendChild(topControls);
            }

            /* 
            // Bottom Controls Bar (Already exists in scope)
            let bottomControls = controlsOverlay.querySelector('.bottom-controls-bar');
            if (!bottomControls) { ... }
            */

            if (seriesData.hasSeries) {
                // Episode Selector
                if (seriesData.episodes.length > 0) {
                    // Use new Horizontal Selector
                    episodeDropdown = createHorizontalEpisodeSelector(seriesData.episodes, seriesData.seasons || [], 'Серия', (selectedItem) => {

                         if (selectedItem.element) {
                             selectedItem.element.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
                         }
                         // navigate() calls onSelect.
                         // If we use navigate(), we update UI.
                         // If user clicks item manually, onSelect is called.
                         
                         // We need to ensure updateNavButtons is called.
                         // We will rely on the monkey-patch we added later:
                         // if (episodeDropdown) { ... episodeDropdown.updateItems = ... }
                         
                         // Wait, if I click manually, onSelect runs.
                         // Does generic `navigate` run? No.
                         // So we need to call updateNavButtons.
                         
                         // Since updateNavButtons is not yet defined, we can defer it or call it via a property we set later.
                         if (episodeDropdown && typeof episodeDropdown.triggerUpdate === 'function') {
                             episodeDropdown.triggerUpdate();
                         }
                    });
                    
                    // Expose updateActive method to sync with video changes (Stub or mapped to existing if needed)
                    // episodeDropdown.updateActive = ... (REMOVED: handled via setVideoActive in interface)
                    
                    // DO NOT append episodeDropdown to topControls as it is an interface object now
                    // topControls.appendChild(episodeDropdown);
                    
                    // Listen for episode restoration from SeasonvarParser
                    document.addEventListener('episodeRestored', (e) => {
                        const { label } = e.detail || {};
                        console.log('[MovieExtension] episodeRestored event received:', label);
                        if (label && episodeDropdown && typeof episodeDropdown.setVideoActive === 'function') {
                            episodeDropdown.setVideoActive(label);
                            // Also trigger nav button update
                            if (typeof episodeDropdown.triggerUpdate === 'function') {
                                episodeDropdown.triggerUpdate();
                            }
                        }
                    });
                    
                    // Initialize skip times on first load by notifying parent
                    setTimeout(() => {
                        const activeItem = episodeDropdown.getNavState && episodeDropdown.getNavState().currentItem;
                        const activeLabel = activeItem ? activeItem.label : (seriesData.episodes.find(e => e.isActive)?.label || seriesData.episodes[0]?.label);
                        if (activeLabel) {
                            const episodeMatch = activeLabel.match(/(\d+)/);
                            const episodeNumber = episodeMatch ? parseInt(episodeMatch[1], 10) : 1;
                            console.log(`[MovieExtension] Player first load init: sending EPISODE_CHANGED for ${activeLabel}`);
                            window.parent.postMessage({
                                type: 'EPISODE_CHANGED',
                                episode: episodeNumber,
                                episodeLabel: activeLabel
                            }, '*');
                        }
                    }, 500);
                }
            }

            // Time Display
            const timeDisplay = document.createElement('span');
            timeDisplay.style.color = 'white';
            timeDisplay.style.fontFamily = 'Arial, sans-serif';
            timeDisplay.style.fontSize = '14px';
            timeDisplay.textContent = '0:00 / 0:00';
            timeDisplay.style.zIndex = '2'; // Ensure visibility
            timeDisplay.style.position = 'relative';

            const formatTime = (seconds) => {
                const h = Math.floor(seconds / 3600);
                const m = Math.floor((seconds % 3600) / 60);
                const s = Math.floor(seconds % 60);
                return (h > 0 ? h + ':' : '') + (m < 10 && h > 0 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
            };
            // --- Auto-Play Logic ---
            const checkAutoPlay = () => {
                const autoPlayFlag = localStorage.getItem('movieExtension_autoplay_next');
                if (autoPlayFlag === 'true') {
                    localStorage.removeItem('movieExtension_autoplay_next');
                    
                    let isPlayPending = false;
                    const attemptPlay = () => {
                        if (isPlayPending) return;
                        isPlayPending = true;
                        
                        const p = video.play();
                        if (p && p.catch) {
                            p.catch(e => { /* ignore */ })
                             .finally(() => { isPlayPending = false; });
                        } else {
                            isPlayPending = false;
                        }
                    };

                    // Aggressive polling to start as soon as possible
                    const interval = setInterval(() => {
                        if (!video.paused) {
                            clearInterval(interval);
                            // Log Performance
                            const startTime = localStorage.getItem('movieExtension_autoplay_start_time');
                            if (startTime) {
                                const duration = Date.now() - parseInt(startTime, 10);
                            console.log(`[MovieExtension] Auto-play latency: ${duration}ms`);
                                localStorage.removeItem('movieExtension_autoplay_start_time');
                            }
                            return;
                        }
                        // Increase readyState requirement to 3 (HAVE_FUTURE_DATA) to avoid HLS buffering pauses
                        if (video.readyState >= 3) { 
                           attemptPlay();
                        }
                    }, 100);

                    // Stop trying after 5 seconds to prevent infinite loops
                    setTimeout(() => clearInterval(interval), 5000);
                }
            };
            // Check immediately on new player init
            checkAutoPlay();

            const updateTime = () => {
                const current = video.currentTime || 0;
                const total = video.duration || 0;
                timeDisplay.textContent = `${formatTime(current)} / ${formatTime(total)}`;
            };

            // Video Events
            video.addEventListener('play', () => {
                updatePlayBtnIcon();
                updateVisibility();
            });
            video.addEventListener('ended', () => {
                // Clear saved progress for this video
                const key = getSavedKey(); // Assuming getSavedKey() is defined elsewhere
                localStorage.removeItem(key);
                
                // Set flag for auto-playing the next video
                localStorage.setItem('movieExtension_autoplay_next', 'true');
                localStorage.setItem('movieExtension_autoplay_start_time', Date.now().toString());
            });
            video.addEventListener('pause', () => {
                updatePlayBtnIcon();
                updateVisibility();
            });
            video.addEventListener('timeupdate', updateTime);
            video.addEventListener('loadedmetadata', updateTime);

            // Track progress for movies (send timestamp to parent)
            let lastProgressUpdate = 0;
            const PROGRESS_UPDATE_INTERVAL = 30000; // 30 seconds
            
            video.addEventListener('timeupdate', () => {
                const now = Date.now();
                if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL) {
                    lastProgressUpdate = now;
                    
                    const timestamp = Math.floor(video.currentTime);
                    const info = getActiveSeriesInfo();
                    
                    // Send progress to parent window
                    if (window.parent && video.currentTime > 0 && !isNaN(video.duration)) {
                        const progressData = {
                            type: 'UPDATE_WATCHING_PROGRESS',
                            timestamp: timestamp,
                            season: info.season,
                            episode: info.episode
                        };
                        
                        window.parent.postMessage(progressData, '*');
                    }
                }
            });

            // Left Controls Group
            const leftControls = document.createElement('div');
            leftControls.style.display = 'flex';
            leftControls.style.alignItems = 'center';
            leftControls.style.gap = '10px'; // Slightly reduced gap for tighter controls
            leftControls.appendChild(playPauseBtn);

            // --- Navigation Buttons (Prev/Next) ---
            let updateNavButtons = () => {}; // Default no-op
            
            if (seriesData.hasSeries) {
                const prevEpisodeBtn = document.createElement('button');
                const nextEpisodeBtn = document.createElement('button');
                
                // Common styles
                [prevEpisodeBtn, nextEpisodeBtn].forEach(btn => {
                    btn.style.background = 'none';
                    btn.style.border = 'none';
                    btn.style.cursor = 'pointer';
                    btn.style.color = 'white';
                    btn.style.padding = '5px';
                    btn.style.display = 'flex'; 
                    btn.style.alignItems = 'center';
                    btn.style.justifyContent = 'center';
                    btn.style.opacity = '1';
                    btn.style.transition = 'opacity 0.2s, color 0.2s';
                    btn.style.position = 'relative'; // For tooltip
                });
    
                // Icons
                prevEpisodeBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
                nextEpisodeBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
    
                // Tooltips
                const createTooltip = (text) => {
                    const el = document.createElement('div');
                    el.textContent = text;
                    el.style.position = 'absolute';
                    el.style.bottom = '100%';
                    el.style.left = '50%';
                    el.style.transform = 'translate(-50%, -10px)';
                    el.style.background = 'rgba(0,0,0,0.8)';
                    el.style.color = 'white';
                    el.style.padding = '4px 8px';
                    el.style.borderRadius = '4px';
                    el.style.fontSize = '12px';
                    el.style.whiteSpace = 'nowrap';
                    el.style.pointerEvents = 'none';
                    el.style.opacity = '0';
                    el.style.transition = 'opacity 0.2s';
                    return el;
                };
    
                const prevTooltip = createTooltip('');
                const nextTooltip = createTooltip('');
                prevEpisodeBtn.appendChild(prevTooltip);
                nextEpisodeBtn.appendChild(nextTooltip);
    
                // Hover effects
                const setupHover = (btn, tooltip) => {
                    btn.addEventListener('mouseenter', () => {
                        if (!btn.disabled) {
                            btn.style.color = '#4da6ff'; // Active color
                            tooltip.style.opacity = '1';
                        }
                    });
                    btn.addEventListener('mouseleave', () => {
                        btn.style.color = 'white';
                        tooltip.style.opacity = '0';
                    });
                };
                setupHover(prevEpisodeBtn, prevTooltip);
                setupHover(nextEpisodeBtn, nextTooltip);
    
                // Logic to update buttons
                updateNavButtons = () => {
                    // Check if we have episodes
                    if (episodeDropdown && typeof episodeDropdown.getNavState === 'function') {
                        const state = episodeDropdown.getNavState();
                        
                        // Prev Button State
                        if (state.hasPrev) {
                            prevEpisodeBtn.disabled = false;
                            prevEpisodeBtn.style.opacity = '1';
                            prevEpisodeBtn.style.cursor = 'pointer';
                            prevTooltip.textContent = `Назад: ${state.prevItem.label}`;
                        } else {
                            prevEpisodeBtn.disabled = true;
                            prevEpisodeBtn.style.opacity = '0.3';
                            prevEpisodeBtn.style.cursor = 'default';
                            prevTooltip.textContent = '';
                        }
    
                        // Next Button State
                        if (state.hasNext) {
                            nextEpisodeBtn.disabled = false;
                            nextEpisodeBtn.style.opacity = '1';
                            nextEpisodeBtn.style.cursor = 'pointer';
                            nextTooltip.textContent = `Вперед: ${state.nextItem.label}`;
                        } else {
                            nextEpisodeBtn.disabled = true;
                            nextEpisodeBtn.style.opacity = '0.3';
                            nextEpisodeBtn.style.cursor = 'default';
                            nextTooltip.textContent = '';
                        }
                    }
                };
    
                // Actions
                prevEpisodeBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (permanentVideo) permanentVideo.focus(); // Fix focus
                    if (episodeDropdown && typeof episodeDropdown.navigate === 'function') {
                        episodeDropdown.navigate(-1);
                        updateNavButtons();
                    }
                };
                nextEpisodeBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (permanentVideo) permanentVideo.focus(); // Fix focus
                     if (episodeDropdown && typeof episodeDropdown.navigate === 'function') {
                        episodeDropdown.navigate(1);
                        updateNavButtons();
                    }
                };
    
                leftControls.appendChild(prevEpisodeBtn);
                leftControls.appendChild(nextEpisodeBtn);
                
                // Initial check
                setTimeout(updateNavButtons, 500); // Wait for episodeDropdown to potentially init
            } // End if (seriesData.hasSeries)

            if (episodeDropdown) {
                // Patch the navigate/update methods or add a listener
                const originalUpdate = episodeDropdown.updateItems;
                episodeDropdown.updateItems = (newItems) => {
                    if (originalUpdate) originalUpdate(newItems);
                    updateNavButtons();
                };
                
                // Allow callback to trigger update
                episodeDropdown.triggerUpdate = updateNavButtons;
                callbacks.triggerUpdate = updateNavButtons;
                
                // Also hook into the onSelect side-effect?
                // The onSelect callback is defined at creation.
                // We'll rely on the fact that `renderItems` inside `createHorizontalEpisodeSelector` 
                // is called when `navigate` is used.
                
                // Let's also attach this function to the container so we can call it from outside if needed
                leftControls.updateNavButtons = updateNavButtons;
            }

            // --- RESTORE PROGRESS IMPLEMENTATION ---
            window.movieExtension_restoreProgress = (targetSeason, targetEpisode) => {
                 console.log('[MovieExtension] Executing restore logic:', targetSeason, targetEpisode);
                 if (!targetSeason && !targetEpisode) return;

                 // 1. Switch Season if needed
                 if (targetSeason && seriesData.seasons && seriesData.seasons.length > 0) {
                     // Check current season (native check or our UI check)
                     // Since we don't track "active season" easily in a variable here without lookup.
                     // But we have the season selector UI elements if we can find them.
                     // The `createHorizontalEpisodeSelector` call used `seriesData.seasons`.
                     // The `updateSeasons` callback updates a local `seasons` variable in the closure.
                     
                     // We need to trigger the CLICK on the season tab.
                     // We can find the tab by text content.
                     const allDivs = document.querySelectorAll('div');
                     let seasonTab = null;
                     for (let div of allDivs) {
                         if (div.textContent.trim() === targetSeason) {
                             // Check if it looks like a season tab (background style)
                             if (div.style.background.includes('255, 255, 255, 0.1') || div.style.background === 'rgb(77, 166, 255)' || div.style.background === '#4da6ff') {
                                 seasonTab = div;
                                 break;
                             }
                         }
                     }
                     
                     if (seasonTab) {
                          console.log('[MovieExtension] Clicking season tab:', seasonTab);
                          seasonTab.click();
                     } else {
                          console.warn('[MovieExtension] Season tab not found:', targetSeason);
                     }
                 }
                 
                 // 2. Select Episode
                 setTimeout(() => {
                     if (targetEpisode && episodeDropdown) {
                         // Use interface method
                         if (typeof episodeDropdown.setVideoActive === 'function') {
                             console.log('[MovieExtension] Setting active video:', targetEpisode);
                             episodeDropdown.setVideoActive(targetEpisode);
                             
                             // Also ensure we "click" it to trigger side-effects (video load)?
                             // setVideoActive updates UI. Does it load video?
                             // No, setVideoActive only updates UI state.
                             // toggleModal/navigate logic handled clicks.
                             
                             // We need to find the item and execute the click handler to actually load the video.
                             // But we don't have direct access to the `item` objects array to trigger their onclick easily 
                             // unless we expose it.
                             
                             // Alternative: Trigger click on the rendered card in DOM.
                             // The `createHorizontalEpisodeSelector` renders cards.
                             const allDivs = document.querySelectorAll('div');
                             let episodeCard = null;
                             for (let div of allDivs) {
                                  // Episode cards have minWidth 60px/100px and text content
                                  if (div.textContent.trim() === targetEpisode) {
                                      // Check style props unique to cards
                                      if (div.style.minWidth === '60px' || div.style.minWidth === '100px') {
                                          episodeCard = div;
                                          break;
                                      }
                                  }
                             }
                             
                             if (episodeCard) {
                                 console.log('[MovieExtension] Clicking episode card:', episodeCard);
                                 episodeCard.click();
                             } else {
                                 console.warn('[MovieExtension] Episode card not found:', targetEpisode);
                             }
                         }
                     }
                 }, 800); // Wait for season switch to populate episodes
            };
            // ---------------------------------------

            leftControls.appendChild(timeDisplay);

            // Right Controls Group
            const rightControls = document.createElement('div');
            rightControls.style.display = 'flex';
            rightControls.style.alignItems = 'center';
            rightControls.style.gap = '15px';
            rightControls.style.marginLeft = 'auto'; // Push to right

            // Volume Control
            const volumeContainer = document.createElement('div');
            volumeContainer.style.position = 'relative';
            volumeContainer.style.display = 'flex';
            volumeContainer.style.alignItems = 'center';
            volumeContainer.style.cursor = 'pointer';

            const volumeBtn = document.createElement('button');
            volumeBtn.style.background = 'none';
            volumeBtn.style.border = 'none';
            volumeBtn.style.cursor = 'pointer';
            volumeBtn.style.color = 'white';
            volumeBtn.style.padding = '5px';
            volumeBtn.style.display = 'flex';
            volumeBtn.style.alignItems = 'center';
            volumeBtn.style.justifyContent = 'center'; // Center icon
            volumeBtn.style.width = '40px'; // Fixed width to prevent jumps
            volumeBtn.style.height = '40px'; 

            const volHighIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
            const volLowIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
            const volMuteIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';

            const updateVolumeIcon = () => {
                const currentVid = permanentVideo || video;
                if (!currentVid) return; // Safety
                
                if (currentVid.muted || currentVid.volume === 0) {
                    volumeBtn.innerHTML = volMuteIcon;
                } else if (currentVid.volume < 0.5) {
                    volumeBtn.innerHTML = volLowIcon;
                } else {
                     volumeBtn.innerHTML = volHighIcon;
                }
            };
            updateVolumeIcon();
            volumeContainer.appendChild(volumeBtn);

            // Custom Vertical Slider
            const sliderContainer = document.createElement('div');
            sliderContainer.style.position = 'absolute';
            sliderContainer.style.bottom = '35px'; // Above icon
            sliderContainer.style.left = '50%';
            sliderContainer.style.transform = 'translateX(-50%)';
            sliderContainer.style.width = '32px';
            sliderContainer.style.height = '100px';
            sliderContainer.style.backgroundColor = 'rgba(20, 20, 25, 0.9)'; // Dark box
            sliderContainer.style.borderRadius = '16px';
            sliderContainer.style.padding = '12px 0';
            sliderContainer.style.display = 'none'; 
            sliderContainer.style.flexDirection = 'column';
            sliderContainer.style.alignItems = 'center';
            sliderContainer.style.justifyContent = 'center';
            sliderContainer.style.cursor = 'default'; // Don't inherit pointer
            sliderContainer.style.zIndex = '2147483643';

            const volTrack = document.createElement('div');
            volTrack.style.width = '4px';
            volTrack.style.height = '80px';
            volTrack.style.backgroundColor = 'rgba(255,255,255,0.2)';
            volTrack.style.borderRadius = '2px';
            volTrack.style.position = 'relative';
            volTrack.style.cursor = 'pointer';

            const volFill = document.createElement('div');
            volFill.style.position = 'absolute';
            volFill.style.bottom = '0';
            volFill.style.left = '0';
            volFill.style.width = '100%';
            volFill.style.height = (video.volume * 100) + '%';
            volFill.style.backgroundColor = '#4da6ff'; // Blue
            volFill.style.borderRadius = '2px';
            
            const volKnob = document.createElement('div');
            volKnob.style.width = '12px';
            volKnob.style.height = '12px';
            volKnob.style.backgroundColor = '#4da6ff';
            volKnob.style.borderRadius = '50%';
            volKnob.style.position = 'absolute';
            volKnob.style.top = '0'; // Relative to fill top
            volKnob.style.left = '50%';
            volKnob.style.transform = 'translate(-50%, -50%)';
            
            volFill.appendChild(volKnob);
            volTrack.appendChild(volFill);
            sliderContainer.appendChild(volTrack);
            volumeContainer.appendChild(sliderContainer);

            // Volume Interactions
            // Load saved volume from localStorage
            const VOLUME_STORAGE_KEY = 'movieExtension_videoVolume';
            
            let intendedVolume = 1; // Default
            let lastVolume = 1; 
            let isEnforcing = false;

            // Helper to set volume safely and enforce it
            const setVolumeSafe = (vol, isMuted) => {
                isEnforcing = true;
                intendedVolume = vol;
                
                // Set state on current video
                if (permanentVideo) {
                    permanentVideo.volume = vol;
                    permanentVideo.muted = isMuted;
                }
                
                // Save to localStorage
                localStorage.setItem(VOLUME_STORAGE_KEY, vol.toString());
                
                // Update UI immediately
                updateVolumeUI();

                setTimeout(() => { isEnforcing = false; }, 50);
            };

            const updateVolumeUI = () => {
                if (!permanentVideo) return;
                const percent = permanentVideo.muted ? 0 : permanentVideo.volume;
                volFill.style.height = (percent * 100) + '%';
                updateVolumeIcon();
            };
            
            // Helper to attach listeners to ANY video element
            const setupVideoListeners = (videoEl) => {
                if (!videoEl || videoEl.dataset.ghost === 'true' || videoEl.classList.contains('ghost-video')) return;
                console.log('[MovieExtension] Setting up listeners for video:', videoEl);
                
                // Remove old listeners if any (not easily possible with anonymous functions unless we track them, 
                // but since we destroy old video elements, it's fine)
                
                // Auto-Play & State logic
                const checkAutoPlay = () => {
                   const autoPlayFlag = localStorage.getItem('movieExtension_autoplay_next');
                   if (autoPlayFlag === 'true') {
                       localStorage.removeItem('movieExtension_autoplay_next');
                       videoEl.play().catch(() => {});
                   }
                };
                checkAutoPlay(); // Check on init

                const updateTime = () => {
                    const current = videoEl.currentTime || 0;
                    const total = Number.isFinite(videoEl.duration) ? videoEl.duration : 0;
                    timeDisplay.textContent = `${formatTime(current)} / ${formatTime(total)}`;
                    
                    // Update Progress Bar
                    if (progressFilled && total > 0) {
                        const percent = (current / total) * 100;
                        progressFilled.style.width = `${percent}%`;
                    }

                    // Scenario 4: Detect video element mismatch
                    if (permanentVideo && videoEl !== permanentVideo) {
                        console.warn(`[SkipError] timeupdate firing on stale video element — listener bound to different video than permanentVideo`);
                    }

                    // Check anime skip button
                    checkSkipButtonVisibility(current);
                };

                videoEl.addEventListener('play', () => {
                    console.log('[MovieExtension] Video Event: play');
                    updatePlayBtnIcon();
                    updateVisibility();
                    hideLoader();
                });
                
                videoEl.addEventListener('ended', () => {
                    console.log('[MovieExtension] Video Event: ended');
                    const key = getSavedKey(); 
                    localStorage.removeItem(key);
                    localStorage.setItem('movieExtension_autoplay_next', 'true');
                    localStorage.setItem('movieExtension_autoplay_start_time', Date.now().toString());
                    hideLoader();
                });
                
                videoEl.addEventListener('pause', () => {
                    console.log('[MovieExtension] Video Event: pause');
                    updatePlayBtnIcon();
                    updateVisibility();
                    hideLoader();
                });
                
                videoEl.addEventListener('timeupdate', updateTime);
                videoEl.addEventListener('loadedmetadata', () => {
                    console.log('[MovieExtension] Video Event: loadedmetadata. Duration:', videoEl.duration);
                    updateTime();
                });
                
                // Loader Events
                videoEl.addEventListener('waiting', () => {
                    console.log('[MovieExtension] Video Event: waiting');
                    showLoader();
                });
                videoEl.addEventListener('seeking', () => {
                    console.log('[MovieExtension] Video Event: seeking');
                    showLoader();
                });
                videoEl.addEventListener('seeked', () => {
                    console.log('[MovieExtension] Video Event: seeked');
                    hideLoader();
                    checkSkipButtonVisibility(videoEl.currentTime);
                });
                videoEl.addEventListener('playing', () => {
                    console.log('[MovieExtension] Video Event: playing');
                    hideLoader();
                });
                videoEl.addEventListener('canplay', () => {
                    console.log('[MovieExtension] Video Event: canplay');
                    hideLoader();
                });
                videoEl.addEventListener('canplaythrough', () => {
                    console.log('[MovieExtension] Video Event: canplaythrough');
                    hideLoader();
                });
                videoEl.addEventListener('error', (e) => {
                    console.error('[MovieExtension] Video Event: error', e);
                    hideLoader();
                    
                    const src = videoEl.src || videoEl.currentSrc || '';
                    if (src && !isValidMediaSrc(src)) {
                        console.warn('[MovieExtension] Error on video with non-media src — likely bad swap occurred. src:', src);
                    }
                });
                
                // Volume Enforcement
                videoEl.addEventListener('volumechange', (e) => {
                    if (!isEnforcing && (Math.abs(videoEl.volume - intendedVolume) > 0.01 || videoEl.muted !== (intendedVolume === 0))) {
                         if (videoEl.volume !== intendedVolume) {
                             videoEl.volume = intendedVolume;
                             videoEl.muted = (intendedVolume === 0);
                         }
                    }
                    updateVolumeUI();
                    e.stopImmediatePropagation();
                }, true);
            };

            // INITIAL SETUP
            
            // 1. Load Volume
            const savedVolume = localStorage.getItem(VOLUME_STORAGE_KEY);
            if (savedVolume !== null) {
                const vol = parseFloat(savedVolume);
                if (!isNaN(vol) && vol >= 0 && vol <= 1) {
                    permanentVideo.volume = vol;
                    permanentVideo.muted = (vol === 0);
                    intendedVolume = vol;
                }
            }
            // Update UI initially
            updateVolumeUI();
            
            // 2. Attach listeners to initial video
            setupVideoListeners(permanentVideo);
            
            // Expose for swap logic
            window._movieExtension_setupListeners = setupVideoListeners;

            volumeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus(); // Fix focus
                if (permanentVideo.muted || permanentVideo.volume === 0) {
                    setVolumeSafe(lastVolume || 1, false);
                } else {
                    lastVolume = permanentVideo.volume > 0 ? permanentVideo.volume : 1;
                    setVolumeSafe(0, true);
                }
            });

            // Hover Logic
            let volTimeout;
            volumeContainer.addEventListener('mouseenter', () => {
                clearTimeout(volTimeout);
                sliderContainer.style.display = 'flex';
            });
            volumeContainer.addEventListener('mouseleave', () => {
                volTimeout = setTimeout(() => {
                    sliderContainer.style.display = 'none';
                }, 200);
            });


            // Drag Logic
            const updateVolumeFromEvent = (e) => {
                const rect = volTrack.getBoundingClientRect();
                const clientY = e.clientY;
                // Bottom is 0, Top is height
                let percent = (rect.bottom - clientY) / rect.height;
                percent = Math.max(0, Math.min(1, percent));
                
                setVolumeSafe(percent, percent === 0);
            };

            let isDraggingVol = false;
            volTrack.addEventListener('mousedown', (e) => {
                isDraggingVol = true;
                e.stopPropagation(); // prevent player click
                updateVolumeFromEvent(e);
            });
            
            document.addEventListener('mousemove', (e) => {
                if (isDraggingVol) {
                    e.preventDefault();
                    updateVolumeFromEvent(e);
                }
            });

            document.addEventListener('mouseup', () => {
                isDraggingVol = false;
            });
            
            
            // Replaced by Capture Phase listener above
            /*
            video.addEventListener('volumechange', () => {
                const percent = video.muted ? 0 : video.volume;
                volFill.style.height = (percent * 100) + '%';
                updateVolumeIcon();
                console.log('[MovieExtension] Volume changed event. Muted:', video.muted, 'Volume:', video.volume);
            });
            */

            // --- EPISODE LIST BUTTON ---
            if (episodeDropdown && seriesData.hasSeries) {
                const episodeListBtn = document.createElement('button');
                episodeListBtn.className = 'episode-list-btn';
                episodeListBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" height="26px" width="26px" version="1.1" id="Capa_1" viewBox="0 0 261.791 261.791" xml:space="preserve"><><path style="fill:#ffffff;" d="M213.02,58.899h-59.203l48-45.983c2.991-2.866,3.093-7.613,0.227-10.604   c-2.866-2.991-7.613-3.093-10.604-0.227l-59.308,56.815h-0.533L88.83,17.557c-2.979-2.879-7.727-2.798-10.605,0.18   c-2.879,2.978-2.798,7.726,0.18,10.605l31.612,30.558H48.771c-12.407,0-22.5,10.093-22.5,22.5v134.764   c0,12.407,10.093,22.5,22.5,22.5H213.02c12.406,0,22.5-10.093,22.5-22.5V81.399C235.52,68.993,225.426,58.899,213.02,58.899z    M220.52,216.163c0,4.135-3.364,7.5-7.5,7.5H48.771c-4.135,0-7.5-3.365-7.5-7.5V81.399c0-4.135,3.365-7.5,7.5-7.5H213.02   c4.136,0,7.5,3.365,7.5,7.5V216.163z"/>	</g></svg>`;
                episodeListBtn.style.background = 'none';
                episodeListBtn.style.border = 'none';
                episodeListBtn.style.cursor = 'pointer';
                episodeListBtn.style.padding = '5px';
                episodeListBtn.style.width = '40px'; 
                episodeListBtn.style.height = '40px';
                episodeListBtn.style.opacity = '0.7'; 
                episodeListBtn.style.display = 'flex';
                episodeListBtn.style.alignItems = 'center';
                episodeListBtn.style.justifyContent = 'center';
                episodeListBtn.style.color = 'white'; // FIX: Ensure icon is white initially
                episodeListBtn.title = 'Список серий';
                
                episodeListBtn.addEventListener('mouseenter', () => {
                    episodeListBtn.style.opacity = '1';
                    episodeListBtn.style.color = '#4da6ff'; // Highlight color
                });
                episodeListBtn.addEventListener('mouseleave', () => {
                    episodeListBtn.style.opacity = '0.7';
                    episodeListBtn.style.color = 'white';
                });
                
                episodeListBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (permanentVideo) permanentVideo.focus(); // Fix focus
                    if (episodeDropdown.toggle) episodeDropdown.toggle();
                });
                
                rightControls.appendChild(episodeListBtn);
            }

            // --- SUBTITLES BUTTON START ---
            const subtitlesBtn = document.createElement('button');
            subtitlesBtn.className = 'subtitles-toggle-btn';
            subtitlesBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="#ffffffff" width="32px" height="32px" viewBox="0 0 512 512"><title>subtitles</title><path d="M96 416Q82 416 73 407 64 398 64 384L64 128Q64 114 73 105 82 96 96 96L416 96Q430 96 439 105 448 114 448 128L448 384Q448 398 439 407 430 416 416 416L96 416ZM176 296L176 256 112 256 112 296 176 296ZM400 296L400 256 208 256 208 296 400 296ZM304 368L304 328 112 328 112 368 304 368ZM400 368L400 328 336 328 336 368 400 368Z"/></svg>`;
            subtitlesBtn.style.background = 'none';
            subtitlesBtn.style.border = 'none';
            subtitlesBtn.style.cursor = 'pointer';
            subtitlesBtn.style.padding = '5px';
            subtitlesBtn.style.width = '40px'; 
            subtitlesBtn.style.height = '40px';
            subtitlesBtn.style.opacity = '0.7'; 
            subtitlesBtn.style.display = 'flex';
            subtitlesBtn.style.alignItems = 'center';
            subtitlesBtn.style.justifyContent = 'center';
            subtitlesBtn.title = 'Субтитры';
            
            // Subtitle Persistence Keys (Moved to shared scope)
            // const SUB_ENABLED_KEY = 'movieExtension_subs_enabled';
            // const SUB_TRACK_KEY = 'movieExtension_subs_track';

            const updateSubBtnState = (isEnabled) => {
                subtitlesBtn.style.opacity = isEnabled ? '1' : '0.7';
                const path = subtitlesBtn.querySelector('path');
                if (path) path.setAttribute('fill', isEnabled ? '#4da6ff' : '#fff');
            };

            const toggleSubtitles = () => {
                // Use current video
                const currentVid = permanentVideo || video;
                const tracks = Array.from(currentVid.textTracks || []);
                console.log('[MovieExtension] Toggling subtitles. Found tracks:', tracks.length);
                
                if (tracks.length === 0) return;

                // Check if currently enabled (any track showing)
                const activeTrack = tracks.find(t => t.mode === 'showing');
                console.log('[MovieExtension] Current active track:', activeTrack);
                
                if (activeTrack) {
                    // Turn OFF
                    tracks.forEach(t => t.mode = 'disabled');
                    localStorage.setItem(SUB_ENABLED_KEY, 'false');
                    updateSubBtnState(false);
                    console.log('[MovieExtension] Subtitles disabled');
                } else {
                    // Turn ON
                    // 1. Try saved specific track
                    const savedLabel = localStorage.getItem(SUB_TRACK_KEY);
                    let targetTrack = null;

                    if (savedLabel) {
                        targetTrack = tracks.find(t => t.label === savedLabel);
                    }

                    // 2. If no saved or not found, try "Rus" defaults
                    if (!targetTrack) {
                        targetTrack = tracks.find(t => {
                            const l = (t.label || '').toLowerCase();
                            const lang = (t.language || '').toLowerCase();
                            return l.includes('rus') || l.includes('рус') || lang === 'ru';
                        });
                    }

                    // 3. Fallback to first available
                    if (!targetTrack) targetTrack = tracks[0];

                    if (targetTrack) {
                        tracks.forEach(t => t.mode = 'disabled');
                        targetTrack.mode = 'showing';
                        localStorage.setItem(SUB_ENABLED_KEY, 'true');
                        // Also save this as the current preference if none existed
                        if (!savedLabel) {
                            localStorage.setItem(SUB_TRACK_KEY, targetTrack.label);
                        }
                        updateSubBtnState(true);
                        console.log('[MovieExtension] Subtitles enabled. Track:', targetTrack.label);
                    } else {
                         console.warn('[MovieExtension] No suitable track found to enable');
                    }
                }
            };

            subtitlesBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus(); // Fix focus
                toggleSubtitles();
            });

            rightControls.appendChild(subtitlesBtn);

            // Restore Subtitles State on Load
            const restoreSubtitles = () => {
                restoreSubtitlesLogic(video, newContainer);
            };

            video.addEventListener('loadeddata', restoreSubtitles);
            // Also try immediately
            setTimeout(restoreSubtitles, 1000);

            // --- SUBTITLES BUTTON END ---

            // --- PIP BUTTON START ---
            if (document.pictureInPictureEnabled) {
                const pipBtn = document.createElement('button');
                pipBtn.className = 'pip-toggle-btn';
                pipBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" x="0px" y="0px" viewBox="0 0 64 64" style="enable-background:new 0 0 64 64;" xml:space="preserve"><path fill="#ffffff" d="M55.156,30.219H33.781c-1.965,0-3.563,1.598-3.563,3.563v15.141c0,1.965,1.598,3.563,3.563,3.563h21.375  c1.965,0,3.563-1.598,3.563-3.563V33.781C58.719,31.817,57.121,30.219,55.156,30.219z M33.781,48.922V33.781h21.375l0.003,15.141  H33.781z"/><path fill="#ffffff" d="M27.851,17.139c-0.984,0-1.781,0.798-1.781,1.781v4.517l-5.776-5.776c-0.696-0.696-1.823-0.696-2.519,0  c-0.696,0.695-0.696,1.823,0,2.519l5.776,5.776h-4.517c-0.984,0-1.781,0.798-1.781,1.781c0,0.984,0.798,1.781,1.781,1.781h8.817  c0.117,0,0.234-0.012,0.349-0.035c0.053-0.01,0.102-0.03,0.153-0.045c0.06-0.018,0.121-0.032,0.18-0.056  c0.061-0.025,0.115-0.059,0.172-0.091c0.045-0.025,0.091-0.044,0.134-0.073c0.195-0.13,0.363-0.298,0.494-0.494  c0.03-0.044,0.05-0.093,0.075-0.139c0.03-0.055,0.064-0.109,0.088-0.167c0.025-0.06,0.039-0.122,0.057-0.183  c0.015-0.05,0.034-0.098,0.044-0.149c0.023-0.115,0.035-0.232,0.035-0.349V18.92C29.633,17.937,28.835,17.139,27.851,17.139z"/><path fill="#ffffff" d="M25.765,48.923H9.734c-0.491,0-0.891-0.399-0.891-0.891V15.969c0-0.491,0.399-0.891,0.891-0.891h44.531  c0.491,0,0.891,0.4,0.891,0.891v9.797c0,0.984,0.798,1.781,1.781,1.781c0.983,0,1.781-0.798,1.781-1.781v-9.797  c0.001-2.456-1.997-4.453-4.452-4.453H9.734c-2.455,0-4.453,1.998-4.453,4.453v32.063c0,2.455,1.998,4.453,4.453,4.453h16.031  c0.984,0,1.781-0.798,1.781-1.781C27.546,49.721,26.748,48.923,25.765,48.923z"/></svg>`;
                pipBtn.style.background = 'none';
                pipBtn.style.border = 'none';
                pipBtn.style.cursor = 'pointer';
                pipBtn.style.padding = '5px';
                pipBtn.style.width = '40px'; 
                pipBtn.style.height = '40px';
                pipBtn.style.opacity = '0.7'; 
                pipBtn.style.display = 'flex';
                pipBtn.style.alignItems = 'center';
                pipBtn.style.justifyContent = 'center';
                pipBtn.style.color = 'white'; 
                pipBtn.title = 'Картинка в картинке';

                pipBtn.addEventListener('mouseenter', () => {
                    if (!document.pictureInPictureElement) {
                        pipBtn.style.opacity = '1';
                        pipBtn.style.color = '#4da6ff';
                    }
                });
                pipBtn.addEventListener('mouseleave', () => {
                    if (!document.pictureInPictureElement) {
                        pipBtn.style.opacity = '0.7';
                        pipBtn.style.color = 'white';
                    }
                });

                pipBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const currentVid = permanentVideo || video;
                    if (currentVid) currentVid.focus(); 

                    if (document.pictureInPictureElement) {
                        document.exitPictureInPicture().catch(console.error);
                    } else if (currentVid) {
                        currentVid.requestPictureInPicture().catch(console.error);
                    }
                });

                const updatePipState = () => {
                    if (document.pictureInPictureElement) {
                        pipBtn.style.color = '#4da6ff';
                        pipBtn.style.opacity = '1';
                        // Ensure button stays visible/highlighted
                        pipBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" x="0px" y="0px" viewBox="0 0 64 64" style="enable-background:new 0 0 64 64;" xml:space="preserve"><path fill="#ffffff" d="M55.156,30.219H33.781c-1.965,0-3.563,1.598-3.563,3.563v15.141c0,1.965,1.598,3.563,3.563,3.563h21.375  c1.965,0,3.563-1.598,3.563-3.563V33.781C58.719,31.817,57.121,30.219,55.156,30.219z M33.781,48.922V33.781h21.375l0.003,15.141  H33.781z"/><path fill="#ffffff" d="M27.851,17.139c-0.984,0-1.781,0.798-1.781,1.781v4.517l-5.776-5.776c-0.696-0.696-1.823-0.696-2.519,0  c-0.696,0.695-0.696,1.823,0,2.519l5.776,5.776h-4.517c-0.984,0-1.781,0.798-1.781,1.781c0,0.984,0.798,1.781,1.781,1.781h8.817  c0.117,0,0.234-0.012,0.349-0.035c0.053-0.01,0.102-0.03,0.153-0.045c0.06-0.018,0.121-0.032,0.18-0.056  c0.061-0.025,0.115-0.059,0.172-0.091c0.045-0.025,0.091-0.044,0.134-0.073c0.195-0.13,0.363-0.298,0.494-0.494  c0.03-0.044,0.05-0.093,0.075-0.139c0.03-0.055,0.064-0.109,0.088-0.167c0.025-0.06,0.039-0.122,0.057-0.183  c0.015-0.05,0.034-0.098,0.044-0.149c0.023-0.115,0.035-0.232,0.035-0.349V18.92C29.633,17.937,28.835,17.139,27.851,17.139z"/><path fill="#ffffff" d="M25.765,48.923H9.734c-0.491,0-0.891-0.399-0.891-0.891V15.969c0-0.491,0.399-0.891,0.891-0.891h44.531  c0.491,0,0.891,0.4,0.891,0.891v9.797c0,0.984,0.798,1.781,1.781,1.781c0.983,0,1.781-0.798,1.781-1.781v-9.797  c0.001-2.456-1.997-4.453-4.452-4.453H9.734c-2.455,0-4.453,1.998-4.453,4.453v32.063c0,2.455,1.998,4.453,4.453,4.453h16.031  c0.984,0,1.781-0.798,1.781-1.781C27.546,49.721,26.748,48.923,25.765,48.923z"/></svg>`;
                        window.parent.postMessage({ type: 'PIP_ENTER' }, '*');
                    } else {
                        pipBtn.style.color = 'white';
                        pipBtn.style.opacity = '0.7';
                        pipBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" x="0px" y="0px" viewBox="0 0 64 64" style="enable-background:new 0 0 64 64;" xml:space="preserve"><path fill="#ffffff" d="M55.156,30.219H33.781c-1.965,0-3.563,1.598-3.563,3.563v15.141c0,1.965,1.598,3.563,3.563,3.563h21.375  c1.965,0,3.563-1.598,3.563-3.563V33.781C58.719,31.817,57.121,30.219,55.156,30.219z M33.781,48.922V33.781h21.375l0.003,15.141  H33.781z"/><path fill="#ffffff" d="M27.851,17.139c-0.984,0-1.781,0.798-1.781,1.781v4.517l-5.776-5.776c-0.696-0.696-1.823-0.696-2.519,0  c-0.696,0.695-0.696,1.823,0,2.519l5.776,5.776h-4.517c-0.984,0-1.781,0.798-1.781,1.781c0,0.984,0.798,1.781,1.781,1.781h8.817  c0.117,0,0.234-0.012,0.349-0.035c0.053-0.01,0.102-0.03,0.153-0.045c0.06-0.018,0.121-0.032,0.18-0.056  c0.061-0.025,0.115-0.059,0.172-0.091c0.045-0.025,0.091-0.044,0.134-0.073c0.195-0.13,0.363-0.298,0.494-0.494  c0.03-0.044,0.05-0.093,0.075-0.139c0.03-0.055,0.064-0.109,0.088-0.167c0.025-0.06,0.039-0.122,0.057-0.183  c0.015-0.05,0.034-0.098,0.044-0.149c0.023-0.115,0.035-0.232,0.035-0.349V18.92C29.633,17.937,28.835,17.139,27.851,17.139z"/><path fill="#ffffff" d="M25.765,48.923H9.734c-0.491,0-0.891-0.399-0.891-0.891V15.969c0-0.491,0.399-0.891,0.891-0.891h44.531  c0.491,0,0.891,0.4,0.891,0.891v9.797c0,0.984,0.798,1.781,1.781,1.781c0.983,0,1.781-0.798,1.781-1.781v-9.797  c0.001-2.456-1.997-4.453-4.452-4.453H9.734c-2.455,0-4.453,1.998-4.453,4.453v32.063c0,2.455,1.998,4.453,4.453,4.453h16.031  c0.984,0,1.781-0.798,1.781-1.781C27.546,49.721,26.748,48.923,25.765,48.923z"/></svg>`;
                        window.parent.postMessage({ type: 'PIP_EXIT' }, '*');
                    }
                };

                // Add to setupVideoListeners to ensure events are attached to current video
                const originalSetup = window._movieExtension_setupListeners;
                window._movieExtension_setupListeners = (v) => {
                    if (originalSetup) originalSetup(v);
                    v.addEventListener('enterpictureinpicture', updatePipState);
                    v.addEventListener('leavepictureinpicture', updatePipState);
                };
                
                // Also attach to current immediately
                if (permanentVideo) {
                    permanentVideo.addEventListener('enterpictureinpicture', updatePipState);
                    permanentVideo.addEventListener('leavepictureinpicture', updatePipState);
                }

                rightControls.appendChild(pipBtn);
            }
            // --- PIP BUTTON END ---

            rightControls.appendChild(volumeContainer);

            // Settings Button (User Provided)
            const settingsBtn = document.createElement('button');
            settingsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 512 512"><title>ionicons-v5-q</title><path d="M262.29,192.31a64,64,0,1,0,57.4,57.4A64.13,64.13,0,0,0,262.29,192.31ZM416.39,256a154.34,154.34,0,0,1-1.53,20.79l45.21,35.46A10.81,10.81,0,0,1,462.52,326l-42.77,74a10.81,10.81,0,0,1-13.14,4.59l-44.9-18.08a16.11,16.11,0,0,0-15.17,1.75A164.48,164.48,0,0,1,325,400.8a15.94,15.94,0,0,0-8.82,12.14l-6.73,47.89A11.08,11.08,0,0,1,298.77,470H213.23a11.11,11.11,0,0,1-10.69-8.87l-6.72-47.82a16.07,16.07,0,0,0-9-12.22,155.3,155.3,0,0,1-21.46-12.57,16,16,0,0,0-15.11-1.71l-44.89,18.07a10.81,10.81,0,0,1-13.14-4.58l-42.77-74a10.8,10.8,0,0,1,2.45-13.75l38.21-30a16.05,16.05,0,0,0,6-14.08c-.36-4.17-.58-8.33-.58-12.5s.21-8.27.58-12.35a16,16,0,0,0-6.07-13.94l-38.19-30A10.81,10.81,0,0,1,49.48,186l42.77-74a10.81,10.81,0,0,1,13.14-4.59l44.9,18.08a16.11,16.11,0,0,0,15.17-1.75A164.48,164.48,0,0,1,187,111.2a15.94,15.94,0,0,0,8.82-12.14l6.73-47.89A11.08,11.08,0,0,1,213.23,42h85.54a11.11,11.11,0,0,1,10.69,8.87l6.72,47.82a16.07,16.07,0,0,0,9,12.22,155.3,155.3,0,0,1,21.46,12.57,16,16,0,0,0,15.11,1.71l44.89-18.07a10.81,10.81,0,0,1,13.14,4.58l42.77,74a10.8,10.8,0,0,1-2.45,13.75l-38.21,30a16.05,16.05,0,0,0-6.05,14.08C416.17,247.67,416.39,251.83,416.39,256Z" style="fill:none;stroke:#ffffff;stroke-linecap:round;stroke-linejoin:round;stroke-width:32px"/></svg>`;
            settingsBtn.style.background = 'none';
            settingsBtn.style.border = 'none';
            settingsBtn.style.cursor = 'pointer';
            settingsBtn.style.padding = '5px';
            settingsBtn.title = 'Настройки';
            
            // Settings Menu Container
            const settingsMenu = document.createElement('div');
            settingsMenu.style.position = 'absolute';
            settingsMenu.style.bottom = '80px';
            settingsMenu.style.right = '20px';
            settingsMenu.style.backgroundColor = 'rgba(28, 28, 30, 0.95)';
            settingsMenu.style.borderRadius = '12px';
            settingsMenu.style.padding = '10px 0';
            settingsMenu.style.minWidth = '220px';
            settingsMenu.style.display = 'none';
            settingsMenu.style.flexDirection = 'column';
            settingsMenu.style.zIndex = '2147483645';
            settingsMenu.style.backdropFilter = 'blur(10px)';
            settingsMenu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
            settingsMenu.style.color = 'white';
            settingsMenu.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
            settingsMenu.style.fontSize = '14px';

            const createMenuItem = (label, value) => {
                const item = document.createElement('div');
                item.style.padding = '10px 15px';
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';
                item.style.cursor = 'pointer';
                item.style.transition = 'background 0.2s';
                
                item.innerHTML = `
                    <span style="opacity: 0.8">${label}</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-weight: 500">${value}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.6"><path d="M9 18l6-6-6-6"/></svg>
                    </div>
                `;

                item.addEventListener('mouseenter', () => item.style.backgroundColor = 'rgba(255,255,255,0.1)');
                item.addEventListener('mouseleave', () => item.style.backgroundColor = 'transparent');
                return item;
            };

            // Generic Sub-menu Renderer
            const renderSubMenuView = (title, items, activeCondition) => {
                settingsMenu.innerHTML = '';
                
                // Header with Back Button
                const header = document.createElement('div');
                header.style.padding = '10px 15px';
                header.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
                header.style.marginBottom = '5px';
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.gap = '10px';
                header.style.cursor = 'pointer';
                header.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg> <span style="font-weight:600">${title}</span>`;
                header.onclick = (e) => { e.stopPropagation(); renderMainView(); };
                settingsMenu.appendChild(header);

                // Items list
                const listContainer = document.createElement('div');
                listContainer.style.maxHeight = '200px';
                listContainer.style.overflowY = 'auto'; // Scrollable if many items

                items.forEach(item => {
                     const div = document.createElement('div');
                     div.style.padding = '8px 25px';
                     div.style.cursor = 'pointer';
                     div.style.display = 'flex';
                     div.style.justifyContent = 'space-between';
                     div.textContent = item.label;
                     
                     if (item.isActive) {
                         div.style.color = '#4da6ff';
                         div.innerHTML += ' ✓';
                     }
                     
                     div.addEventListener('mouseenter', () => div.style.backgroundColor = 'rgba(255,255,255,0.1)');
                     div.addEventListener('mouseleave', () => div.style.backgroundColor = 'transparent');
                     
                     div.onclick = (e) => {
                         e.stopPropagation();
                         item.action();
                         // Refresh view to show new active state
                         // We re-generate the items by calling the parent view function again
                         if (item.refreshFn) item.refreshFn();
                     };
                     listContainer.appendChild(div);
                });
                settingsMenu.appendChild(listContainer);
            };

            // Speed View
            const renderSpeedView = () => {
                const currentVid = permanentVideo || video;
                const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
                const items = rates.map(rate => ({
                    label: rate + 'x',
                    isActive: currentVid.playbackRate === rate,
                    action: () => {
                        currentVid.playbackRate = rate;
                        // Save preference?
                    },
                    refreshFn: renderSpeedView
                }));
                renderSubMenuView('Скорость', items);
            }

            // Subtitles View
            const renderSubsView = () => {
                const currentVid = permanentVideo || video;
                const tracks = Array.from(currentVid.textTracks || []);
                // Add "Off" option
                const items = [{
                    label: 'Откл',
                    isActive: tracks.every(t => t.mode === 'disabled' || t.mode === 'hidden'), 
                    action: () => {
                         tracks.forEach(t => t.mode = 'disabled'); // Or hidden
                         localStorage.setItem(SUB_ENABLED_KEY, 'false');
                         updateSubBtnState(false);
                         updateSubBtnState(false);
                    },
                    refreshFn: renderSubsView
                }];

                if (tracks.length > 0) {
                    tracks.forEach((track, index) => {
                        // Skip if no label (often metadata tracks)
                        if (!track.label && !track.language) return; 
                        
                        items.push({
                            label: track.label || track.language || `Track ${index + 1}`,
                            isActive: track.mode === 'showing',
                            action: () => {
                                // Disable others
                                tracks.forEach(t => t.mode = 'disabled');
                                track.mode = 'showing';
                                
                                // Save Preference
                                localStorage.setItem(SUB_ENABLED_KEY, 'true');
                                if (track.label) {
                                    localStorage.setItem(SUB_TRACK_KEY, track.label);
                                }
                                updateSubBtnState(true);
                                
                                updateSubBtnState(true);
                            },
                            refreshFn: renderSubsView
                        });
                    });
                } else {
                }
                
                renderSubMenuView('Субтитры', items);
            };

            // Quality View
            // Generic scanner for controls
            const findControlOptions = (keywords) => {
                 const candidates = [];
                 const hasKeyword = (text) => keywords.some(k => text.includes(k));
                 
                 // Scan all divs/lis/spans
                 document.querySelectorAll('li, div, span, a').forEach(el => {
                    // Avoid our own UI
                    if (newContainer.contains(el)) return;
                    // Check text
                    const txt = el.textContent.trim();
                    if (txt.length < 20 && hasKeyword(txt)) {
                        candidates.push(el);
                    }
                 });
                 
                 // Group by parent
                 const parentMap = new Map();
                 candidates.forEach(el => {
                     const p = el.parentElement;
                     if (p) parentMap.set(p, (parentMap.get(p) || 0) + 1);
                 });
                 
                 // Find best parent
                 let bestParent = null;
                 let maxCount = 0;
                 parentMap.forEach((count, parent) => {
                     // Check if this parent looks like a list
                     if (count > maxCount) {
                         maxCount = count;
                         bestParent = parent;
                     }
                 });
                 
                 if (!bestParent || maxCount < 2) return [];
                 
                 // Extract items from best parent
                 const results = [];
                 Array.from(bestParent.children).forEach(child => {
                     const txt = child.textContent.trim();
                     if (txt) {
                         // Robust active check: partial class match or specific data attribute
                         const isActive = Array.from(child.classList).some(c => c.toLowerCase().includes('active') || c.toLowerCase().includes('selected'));
                         
                         results.push({
                             label: txt,
                             element: child,
                             isActive: isActive
                         });
                     }
                 });
                 return results;
            }

            const getQualityOptions = () => {
                const keywords = ['2160p', '1440p', '1080p', '720p', '480p', '360p', 'Auto', '4k', 'Ultra'];
                return findControlOptions(keywords);
            }

            const renderQualityView = () => {
                const options = getQualityOptions();
                
                if (options.length === 0) {
                    renderSubMenuView('Качество', [{label: 'Auto (Not found)', isActive: true, action: () => {}}]);
                    return;
                }

                const items = options.map(opt => ({
                    label: opt.label,
                    isActive: opt.isActive, 
                    action: () => {
                        opt.element.click();
                    },
                    refreshFn: () => {
                        setTimeout(renderQualityView, 200); 
                    }
                }));
                
                renderSubMenuView('Качество', items);
            }

            // Voiceover View
            const renderVoiceoverView = () => {
                const items = currentVoiceoverOptions.map(opt => ({
                    label: opt.name,
                    isActive: opt.isActive || false, 
                    action: () => {
                         let targetEl = opt.element;
                         
                         // Lazy Re-bind: Check if element is still in DOM
                         if (!targetEl || !document.body.contains(targetEl)) {
                             // Try to find a new element with the same text
                             // We re-run the heuristic search on the whole document (excluding our UI)
                             const allDivs = Array.from(document.querySelectorAll('div, span, li, a, button, b, i'));
                             const match = allDivs.find(el => {
                                 // Check for exact text match or very close
                                 return el.textContent.trim() === opt.name && !newContainer.contains(el);
                             });
                             
                             if (match) {
                                 targetEl = match;
                                 // Update reference for future
                                 opt.element = match;
                             }
                         }

                         if (targetEl && document.body.contains(targetEl)) {
                             targetEl.click();
                             // Update active state locally
                             currentVoiceoverOptions.forEach(o => o.isActive = false);
                             opt.isActive = true;
                             
                             // Re-scan from bridge after a short delay to pick up new active state
                             setTimeout(() => {
                                 findAndRenderVoiceovers(controlsOverlay, newContainer);
                                 renderVoiceoverView(); // Refresh the submenu view
                             }, 200);
                         }
                    },
                    refreshFn: renderVoiceoverView
                }));
                renderSubMenuView('Озвучка', items);
            };


            // Main View
            const renderMainView = () => {
                settingsMenu.innerHTML = '';
                const currentVid = permanentVideo || video;
                
                // Get current quality label
                const qualityOpts = getQualityOptions();
                const activeQuality = qualityOpts.find(o => o.isActive);
                const qualityLabel = activeQuality ? activeQuality.label : 'Auto';

                // Quality Item
                const qualityItem = createMenuItem('Качество', qualityLabel); 
                qualityItem.onclick = (e) => { e.stopPropagation(); renderQualityView(); };
                settingsMenu.appendChild(qualityItem);

                // Voiceover Item (New)
                if (currentVoiceoverOptions.length > 0) {
                    const activeVoiceover = currentVoiceoverOptions.find(o => o.isActive) || currentVoiceoverOptions[0];
                    const voiceLabel = activeVoiceover ? activeVoiceover.name : 'Unknown';
                    
                    const voiceItem = createMenuItem('Озвучка', voiceLabel);
                    voiceItem.onclick = (e) => { e.stopPropagation(); renderVoiceoverView(); };
                    settingsMenu.appendChild(voiceItem);
                }

                // Speed Item
                const speedItem = createMenuItem('Скорость', currentVid.playbackRate + 'x');
                speedItem.onclick = (e) => { e.stopPropagation(); renderSpeedView(); };
                settingsMenu.appendChild(speedItem);

                // Subtitles Item
                const tracks = Array.from(currentVid.textTracks || []);
                const activeTrack = tracks.find(t => t.mode === 'showing');
                // Clean up label (remove " - 1", " - 2" suffixes if present)
                let subLabel = activeTrack ? (activeTrack.label || activeTrack.language) : 'Откл';
                subLabel = subLabel.replace(/\s*-\s*\d+$/, ''); 

                const subsItem = createMenuItem('Субтитры', subLabel);
                subsItem.onclick = (e) => { e.stopPropagation(); renderSubsView(); };
                settingsMenu.appendChild(subsItem);
            };

            renderMainView();
            newContainer.appendChild(settingsMenu);

            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Focusing the video here might close the menu if we had a blur listener, 
                // but since we don't, it might just move keyboard focus.
                // However, if we want to navigate the menu with keys, we might NOT want to focus video?
                // But the user issue is about arrow keys affecting the video.
                // If the menu is open, maybe we WANT arrow keys to navigate the menu?
                // The current menu implementation uses DOM elements. 
                // If I focus video, the arrow keys will seek.
                // If the user wants to seek while menu is open, this is good.
                // If the user wants to navigate menu with arrows, this breaks it.
                // But currently, the menu doesn't seem to support keyboard nav (only click).
                // So focusing video is probably safer for the user's request.
                if (permanentVideo) permanentVideo.focus(); 
                
                if (settingsMenu.style.display === 'none') {
                    // Re-scan voiceovers to ensure freshness before showing
                    findAndRenderVoiceovers(controlsOverlay, newContainer);
                    renderMainView(); // Reset to main on open
                    settingsMenu.style.display = 'flex';
                } else {
                    settingsMenu.style.display = 'none';
                }
            });

            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
                    settingsMenu.style.display = 'none';
                }
            });

            // Fullscreen Button
            const fullscreenBtn = document.createElement('button');
            fullscreenBtn.style.background = 'none';
            fullscreenBtn.style.border = 'none';
            fullscreenBtn.style.cursor = 'pointer';
            fullscreenBtn.style.color = 'white';
            fullscreenBtn.style.padding = '5px';
            
            const updateFullIcon = () => {
                if (document.fullscreenElement) {
                     fullscreenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="#ffffffff" height="24px" width="24px" version="1.1" id="Layer_1" viewBox="0 0 512 512" xml:space="preserve"><g><g><g><path d="M505.752,6.248c-8.331-8.331-21.839-8.331-30.17,0L320,161.83V64c0-11.782-9.551-21.333-21.333-21.333     c-11.782,0-21.333,9.551-21.333,21.333v149.333c0,0.007,0.001,0.015,0.001,0.022c0.001,0.695,0.037,1.39,0.105,2.083     c0.031,0.318,0.091,0.627,0.136,0.94c0.054,0.375,0.098,0.75,0.171,1.122c0.071,0.359,0.17,0.708,0.259,1.061     c0.081,0.322,0.151,0.645,0.248,0.964c0.105,0.346,0.234,0.68,0.356,1.018c0.114,0.318,0.219,0.639,0.349,0.953     c0.131,0.316,0.284,0.618,0.43,0.926c0.152,0.323,0.296,0.649,0.465,0.966c0.158,0.295,0.338,0.575,0.509,0.861     c0.186,0.311,0.361,0.626,0.564,0.929c0.211,0.316,0.447,0.613,0.674,0.917c0.19,0.253,0.365,0.513,0.568,0.759     c0.892,1.087,1.889,2.085,2.977,2.977c0.246,0.202,0.506,0.378,0.759,0.568c0.304,0.228,0.601,0.463,0.917,0.674     c0.303,0.203,0.618,0.379,0.929,0.564c0.286,0.171,0.566,0.351,0.861,0.509c0.317,0.169,0.643,0.313,0.966,0.465     c0.308,0.145,0.611,0.299,0.926,0.43c0.314,0.13,0.635,0.235,0.953,0.349c0.338,0.122,0.672,0.251,1.018,0.356     c0.318,0.096,0.642,0.167,0.964,0.248c0.353,0.089,0.701,0.188,1.061,0.259c0.372,0.074,0.748,0.118,1.122,0.171     c0.314,0.045,0.622,0.104,0.94,0.136c0.693,0.068,1.388,0.105,2.083,0.105c0.007,0,0.015,0.001,0.022,0.001H448     c11.782,0,21.333-9.551,21.333-21.333c0-11.782-9.551-21.333-21.333-21.333h-97.83L505.752,36.418     C514.083,28.087,514.083,14.58,505.752,6.248z"/><path d="M234.56,296.562c-0.031-0.318-0.091-0.627-0.136-0.94c-0.054-0.375-0.098-0.75-0.171-1.122     c-0.071-0.359-0.17-0.708-0.259-1.061c-0.081-0.322-0.151-0.645-0.248-0.964c-0.105-0.346-0.234-0.68-0.356-1.018     c-0.114-0.318-0.219-0.639-0.349-0.953c-0.131-0.316-0.284-0.618-0.43-0.926c-0.152-0.323-0.296-0.649-0.465-0.966     c-0.158-0.295-0.338-0.575-0.509-0.861c-0.186-0.311-0.361-0.626-0.564-0.929c-0.211-0.316-0.447-0.613-0.674-0.917     c-0.19-0.253-0.365-0.513-0.568-0.759c-0.892-1.087-1.889-2.085-2.977-2.977c-0.246-0.202-0.506-0.378-0.759-0.568     c-0.304-0.228-0.601-0.463-0.917-0.674c-0.303-0.203-0.618-0.379-0.929-0.564c-0.286-0.171-0.566-0.351-0.861-0.509     c-0.317-0.169-0.643-0.313-0.966-0.465c-0.308-0.145-0.611-0.299-0.926-0.43c-0.314-0.13-0.635-0.235-0.953-0.349     c-0.338-0.122-0.672-0.251-1.018-0.356c-0.318-0.096-0.642-0.167-0.964-0.248c-0.353-0.089-0.701-0.188-1.061-0.259     c-0.372-0.074-0.748-0.118-1.122-0.171c-0.314-0.045-0.622-0.104-0.94-0.136c-0.7-0.069-1.402-0.106-2.105-0.106l0,0H64     c-11.782,0-21.333,9.551-21.333,21.333C42.667,310.449,52.218,320,64,320h97.83L6.248,475.582c-8.331,8.331-8.331,21.839,0,30.17     c8.331,8.331,21.839,8.331,30.17,0L192,350.17V448c0,11.782,9.551,21.333,21.333,21.333c11.782,0,21.333-9.551,21.333-21.333     V298.667l0,0C234.667,297.964,234.629,297.262,234.56,296.562z"/></g></g></g></svg>'; // Exit (approx)
                } else {
                     fullscreenBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24px" height="24px" viewBox="0 0 24 24" fill="none"><path d="M3 21L10.5 13.5M3 21V15.4M3 21H8.6" stroke="#ffffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21.0711 3L13.5 10.5M21.0711 3V8.65685M21.0711 3H15.4142" stroke="#ffffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'; // Enter
                }
            };
            updateFullIcon();

            const toggleFullscreen = () => {
                if (!document.fullscreenElement) {
                    newContainer.requestFullscreen().catch(err => {
                        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
                    });
                } else {
                    document.exitFullscreen();
                }
            };

            fullscreenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus(); // Fix focus
                toggleFullscreen();
            });

            // Prevent native double-click fullscreen on video from breaking UI
            // Use 'click' with detail === 2 to ensure we are in a valid user gesture context for requestFullscreen
            newContainer.addEventListener('click', (e) => {
                if (e.detail === 2) {
                    e.stopPropagation();
                    e.preventDefault();
                    toggleFullscreen();
                }
            });
            
            document.addEventListener('fullscreenchange', updateFullIcon);

            // Keyboard Controls for seeking and volume (register only once)
            if (!window._movieExtension_keyboardHandlerRegistered) {
                window._movieExtension_keyboardHandlerRegistered = true;
                
                document.addEventListener('keydown', (e) => {
                    // Only handle if player is visible and not typing in input
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                    
                    const currentVid = permanentVideo || video;
                    if (!currentVid) return;
                    
                    // Arrow Left: Seek backward 10 seconds
                    if (e.key === 'ArrowLeft' && Number.isFinite(currentVid.duration)) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        const newTime = Math.max(0, currentVid.currentTime - 10);
                        currentVid.currentTime = newTime;
                        showSeekIndicator(leftSeekIndicator, 'left');
                        console.log('[MovieExtension] Seek backward to:', newTime);
                    }
                    // Arrow Right: Seek forward 10 seconds  
                    else if (e.key === 'ArrowRight' && Number.isFinite(currentVid.duration)) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        const newTime = Math.min(currentVid.duration, currentVid.currentTime + 10);
                        currentVid.currentTime = newTime;
                        showSeekIndicator(rightSeekIndicator, 'right');
                        console.log('[MovieExtension] Seek forward to:', newTime);
                    }
                    // Arrow Up: Increase volume by 5%
                    else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        const currentVolume = currentVid.volume;
                        const newVolume = Math.min(1, currentVolume + 0.05);
                        setVolumeSafe(newVolume, false);
                        showVolumeIndicator(newVolume * 100);
                        console.log('[MovieExtension] Volume increased to:', Math.round(newVolume * 100) + '%');
                    }
                    // Arrow Down: Decrease volume by 5%
                    else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        const currentVolume = currentVid.volume;
                        const newVolume = Math.max(0, currentVolume - 0.05);
                        setVolumeSafe(newVolume, newVolume === 0);
                        showVolumeIndicator(newVolume * 100);
                        console.log('[MovieExtension] Volume decreased to:', Math.round(newVolume * 100) + '%');
                    }
                    // Space: Play/Pause
                    else if (e.key === ' ' || e.code === 'Space') {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        if (currentVid.paused) {
                            currentVid.play().catch(() => {});
                        } else {
                            currentVid.pause();
                        }
                    }
                }, true); // Use capture phase to catch events before other handlers
            }

            // === Anime Opening Skip Button ===
            // === Anime Opening Skip Button ===
            skipButton = document.createElement('button');
            skipButton.id = 'skipOpeningBtn';
            skipButton.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="margin-right: 8px;">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                </svg>
                <span>Пропустить опенинг</span>
            `;
            // Updated styles: Absolute positioning, Dark theme with Blue accent
            skipButton.style.cssText = `
                display: none;
                position: absolute;
                bottom: 80px;
                right: 30px;
                z-index: 60;
                align-items: center;
                background: #262627;
                border: 1px solid #3e3e3fff;
                border-radius: 8px;
                padding: 10px 20px;
                color: #ffffffff;
                font-family: inherit;
                font-size: 18px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(8px);
                letter-spacing: 0.3px;
            `;
            
            skipButton.addEventListener('mouseenter', () => {
                skipButton.style.background = '#C0C0C0';
                skipButton.style.color = '#262627';
                skipButton.style.boxShadow = '0 8px 20px rgba(192, 192, 192, 0.5)';
                skipButton.style.transform = 'translateY(-2px)';
            });
            
            skipButton.addEventListener('mouseleave', () => {
                skipButton.style.background = '#262627';
                skipButton.style.color = '#ffffffff';
                skipButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.4)';
                skipButton.style.transform = 'translateY(0)';
            });
            
            skipButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (permanentVideo) permanentVideo.focus();
                
                if (animeSkipData && animeSkipData.endTime) {
                    console.log('[MovieExtension] Skipping to:', animeSkipData.endTime);
                    permanentVideo.currentTime = animeSkipData.endTime;
                    hideSkipButton();
                }
            });

            // Note: Visibility functions and timeupdate listeners are now handled globally & via setupVideoListeners
            // This prevents duplicate logic and ensures button works on episode switch.

            // Append to main container (absolute positioning) instead of rightControls
            newContainer.appendChild(skipButton);
            rightControls.appendChild(settingsBtn);
            rightControls.appendChild(fullscreenBtn);

            bottomControls.appendChild(leftControls);
            bottomControls.appendChild(rightControls);
            newContainer.appendChild(bottomControls);



            // Communication with parent (Extension)
            // Notify parent that player is ready
            window.parent.postMessage({ type: 'PLAYER_READY' }, '*');

            // Listen for messages from parent
            window.addEventListener('message', (event) => {
                if (event.data.type === 'SET_SOURCES') {
                    // Sources received, no action needed here currently
                } else if (event.data.type === 'ANIME_SKIP_DATA') {
                    // Received anime skip times from parent
                    console.log('[MovieExtension] Received anime skip data:', event.data);
                    
                    if (event.data.skipTimes) {
                        animeSkipData = {
                            startTime: event.data.skipTimes.startTime,
                            endTime: event.data.skipTimes.endTime,
                            episodeLength: event.data.skipTimes.episodeLength
                        };
                        
                        console.log(`[SkipError] ANIME_SKIP_DATA received — range: ${animeSkipData.startTime}-${animeSkipData.endTime}s, permanentVideo: ${!!permanentVideo}, skipButton: ${!!skipButton}`);
                        
                        // Scenario 2: Skip data ready but no video or button
                        if (!permanentVideo) {
                            console.warn('[SkipError] Skip data received but permanentVideo is null — button cannot be shown');
                        }
                        if (!skipButton) {
                            console.warn('[SkipError] Skip data received but skipButton DOM element not created yet');
                        }
                        
                        // Immediately check if button should be visible
                        if (permanentVideo) {
                            checkSkipButtonVisibility(permanentVideo.currentTime);
                        }
                    } else {
                        // No skip data available, clear state
                        console.log(`[SkipError] ANIME_SKIP_DATA received with null skipTimes (ep: ${event.data.episodeNumber}) — clearing skip state`);
                        animeSkipData = null;
                        hideSkipButton();
                    }
                }
            });
            
            // 3. Find and Render Internal Voiceovers (This is the real top-left dropdown)
            findAndRenderVoiceovers(controlsOverlay, newContainer);

            // if (observer) observer.disconnect(); // KEEP OBSERVER ALIVE
            
            if (attempts > MAX_ATTEMPTS) {
                attempts = 0; // Infinite retry effectively, looking for video appearing later
            }
    }


    function findAndRenderVoiceovers(container, exclusionContainer) {
        
        // Strategy 0: Explicit Seasonvar Bridge (Added by Parser)
        const svContainer = document.querySelector('#seasonvar-voiceover-source');
        if (svContainer) {
            extractAndRender(svContainer.querySelectorAll('.seasonvar-voiceover-item'), container);
            return;
        }

        // Strategy 1: Look for the specific structure user provided
        // <div class="menu_..."><div class="item_...">Name</div></div>
        
        // Find potential menu containers by partial class or structure
        const candidates = [];
        
        // Look for items with "item_" class prefix which is common in provided snippet
        const items = document.querySelectorAll('[class*="item_"]');
        
        if (items.length > 0) {
            
            // Group by parent
            const parentMap = new Map();
            items.forEach(el => {
                const text = el.textContent.trim();
                // Filter out irrelevant items (too short/long or empty)
                if (text.length > 2 && text.length < 50) {
                     const parent = el.parentElement;
                     if (parent) {
                         // Check if parent looks like a menu (has multiple children)
                         if (!parentMap.has(parent)) parentMap.set(parent, []);
                         parentMap.get(parent).push(el);
                     }
                }
            });

            // Find best parent
            let bestParent = null;
            let maxCount = 0;
            
            for (const [parent, children] of parentMap.entries()) {
                // Check if children contain known keywords
                const hasKeywords = children.some(child => {
                     const t = child.textContent;
                     return t.includes('Original') || t.includes('Dubbing') || t.includes('Дублированный') || t.includes('Red Head') || t.includes('TVShows');
                });
                
                if (hasKeywords && children.length > maxCount) {
                    maxCount = children.length;
                    bestParent = parent;
                }
            }

            if (bestParent) {
                extractAndRender(bestParent.children, container);
                return;
            }
        }
        
        // Strategy 2: Fallback to keyword search in all divs if class search fails
        // Heuristic: Find elements with text matching common voiceover names
        const keywords = ['TVShows', 'Dubbing', 'Original', 'Red Head', 'Дубляж', 'LostFilm', 'NewStudio', 'HDRezka', 'Кубик в Кубе', 'Eng.Original'];
        const textCandidates = [];
        
        const hasKeyword = (text) => keywords.some(k => text.includes(k));

        document.querySelectorAll('div, span, li').forEach(el => {
            if (exclusionContainer && exclusionContainer.contains(el)) return;
            if (el.textContent && el.textContent.length < 50 && hasKeyword(el.textContent)) {
                textCandidates.push(el);
            }
        });

        // Group by parent
        const textParentMap = new Map();
        textCandidates.forEach(el => {
            const parent = el.parentElement;
            if (parent) {
                textParentMap.set(parent, (textParentMap.get(parent) || 0) + 1);
            }
        });

        let bestTextParent = null;
        let maxTextCount = 0;
        textParentMap.forEach((count, parent) => {
            if (count > maxTextCount) {
                maxTextCount = count;
                bestTextParent = parent;
            }
        });

        if (bestTextParent && maxTextCount >= 2) {
             extractAndRender(bestTextParent.children, container);
        } else {
        }
    }

    function extractAndRender(childrenCollection, container) {
        const voiceoverOptions = [];
        Array.from(childrenCollection).forEach(child => {
            const text = child.textContent.trim();
            if (text) {
                voiceoverOptions.push({
                    name: text,
                    element: child
                });
            }
        });

        if (voiceoverOptions.length > 0) {
            // Update global state
            currentVoiceoverOptions = voiceoverOptions;
            
            // Try to detect active one (heuristic: "active" class or color)
            currentVoiceoverOptions.forEach(opt => {
                if (opt.element.classList.contains('active') || 
                    opt.element.classList.contains('selected') || 
                    opt.element.className.includes('active')) {
                    opt.isActive = true;
                }
            });
            // If none active, assume first? Or leave as is.
            if (!currentVoiceoverOptions.some(o => o.isActive)) {
                if(currentVoiceoverOptions.length > 0) currentVoiceoverOptions[0].isActive = true;
            }
        }
    }

    // REMOVED renderInternalVoiceoverSelector

    // Set up observer with enhanced logic
    observer = new MutationObserver((mutations) => {
        // First check if we need to intercept new video elements
        if (permanentVideo) {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // Check for new video elements added by the site
                    const addedVideos = Array.from(mutation.addedNodes)
                        .filter(node => node.tagName === 'VIDEO' && node.dataset.ghost !== 'true' && !node.classList.contains('ghost-video'));
                    
                    for (const newVideo of addedVideos) {
                        // Skip if it's our own video
                        if (newVideo === permanentVideo) continue;
                        if (newVideo.closest('.native-player-wrapper')) continue;
                        
                        // Extract source from new video
                        const newSrc = newVideo.src || newVideo.currentSrc;
                        
                        if (newSrc) {
                            console.log('[MovieExtension] Detected new video element with src:', newSrc);
                            
                            // Update our permanent video
                            const shouldAutoPlay = localStorage.getItem('movieExtension_autoplay_next') === 'true';
                            changeVideoSource(newSrc, shouldAutoPlay);
                            
                            // Remove the site's video element
                            newVideo.remove();
                            
                            console.log('[MovieExtension] Removed site video, updated permanent video');
                            
                            // Don't initialize new player
                            return;
                        } else {
                            // Blob URL may be assigned after insertion — watch for it
                            console.log('[MovieExtension] New video without src detected, watching for source assignment...');
                            const srcWatcher = new MutationObserver((muts, obs) => {
                                const src = newVideo.src || newVideo.currentSrc;
                                if (src) {
                                    obs.disconnect();
                                    if (newVideo.closest('.native-player-wrapper')) return;
                                    console.log('[MovieExtension] Deferred src detected:', src);
                                    changeVideoSource(src, true);
                                    newVideo.remove();
                                }
                            });
                            srcWatcher.observe(newVideo, { attributes: true, attributeFilter: ['src'] });
                            // Fallback for blob URLs set via JS property (not attribute)
                            newVideo.addEventListener('loadedmetadata', function handler() {
                                const src = newVideo.src || newVideo.currentSrc;
                                if (src && !newVideo.closest('.native-player-wrapper')) {
                                    srcWatcher.disconnect();
                                    console.log('[MovieExtension] Deferred src via loadedmetadata:', src);
                                    changeVideoSource(src, true);
                                    newVideo.remove();
                                }
                                newVideo.removeEventListener('loadedmetadata', handler);
                            }, { once: true });
                        }
                    }
                }
            }
        }
        
        // Call replacePlayer for initial setup
        replacePlayer();
    }, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'currentSrc']
    });
    
    // waiting for body
    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        replacePlayer();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
             observer.observe(document.body, {
                childList: true,
                subtree: true
            });
            replacePlayer();
        });
    }



    // Listen for messages from parent extension
    window.addEventListener('message', (event) => {
        if (!event.data) return;
        
        if (event.data.type === 'PAUSE') {
            console.log('[MovieExtension] Received PAUSE command from parent');
            const video = permanentVideo || document.querySelector('video');
            if (video) {
                if (!video.paused) {
                    video.pause();
                    console.log('[MovieExtension] Video paused by command');
                } else {
                    console.log('[MovieExtension] Video already paused');
                }
                
                // Send confirmation back to parent
                if (event.source) {
                    event.source.postMessage({ type: 'PAUSED_CONFIRMATION' }, event.origin);
                }
            } else {
                 console.warn('[MovieExtension] No video element found to pause');
            }
        }
    });

})();



