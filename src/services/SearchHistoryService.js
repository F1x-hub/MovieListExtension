/**
 * Search History Service
 * Manages search history storage and retrieval
 */
class SearchHistoryService {
    constructor() {
        this.storageKey = 'movieSearchHistory';
        this.maxHistoryItems = 10; // Maximum number of history items to store
    }

    /**
     * Add a search query to history
     * @param {string} query - Search query to add
     */
    async addToHistory(query) {
        if (!query || query.trim().length === 0) {
            return;
        }

        const trimmedQuery = query.trim();
        
        try {
            const history = await this.getHistory();
            
            // Remove existing instance of this query (to avoid duplicates)
            const filteredHistory = history.filter(item => 
                item.query.toLowerCase() !== trimmedQuery.toLowerCase()
            );
            
            // Add new query at the beginning
            const newHistoryItem = {
                query: trimmedQuery,
                timestamp: Date.now(),
                id: this.generateId()
            };
            
            filteredHistory.unshift(newHistoryItem);
            
            // Keep only the latest maxHistoryItems
            const limitedHistory = filteredHistory.slice(0, this.maxHistoryItems);
            
            // Save to storage
            await chrome.storage.local.set({
                [this.storageKey]: limitedHistory
            });
            
            console.log('SearchHistoryService: Added query to history:', trimmedQuery);
            
        } catch (error) {
            console.error('SearchHistoryService: Error adding to history:', error);
        }
    }

    /**
     * Get search history
     * @returns {Promise<Array>} Array of history items
     */
    async getHistory() {
        try {
            const result = await chrome.storage.local.get([this.storageKey]);
            const history = result[this.storageKey] || [];
            
            // Sort by timestamp (newest first)
            return history.sort((a, b) => b.timestamp - a.timestamp);
            
        } catch (error) {
            console.error('SearchHistoryService: Error getting history:', error);
            return [];
        }
    }

    /**
     * Remove a specific item from history
     * @param {string} itemId - ID of the item to remove
     */
    async removeFromHistory(itemId) {
        try {
            const history = await this.getHistory();
            const filteredHistory = history.filter(item => item.id !== itemId);
            
            await chrome.storage.local.set({
                [this.storageKey]: filteredHistory
            });
            
            console.log('SearchHistoryService: Removed item from history:', itemId);
            
        } catch (error) {
            console.error('SearchHistoryService: Error removing from history:', error);
        }
    }

    /**
     * Clear all search history
     */
    async clearHistory() {
        try {
            await chrome.storage.local.set({
                [this.storageKey]: []
            });
            
            console.log('SearchHistoryService: Cleared all history');
            
        } catch (error) {
            console.error('SearchHistoryService: Error clearing history:', error);
        }
    }

    /**
     * Search in history by query
     * @param {string} searchTerm - Term to search for
     * @returns {Promise<Array>} Filtered history items
     */
    async searchHistory(searchTerm) {
        if (!searchTerm || searchTerm.trim().length === 0) {
            return await this.getHistory();
        }

        const history = await this.getHistory();
        const lowerSearchTerm = searchTerm.toLowerCase();
        
        return history.filter(item => 
            item.query.toLowerCase().includes(lowerSearchTerm)
        );
    }

    /**
     * Generate unique ID for history items
     * @returns {string} Unique ID
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    /**
     * Get formatted history for display
     * @returns {Promise<Array>} Formatted history items
     */
    async getFormattedHistory() {
        const history = await this.getHistory();
        
        return history.map(item => ({
            ...item,
            displayText: item.query,
            timeAgo: this.getTimeAgo(item.timestamp)
        }));
    }

    /**
     * Get human-readable time ago string
     * @param {number} timestamp - Timestamp to format
     * @returns {string} Time ago string
     */
    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        
        if (minutes < 1) {
            return 'Just now';
        } else if (minutes < 60) {
            return `${minutes}m ago`;
        } else if (hours < 24) {
            return `${hours}h ago`;
        } else {
            return `${days}d ago`;
        }
    }
}

// Make service available globally
window.SearchHistoryService = SearchHistoryService;
