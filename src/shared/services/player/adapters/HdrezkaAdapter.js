/** Native, film-only playback; no speculative season or episode support. */
class HdrezkaAdapter extends (typeof BasePlaybackAdapter !== 'undefined' ? BasePlaybackAdapter : require('./BasePlaybackAdapter').BasePlaybackAdapter) {
    constructor(parserService = null) { super('hdrezka', 'HDRezka'); this.parserService = parserService; this.activeContainer = null; }
    supportsSeries() { return false; }
    getSelectionMode() { return 'DIRECT'; }
    supportsInPlaceSelection() { return true; }
    supportsEpisodePicker() { return false; }
    supportsPrevNext() { return false; }
    supportsTitleOnlyPlayback() { return true; }
    supportsProgressTracking() { return true; }
    supportsDuration() { return true; }
    supportsEnded() { return true; }
    supportsTimestampResume() { return true; }
    getProgressConfidence() { return 'RELIABLE'; }
    async mount(container, selection, context = {}) {
        const parser = this.parserService || context.parser || window.parserRegistry?.get('hdrezka');
        if (!parser || !parser.supportsType(selection.mediaType)) throw new Error('HDREZKA_UNAVAILABLE');
        this.activeContainer = container;
        const sources = context.sources || await parser.cachedVideoSources(selection.sourceUrl);
        const element = await parser.renderPlayer(container, sources, { ...context, movieId: selection.kinopoiskId, initialTimestamp: selection.initialTimestamp });
        if (!element) throw new Error('HDREZKA_UNAVAILABLE');
        return { element, type: 'video', providerId: this.id, rawSources: sources };
    }
    unmount() { this.activeContainer?._hdrezkaDispose?.(); this.activeContainer = null; }
}
if (typeof window !== 'undefined') window.HdrezkaAdapter = HdrezkaAdapter;
if (typeof module !== 'undefined' && module.exports) module.exports = { HdrezkaAdapter };
