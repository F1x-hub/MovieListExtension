/**
 * AwardsParsingService - Parses movie awards from kinopoisk.ru
 * Extracts Oscar and Golden Globe awards with winner/nominee status
 */
class AwardsParsingService {
    constructor() {
        this.baseUrl = 'https://www.kinopoisk.ru';
    }

    /**
     * Get awards for a movie by kinopoisk ID
     * @param {number|string} movieId - Kinopoisk movie ID
     * @returns {Promise<Array>} - Array of award objects
     */
    async getAwards(movieId) {
        try {
            const url = `${this.baseUrl}/film/${movieId}/awards/`;
            console.log('Parsing awards from:', url);

            const response = await fetch(url);
            console.log(`[AwardsParser] Response status: ${response.status} ${response.statusText}`);
            
            if (!response.ok) {
                console.warn(`[AwardsParser] ❌ Failed to load awards page: ${response.status}`);
                return [];
            }

            const html = await response.text();
            return this.parseAwardsPage(html);

        } catch (error) {
            console.error('AwardsParsingService error:', error);
            return [];
        }
    }

    /**
     * Parse awards page HTML to extract Oscar and Golden Globe awards
     * @param {string} html - Awards page HTML
     * @returns {Array} - Array of { name, nominationName, win }
     */
    parseAwardsPage(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const awards = [];

        // Find all award tables
        const tables = doc.querySelectorAll('table[cellspacing="0"]');
        console.log(`[AwardsParser] Found ${tables.length} tables on the page`);

        tables.forEach((table, tableIndex) => {
            // Skip tables that contain other tables to avoid "container" tables
            // This prevents finding the "Oscar" header in a container table but matching "Golden Raspberry" content inside it
            if (table.querySelector('table')) {
                console.log(`[AwardsParser] Table ${tableIndex}: Contains nested tables, skipping container`);
                return;
            }

            // Extract award name and year from header
            const headerCell = table.querySelector('td.news b a');
            if (!headerCell) {
                console.log(`[AwardsParser] Table ${tableIndex}: No header found, skipping`);
                return;
            }

            const headerText = headerCell.textContent.trim();
            console.log(`[AwardsParser] Table ${tableIndex}: Processing "${headerText}"`);
            
            // Only process Oscar and Golden Globe
            if (!headerText.includes('Оскар') && !headerText.includes('Золотой глобус')) {
                console.log(`[AwardsParser] Table ${tableIndex}: Not Oscar/Globe, skipping`);
                return;
            }

            // Extract award name (e.g., "Оскар")
            const awardName = headerText.split(',')[0].trim();
            
            // Extract year from header (e.g., "1975 год")
            const yearMatch = headerText.match(/(\d{4})/);
            const year = yearMatch ? parseInt(yearMatch[1]) : null;
            console.log(`[AwardsParser] Processing ${awardName}, ${year} год`);

            // Process winners section
            const winnersSection = this.findSectionByHeader(table, 'Победитель');
            if (winnersSection) {
                const winnerNominations = this.extractNominations(winnersSection);
                console.log(`[AwardsParser] → Found ${winnerNominations.length} winners`);
                winnerNominations.forEach(nom => {
                    awards.push({
                        name: awardName,
                        nominationName: nom,
                        win: true,
                        year: year
                    });
                });
            } else {
                console.log(`[AwardsParser] → No winners section found`);
            }

            // Process nominations section
            const nominationsSection = this.findSectionByHeader(table, 'Номинации');
            if (nominationsSection) {
                const nominations = this.extractNominations(nominationsSection);
                console.log(`[AwardsParser] → Found ${nominations.length} nominations`);
                
                // Filter out nominations that clearly belong to other awards (MTV, Saturn, etc.)
                const nonOscarGlobeNominations = [
                    'Прорыв года', 'экранный дуэт', 'экшн-сцена', 'поцелуй',
                    'злодей', 'камео', 'виртуальная', 'стиль'
                ];
                
                nominations.forEach(nom => {
                    const nomLower = nom.toLowerCase();
                    const isOtherAward = nonOscarGlobeNominations.some(keyword => nomLower.includes(keyword.toLowerCase()));
                    
                    if (isOtherAward) {
                        console.log(`[AwardsParser] → Skipping non-Oscar/Globe nomination: "${nom}"`);
                    } else {
                        awards.push({
                            name: awardName,
                            nominationName: nom,
                            win: false,
                            year: year
                        });
                    }
                });
            } else {
                console.log(`[AwardsParser] → No nominations section found`);
            }
        });

        // Remove duplicates (same award + nomination + year)
        const uniqueAwards = [];
        const seen = new Set();

        awards.forEach(award => {
            const key = `${award.name}|${award.nominationName}|${award.year}|${award.win}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueAwards.push(award);
            } else {
                console.log(`[AwardsParser] Skipping duplicate: ${award.name} - ${award.nominationName}`);
            }
        });

        console.log(`[AwardsParser] ✅ Total parsed: ${uniqueAwards.length} unique awards (${uniqueAwards.filter(a => a.win).length} wins, ${uniqueAwards.filter(a => !a.win).length} nominations)`);
        return uniqueAwards;
    }

    /**
     * Find a section row by header text (e.g., "Победитель", "Номинации")
     * @param {Element} table - Table element
     * @param {string} headerText - Header text to find
     * @returns {Element|null} - Next row containing nominations list
     */
    findSectionByHeader(table, headerText) {
        const rows = table.querySelectorAll('tr');
        
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const cell = row.querySelector('td.news');
            
            if (cell && cell.textContent.includes(headerText)) {
                // Return the next row which contains the <ul> with nominations
                return rows[i + 1];
            }
        }
        
        return null;
    }

    /**
     * Extract nomination titles from a section row
     * @param {Element} row - Row element containing <ul class="trivia">
     * @returns {Array<string>} - Array of nomination titles
     */
    extractNominations(row) {
        const nominations = [];
        const list = row.querySelector('ul.trivia');
        
        if (!list) {
            console.log(`[AwardsParser] No <ul.trivia> found in row`);
            return nominations;
        }

        const items = list.querySelectorAll('li.trivia');
        console.log(`[AwardsParser] Found ${items.length} <li.trivia> items`);
        
        items.forEach((item, idx) => {
            const link = item.querySelector('a.all');
            if (link) {
                const nominationTitle = link.textContent.trim();
                console.log(`[AwardsParser]   Item ${idx}: "${nominationTitle}"`);
                nominations.push(nominationTitle);
            } else {
                console.log(`[AwardsParser]   Item ${idx}: No link found, skipping`);
            }
        });

        return nominations;
    }
}

// Export as global
if (typeof window !== 'undefined') {
    window.AwardsParsingService = AwardsParsingService;
}
