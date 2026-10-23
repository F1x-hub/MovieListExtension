/** Progress capabilities for the native video mounted by TorrentSourcePanel. */
class TorrentAdapter extends (typeof BasePlaybackAdapter !== 'undefined' ? BasePlaybackAdapter : require('./BasePlaybackAdapter').BasePlaybackAdapter) {
    constructor() { super('mediaplayer:torrent', 'Торрент'); }
    supportsMovies() { return true; }
    supportsSeries() { return true; }
    supportsDirectSeasonEpisode() { return false; }
    supportsEpisodePicker() { return false; }
    supportsProgressTracking() { return true; }
    supportsDuration() { return true; }
    supportsEnded() { return true; }
    supportsTimestampResume() { return false; } // The panel waits for the requested range.
    getProgressConfidence() { return 'RELIABLE'; }
    getMediaDuration(video) {
        const playback = video._torrentPlaybackSnapshot;
        const total = Number(playback?.totalDurationSeconds);
        if (Number.isFinite(total) && total > 0) return total;
        return playback?.isComplete && Number.isFinite(video.duration) ? video.duration : 0;
    }
    canReportEnded(video) { return video._torrentPlaybackSnapshot?.isComplete === true; }
}
if (typeof window !== 'undefined') window.TorrentAdapter = TorrentAdapter;
if (typeof module !== 'undefined' && module.exports) module.exports = { TorrentAdapter };
