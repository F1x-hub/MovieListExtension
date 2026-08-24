/**
 * Safely converts various date representations (Firestore Timestamp, ISO string, {seconds}, timestamp number)
 * into a numeric millisecond timestamp. Never returns NaN.
 * @param {any} dateObj 
 * @returns {number} Timestamp in milliseconds, or 0 if invalid/null
 */
export function getTimestamp(dateObj) {
    if (!dateObj) return 0;
    if (typeof dateObj.toDate === 'function') return dateObj.toDate().getTime();
    if (typeof dateObj.toMillis === 'function') return dateObj.toMillis();
    if (typeof dateObj.seconds === 'number') return dateObj.seconds * 1000;
    if (typeof dateObj === 'number') return dateObj;
    const parsed = new Date(dateObj).getTime();
    return isNaN(parsed) ? 0 : parsed;
}
