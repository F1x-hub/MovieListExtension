package app.seans.tv.player.broadcast

import android.os.SystemClock
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.media3.exoplayer.ExoPlayer
import app.seans.tv.model.AppGraph
import app.seans.tv.model.BroadcastLock
import app.seans.tv.model.PlaybackRequest
import app.seans.tv.model.ServerClock
import app.seans.tv.player.BroadcastController
import app.seans.tv.player.BroadcastPlaybackState
import app.seans.tv.player.engine.ExoEngine
import app.seans.tv.player.ui.SubtitleLines
import app.seans.tv.player.ui.VideoSurface
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

/**
 * Video only. Takes the shared player on `ON_START` and releases it on `ON_STOP` (the TV kills
 * the app soon after Home); a new start searches and resolves again at the channel position.
 * Not focusable: keys stay with `:live`'s overlay, and no `MediaSession` exists for media keys.
 */
@Composable
internal fun BroadcastPlayerView(
    request: PlaybackRequest,
    lock: StateFlow<BroadcastLock>,
    clock: ServerClock,
    graph: AppGraph,
    onState: (BroadcastPlaybackState) -> Unit,
    modifier: Modifier,
    controller: BroadcastController?,
) {
    val context = LocalContext.current
    val engine = remember(graph) { ExoEngine(context.applicationContext, graph.http) }
    val prefs = remember(request) { BroadcastPrefs() }
    val scope = rememberCoroutineScope()
    val latestOnState by rememberUpdatedState(onState)
    var player by remember { mutableStateOf<ExoPlayer?>(null) }
    var cues by remember { mutableStateOf<List<String>>(emptyList()) }
    val controls = controller as? BroadcastControls
    // A clock lambda recreated on every recomposition must not restart playback.
    val latestClock by rememberUpdatedState(clock)
    val stableClock = remember { ServerClock { latestClock.nowMs() } }

    LifecycleStartEffect(request, lock, engine, controls) {
        player = engine.attach()
        val session = BroadcastSession(
            request = request,
            lock = lock,
            clock = stableClock,
            sources = graph.sources,
            engine = engine,
            scope = scope,
            prefs = prefs,
            onState = { latestOnState(it) },
            elapsed = SystemClock::elapsedRealtime,
            catalog = graph.catalog,
        )
        session.start()
        controls?.bind(session)
        val publish = scope.launch {
            combine(session.voicesFlow, session.subtitlesFlow, session.voiceFlow) { v, s, id -> Triple(v, s, id) }
                .collect { (v, s, id) -> controls?.publish(v, s, id) }
        }
        val cueJob = scope.launch { session.cuesFlow.collect { cues = it } }
        onStopOrDispose {
            publish.cancel()
            cueJob.cancel()
            controls?.unbind(session)
            session.stop()
            engine.detach()
            player = null
            cues = emptyList()
        }
    }

    Box(modifier) {
        VideoSurface(player)
        SubtitleLines(cues, bottomPadding = 40.dp)
    }
}
