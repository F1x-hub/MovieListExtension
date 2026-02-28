// suppress-errors.js - Injected into the page to suppress specific console errors

(function() {
    // Save original console methods
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;

    // Filter patterns for errors we want to suppress
    const SUPPRESSED_ERRORS = [
        'check_mid_roll',
        's.myangular.life',
        'ref_id=',
        'WebSocket',
        'ERR_BLOCKED_BY_CLIENT',
        'AbortError',
        'The play() request was interrupted',
        'user didn\'t interact',
        'midroll',
        'vast',
        'banner',
        'GapController',
        'chunks',
        'Uint8Array'
    ];

    function shouldSuppress(args) {
        if (!args || args.length === 0) return false;
        
        const message = args.map(arg => {
            try {
                return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
            } catch (e) {
                return '';
            }
        }).join(' ');

        return SUPPRESSED_ERRORS.some(pattern => message.includes(pattern));
    }

    // Override console.error
    console.error = function(...args) {
        if (shouldSuppress(args)) {
            return;
        }
        originalConsoleError.apply(console, args);
    };

    // Override console.warn
    console.warn = function(...args) {
        if (shouldSuppress(args)) {
            return;
        }
        originalConsoleWarn.apply(console, args);
    };
    
    // Override console.log (optional, for noisier logs like GapController)
    console.log = function(...args) {
         if (shouldSuppress(args)) {
            return;
        }
        originalConsoleLog.apply(console, args);
    };

    // Optional: Suppress specific WebSocket connection errors by wrapping WebSocket
    // This is aggressive but effective for the reported "WebSocket connection failed"
    const OriginalWebSocket = window.WebSocket;
    if (OriginalWebSocket) {
        window.WebSocket = function(url, protocols) {
            if (url && (url.includes('myangular.life') || url.includes('ref_id='))) {
                // Return a dummy WebSocket that does nothing to prevent connection attempts
                return {
                    send: () => {},
                    close: () => {},
                    addEventListener: () => {},
                    removeEventListener: () => {},
                    readyState: 3 // CLOSED
                };
            }
            return new OriginalWebSocket(url, protocols);
        };
        window.WebSocket.prototype = OriginalWebSocket.prototype;
        window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
        window.WebSocket.OPEN = OriginalWebSocket.OPEN;
        window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
        window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
    }

    // Handle global errors
    window.addEventListener('error', function(event) {
        if (event.message && SUPPRESSED_ERRORS.some(pattern => event.message.includes(pattern))) {
            event.stopImmediatePropagation();
            event.preventDefault();
        }
    }, true);

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', function(event) {
        let reason = event.reason;
        let message = '';

        try {
            if (reason instanceof Error) {
                message = reason.message;
            } else if (typeof reason === 'object') {
                // Handle the specific Object error with chunks
                message = JSON.stringify(reason);
            } else {
                message = String(reason);
            }
        } catch (e) {
            message = '';
        }

        if (message && SUPPRESSED_ERRORS.some(pattern => message.includes(pattern))) {
            event.stopImmediatePropagation();
            event.preventDefault();
        }
    }, true);

})();
