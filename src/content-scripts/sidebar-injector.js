/**
 * Sidebar Injector Script for Movie Ratings Extension
 * Handles creation and management of the sidebar iframe.
 */
(function() {
    const SIDEBAR_ID = 'movie-ratings-sidebar-container';

    // Prevent multiple injections
    if (window.movieRatingsSidebarInjected) {
        // If already injected, we just return or we can handle toggle here if we want to bypass background message
        // But background sends TOGGLE_SIDEBAR message, so listeners below will handle it
        return;
    }
    window.movieRatingsSidebarInjected = true;

    function createSidebar(mode) {
        // Check if exists
        let container = document.getElementById(SIDEBAR_ID);
        if (container) return container;

        // Create Container
        container = document.createElement('div');
        container.id = SIDEBAR_ID;
        
        // Base container styles
        Object.assign(container.style, {
            position: 'fixed',
            top: '0px',
            right: '0px',
            width: '400px', // Standard popup width
            height: '100vh',
            zIndex: '2147483647', // Max z-index
            boxShadow: '-2px 0 10px rgba(0,0,0,0.3)',
            transition: 'transform 0.3s ease-in-out',
            transform: 'translateX(100%)', // Start hidden
            backgroundColor: '#1a1a1a', // Fallback
            borderLeft: '1px solid rgba(255,255,255,0.1)'
        });

        // Create Iframe
        const iframe = document.createElement('iframe');
        iframe.src = chrome.runtime.getURL('src/popup/popup.html'); // Reuse popup
        
        Object.assign(iframe.style, {
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block'
        });

        container.appendChild(iframe);
        document.body.appendChild(container);

        // Adjust body for Push mode
        if (mode === 'sidebar-push') {
            document.body.style.transition = 'margin-right 0.3s ease-in-out';
        }

        return container;
    }

    function toggleSidebar(mode) {
        const container = createSidebar(mode);
        
        // Check current state
        const isVisible = container.style.transform === 'translateX(0%)';
        
        if (isVisible) {
            // Close
            container.style.transform = 'translateX(100%)';
            if (mode === 'sidebar-push') {
                document.body.style.marginRight = '0px';
            }
        } else {
            // Open
            container.style.transform = 'translateX(0%)';
            if (mode === 'sidebar-push') {
                document.body.style.marginRight = '400px';
            }
        }
    }

    // Listen for messages
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'TOGGLE_SIDEBAR') {
            toggleSidebar(message.mode);
        }
    });

})();
