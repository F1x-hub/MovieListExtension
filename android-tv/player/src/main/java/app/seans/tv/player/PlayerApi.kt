package app.seans.tv.player

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.tv.material3.Text
import app.seans.tv.designsystem.SeansColors
import app.seans.tv.model.AppGraph
import app.seans.tv.model.BroadcastLock
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.ProviderId
import app.seans.tv.model.SeansError
import app.seans.tv.model.ServerClock
import kotlinx.coroutines.flow.StateFlow

/*
 * Public API of `:player`. The signatures are the contract with `:app` and `:live`; the `tv-player`
 * session replaces the bodies. Changing a signature goes through the coordinator.
 */

/**
 * Full-screen personal playback: finds sources for [request], resolves one, plays it with the
 * controls of the mockup (timeline, ±10 s, next episode, «Серии» drawer, «Озвучка»/source panel,
 * subtitles, quality) and is the only writer of progress. Back leaves through [onExit] after the
 * position is flushed.
 */
@Composable
fun PlayerScreen(
    request: PlaybackRequest,
    graph: AppGraph,
    onExit: () -> Unit,
) {
    app.seans.tv.player.ui.PlayerScreenView(request, graph, onExit)
}

/** What the broadcast player reports to `:live`, which draws its own overlay on top. */
sealed interface BroadcastPlaybackState {
    data object Searching : BroadcastPlaybackState
    data class Playing(val providerId: ProviderId) : BroadcastPlaybackState
    /** No source can play the scheduled title or episode; `:live` shows its standby card. */
    data object NoSource : BroadcastPlaybackState
    /**
     * The file ended at media position [atMs] before the slot did (the extension's
     * `BROADCAST_ENDED`); `:live` shows its "show ended" standby. An admin seek back inside the
     * file returns to [Playing].
     */
    data class Ended(val atMs: Long) : BroadcastPlaybackState
    data class Failed(val error: SeansError) : BroadcastPlaybackState
}

/**
 * Video only, locked to the channel: no pause, seek, episode change, auto-next or progress
 * writes. Follows [lock] (admin pause, resume, seek) and corrects drift by seeking: more than
 * 3 s off while playing, 1 s while paused. `request.reason` is `SelectionReason.BROADCAST`.
 * Sound, subtitles, voice and quality stay the viewer's (`:live` exposes those controls through
 * [controller]).
 */
@Composable
fun BroadcastPlayer(
    request: PlaybackRequest,
    lock: StateFlow<BroadcastLock>,
    clock: ServerClock,
    graph: AppGraph,
    onState: (BroadcastPlaybackState) -> Unit,
    modifier: Modifier = Modifier,
    controller: BroadcastController? = null,
) {
    // Pass a `BroadcastControls` as [controller]: the player connects it to the playing session.
    app.seans.tv.player.broadcast.BroadcastPlayerView(request, lock, clock, graph, onState, modifier, controller)
}

/** The viewer's own settings during a broadcast, driven by `:live`'s buttons. */
interface BroadcastController {
    fun voices(): List<app.seans.tv.model.VoiceOption>
    fun selectVoice(id: String)
    fun subtitles(): List<app.seans.tv.model.SubtitleTrack>
    /** null turns subtitles off. */
    fun selectSubtitle(url: String?)
    fun setMuted(muted: Boolean)
}

@Composable
private fun Placeholder(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize().background(SeansColors.Bg), contentAlignment = Alignment.Center) {
        Text(text, color = SeansColors.Text2)
    }
}
