package app.seans.tv.live

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.tv.material3.Text
import app.seans.tv.designsystem.SeansColors
import app.seans.tv.live.channel.LiveStrings
import app.seans.tv.live.ui.LiveScreenContent
import app.seans.tv.model.AppGraph
import app.seans.tv.model.LiveSummaryProvider
import app.seans.tv.model.TitleRef

/*
 * Public API of `:live`. The signatures are the contract with `:app`; the `tv-live` session
 * replaces the bodies. Changing a signature goes through the coordinator.
 */

/**
 * The live channel. `:app` builds it once in `SeansApp` with the shared Firestore instance and
 * HTTP client (for the server clock) and puts it into `AppGraph.live`. It reads only
 * `settings/cinemaChannel` and `cinemaSchedule` and writes nothing.
 */
interface LiveFeature : LiveSummaryProvider

/**
 * «Эфир» full screen: the current broadcast through `BroadcastPlayer` (or a WebView for a
 * YouTube item), the «В эфире» header, the locked timeline, the programme panel, and the
 * viewer's own sound/voice/subtitle controls.
 */
@Composable
fun LiveScreen(
    feature: LiveFeature,
    graph: AppGraph,
    onOpenDetails: (TitleRef) -> Unit,
    onExit: () -> Unit,
) {
    val module = feature as? LiveModule
    if (module == null) {
        // Only `LiveModule` carries the channel listeners; anything else has nothing to show.
        Box(Modifier.fillMaxSize().background(SeansColors.Bg), contentAlignment = Alignment.Center) {
            Text(LiveStrings.UNAVAILABLE_TITLE, color = SeansColors.Text2)
        }
        return
    }
    LiveScreenContent(module, graph, onOpenDetails, onExit)
}
