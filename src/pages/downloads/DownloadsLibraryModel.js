/**
 * DownloadsLibraryModel - pure rules for the Downloads page.
 *
 * Turns MediaPlayer's flat list of durable download records into the cards the
 * page shows: one card per film download, one card per series (its episodes
 * inside), one card per record MediaPlayer could not tie to TMDB. Filtering,
 * counting, sorting, summaries and selection live here so they can be tested
 * without a browser; the page owns the DOM and the MediaPlayer calls.
 */
(function (global) {
    const STATUS_RANK = Object.freeze({ downloading: 0, starting: 0, error: 1, paused: 2, complete: 3 });
    const FILTERS = Object.freeze(['all', 'active', 'ready', 'paused', 'error']);
    const SORTS = Object.freeze(['activity', 'created', 'title', 'size']);

    function isActive(record) {
        return record?.status === 'downloading' || record?.status === 'starting';
    }

    function canPause(record) {
        return isActive(record);
    }

    function canResume(record) {
        return record?.status === 'paused' || record?.status === 'error';
    }

    function canPlay(record) {
        return record?.status === 'complete' || isActive(record);
    }

    /** Progress in percent, 0..100. MediaPlayer reports a fraction; older builds a percentage. */
    function percent(record) {
        const value = Number(record?.progress);
        if (!Number.isFinite(value) || value <= 0) return record?.status === 'complete' ? 100 : 0;
        return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
    }

    function totalBytes(record) {
        return Math.max(0, Number(record?.totalBytes) || Number(record?.sizeBytes) || 0);
    }

    /** Bytes this record holds on disk now. */
    function downloadedBytes(record) {
        const total = totalBytes(record);
        if (record?.status === 'complete') return total;
        const reported = Number(record?.downloadedBytes);
        if (Number.isFinite(reported) && reported > 0) return total ? Math.min(reported, total) : reported;
        return Math.round(total * percent(record) / 100);
    }

    function timeOf(value) {
        const time = Date.parse(String(value || ''));
        return Number.isFinite(time) ? time : 0;
    }

    function hasEpisode(record) {
        return Number.isSafeInteger(record?.seasonNumber) && Number.isSafeInteger(record?.episodeNumber);
    }

    function episodeCode(record) {
        if (!hasEpisode(record)) return '';
        const pad = (value) => String(value).padStart(2, '0');
        return `S${pad(record.seasonNumber)}E${pad(record.episodeNumber)}`;
    }

    function isLinked(record) {
        return Number.isSafeInteger(record?.tmdbId) && record.tmdbId > 0;
    }

    function compareEpisodes(first, second) {
        return (first.seasonNumber ?? Infinity) - (second.seasonNumber ?? Infinity)
            || (first.episodeNumber ?? Infinity) - (second.episodeNumber ?? Infinity)
            || timeOf(first.createdAt) - timeOf(second.createdAt);
    }

    /**
     * @param {Array<Object>} downloads - normalized MediaPlayer records
     * @returns {Array<{key:string, kind:'movie'|'series', mediaType:string, tmdbId:number|null, linked:boolean, title:string, records:Array<Object>}>}
     */
    function groupDownloads(downloads) {
        const items = [];
        const series = new Map();
        for (const record of Array.isArray(downloads) ? downloads : []) {
            if (!record || typeof record !== 'object' || !record.id) continue;
            const linked = isLinked(record);
            const mediaType = record.mediaType === 'tv' ? 'tv' : 'movie';
            if (mediaType === 'tv' && linked) {
                const key = `tv:${record.tmdbId}`;
                let item = series.get(key);
                if (!item) {
                    item = { key, kind: 'series', mediaType, tmdbId: record.tmdbId, linked: true, title: record.title, records: [] };
                    series.set(key, item);
                    items.push(item);
                }
                item.records.push(record);
                continue;
            }
            items.push({
                key: `${mediaType}:${record.id}`,
                kind: 'movie',
                mediaType,
                tmdbId: linked ? record.tmdbId : null,
                linked,
                title: record.title,
                records: [record]
            });
        }
        series.forEach(item => item.records.sort(compareEpisodes));
        return items;
    }

    function matchesFilter(record, filter) {
        switch (filter) {
            case 'active': return isActive(record);
            case 'ready': return record?.status === 'complete';
            case 'paused': return record?.status === 'paused';
            case 'error': return record?.status === 'error';
            default: return true;
        }
    }

    /** Cards per filter: a card counts once when at least one of its records matches. */
    function filterCounts(items) {
        const counts = Object.fromEntries(FILTERS.map(filter => [filter, 0]));
        for (const item of items) {
            for (const filter of FILTERS) {
                if (item.records.some(record => matchesFilter(record, filter))) counts[filter] += 1;
            }
        }
        return counts;
    }

    function normalizeSearch(value) {
        return String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[._]+/g, ' ').trim();
    }

    function itemRank(records) {
        return Math.min(...records.map(record => STATUS_RANK[record.status] ?? 4));
    }

    function itemTime(records) {
        return Math.max(0, ...records.map(record => timeOf(record.updatedAt) || timeOf(record.createdAt)));
    }

    function itemCreated(records) {
        return Math.max(0, ...records.map(record => timeOf(record.createdAt)));
    }

    function itemSize(records) {
        return records.reduce((sum, record) => sum + totalBytes(record), 0);
    }

    /**
     * Cards to show, each with only its records that pass the filter.
     * @param {Array<Object>} items - from groupDownloads
     * @param {{filter?:string, query?:string, sort?:string, titleOf?:(item:Object)=>string[]}} options
     */
    function visibleEntries(items, { filter = 'all', query = '', sort = 'activity', titleOf = null } = {}) {
        const needle = normalizeSearch(query);
        const entries = [];
        for (const item of items) {
            if (needle) {
                const titles = [item.title, ...(typeof titleOf === 'function' ? titleOf(item) : [])];
                if (!titles.some(title => normalizeSearch(title).includes(needle))) continue;
            }
            const records = item.records.filter(record => matchesFilter(record, filter));
            if (records.length) entries.push({ item, records });
        }
        const titleKey = (entry) => (typeof titleOf === 'function' && titleOf(entry.item)[0]) || entry.item.title || '';
        entries.sort((first, second) => {
            if (sort === 'title') {
                return titleKey(first).localeCompare(titleKey(second), 'ru', { sensitivity: 'base' });
            }
            if (sort === 'size') return itemSize(second.item.records) - itemSize(first.item.records);
            if (sort === 'created') return itemCreated(second.item.records) - itemCreated(first.item.records);
            return itemRank(first.records) - itemRank(second.records)
                || itemTime(second.item.records) - itemTime(first.item.records);
        });
        return entries;
    }

    function summarize(items) {
        const records = items.flatMap(item => item.records);
        const active = records.filter(isActive);
        return {
            cards: items.length,
            records: records.length,
            onDiskBytes: records.reduce((sum, record) => sum + downloadedBytes(record), 0),
            activeCount: active.length,
            downloadSpeed: active.reduce((sum, record) => sum + Math.max(0, Number(record.downloadSpeedBytesPerSecond) || 0), 0)
        };
    }

    /** Selected ids that still exist among the visible records, in display order. */
    function pruneSelection(selectedIds, entries) {
        const visible = entries.flatMap(entry => entry.records.map(record => record.id));
        const selected = new Set(selectedIds);
        return new Set(visible.filter(id => selected.has(id)));
    }

    function selectionSummary(selectedIds, entries) {
        const selected = new Set(selectedIds);
        const records = entries.flatMap(entry => entry.records).filter(record => selected.has(record.id));
        return {
            records,
            count: records.length,
            bytes: records.reduce((sum, record) => sum + downloadedBytes(record), 0),
            pausable: records.filter(canPause),
            resumable: records.filter(canResume)
        };
    }

    /** 'all', 'some' or 'none' of these records are selected. */
    function selectionState(records, selectedIds) {
        const selected = new Set(selectedIds);
        const count = records.filter(record => selected.has(record.id)).length;
        if (!count) return 'none';
        return count === records.length ? 'all' : 'some';
    }

    const api = {
        FILTERS,
        SORTS,
        isActive,
        canPause,
        canResume,
        canPlay,
        percent,
        totalBytes,
        downloadedBytes,
        hasEpisode,
        episodeCode,
        isLinked,
        groupDownloads,
        matchesFilter,
        filterCounts,
        visibleEntries,
        summarize,
        pruneSelection,
        selectionSummary,
        selectionState,
        normalizeSearch
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (global) global.DownloadsLibraryModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
