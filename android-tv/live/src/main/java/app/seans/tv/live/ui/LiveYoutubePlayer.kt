package app.seans.tv.live.ui

import android.annotation.SuppressLint
import android.graphics.Color as AndroidColor
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import app.seans.tv.live.channel.Channel
import app.seans.tv.live.channel.computePosition
import app.seans.tv.live.channel.playbackAnchorMs
import app.seans.tv.model.ServerClock
import kotlinx.coroutines.delay
import org.json.JSONObject

/** What the Hosting wrapper reports about the YouTube video. */
internal sealed interface YoutubeEvent {
    data object Playing : YoutubeEvent
    /** The video ran out at [atSec] (never for a live stream). */
    data class Ended(val atSec: Long) : YoutubeEvent
    /** Length of a regular upload, in seconds. */
    data class Duration(val sec: Double) : YoutubeEvent
    data object IsLive : YoutubeEvent
    data class Error(val code: Int) : YoutubeEvent
    data class Captions(val tracks: List<CaptionTrack>) : YoutubeEvent
}

internal data class CaptionTrack(val languageCode: String, val name: String)

/**
 * A YouTube programme item (L3): a WebView on the Hosting wrapper `public/player/embed.html`
 * (`player.config.js` `YOUTUBE_WRAPPER_URL`), loaded top-level with `controls=0`, which also
 * turns on the wrapper's pointer shield and YouTube's `disablekb`. The WebView never takes focus,
 * so the remote's keys stay with the Compose screen; the channel clock drives the video through
 * the wrapper's `postMessage` commands, correcting drift only by seeking (3 s while playing,
 * 1 s while paused, as `player-cleaner.js` does for viewers). Released when it leaves composition.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun LiveYoutubePlayer(
    channel: Channel,
    clock: ServerClock,
    muted: Boolean,
    captionLanguage: String?,
    onEvent: (YoutubeEvent) -> Unit,
    modifier: Modifier = Modifier,
) {
    val youtube = channel.youtube ?: return
    val currentChannel by rememberUpdatedState(channel)
    val currentOnEvent by rememberUpdatedState(onEvent)
    val tracker = remember(youtube.videoId) { WrapperState() }
    var webView by remember { mutableStateOf<WebView?>(null) }

    val startUrl = remember(youtube.videoId, channel.docPath) {
        val now = clock.nowMs().toDouble()
        val position = computePosition(channel, now)
        val paused = channel.mediaPausedAtSec.isFinite()
        "$WRAPPER_URL?v=${youtube.videoId}&autoplay=${if (paused) 0 else 1}&mute=0&controls=0&t=${position.offsetSec}"
    }

    AndroidView(
        modifier = modifier,
        factory = { context ->
            WebView(context).apply {
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                setBackgroundColor(AndroidColor.BLACK)
                // The remote stays with Compose: no focus, no keys, no pointer.
                isFocusable = false
                isFocusableInTouchMode = false
                descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
                setOnKeyListener { _, _, _ -> true }
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                webChromeClient = WebChromeClient()
                val main = Handler(Looper.getMainLooper())
                addJavascriptInterface(object {
                    @JavascriptInterface
                    fun post(json: String) {
                        main.post { tracker.handle(json)?.let { currentOnEvent(it) } }
                    }
                }, BRIDGE)
                webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String) {
                        if (!url.startsWith(WRAPPER_URL)) return
                        tracker.pageFinishedAt = SystemClock.elapsedRealtime()
                        // The wrapper posts to `window.parent`, which is the page itself here.
                        view.evaluateJavascript(LISTENER_JS, null)
                    }
                }
                loadUrl(startUrl)
                webView = this
            }
        },
        onRelease = { view ->
            webView = null
            view.stopLoading()
            view.evaluateJavascript("window.postMessage({action:'DESTROY'},'*')", null)
            view.loadUrl("about:blank")
            view.removeJavascriptInterface(BRIDGE)
            view.destroy()
        },
    )

    LaunchedEffect(webView, muted) { webView?.command(if (muted) "MUTE" else "UNMUTE") }
    LaunchedEffect(webView, captionLanguage) {
        val payload = captionLanguage?.let { "{languageCode:${JSONObject.quote(it)}}" } ?: "{languageCode:''}"
        if (tracker.everReported) webView?.command("SET_CAPTIONS", payload)
    }

    // The broadcast lock: once a second, pull the video to the channel position.
    LaunchedEffect(webView, youtube.videoId) {
        val view = webView ?: return@LaunchedEffect
        var lastSeekAt = 0L
        while (true) {
            delay(1_000)
            val item = currentChannel
            val media = item.youtube ?: continue
            if (!tracker.everReported) {
                // READY can fire before the listener is installed; a cued video then never reports.
                val finished = tracker.pageFinishedAt
                if (finished > 0 && SystemClock.elapsedRealtime() - finished > 4_000 && !item.mediaPausedAtSec.isFinite()
                    && SystemClock.elapsedRealtime() - lastSeekAt > SEEK_GAP_MS) {
                    val now = clock.nowMs().toDouble()
                    if (!media.live) view.seek((now - playbackAnchorMs(item, now)) / 1000)
                    view.command("PLAY")
                    lastSeekAt = SystemClock.elapsedRealtime()
                }
                continue
            }
            if (tracker.state == "ENDED") continue
            if (media.live) {
                if (tracker.state in STOPPED) view.command("PLAY")
                continue
            }
            val now = clock.nowMs().toDouble()
            val pausedAt = item.mediaPausedAtSec
            val target = if (pausedAt.isFinite()) pausedAt else (now - playbackAnchorMs(item, now)) / 1000
            val current = tracker.estimatedTime()
            val sinceSeek = SystemClock.elapsedRealtime() - lastSeekAt
            if (pausedAt.isFinite()) {
                if (tracker.state == "PLAYING" || tracker.state == "BUFFERING") {
                    view.command("PAUSE")
                    view.seek(target); lastSeekAt = SystemClock.elapsedRealtime()
                } else if (Math.abs(current - target) > PAUSED_DRIFT_SEC && sinceSeek > SEEK_GAP_MS) {
                    view.seek(target); lastSeekAt = SystemClock.elapsedRealtime()
                }
            } else {
                if (tracker.state in STOPPED) {
                    view.seek(target); lastSeekAt = SystemClock.elapsedRealtime()
                    view.command("PLAY")
                } else if (tracker.state == "PLAYING" && Math.abs(current - target) > DRIFT_SEC && sinceSeek > SEEK_GAP_MS) {
                    Log.i(TAG, "drift ${"%.1f".format(current - target)} s, seeking")
                    view.seek(target); lastSeekAt = SystemClock.elapsedRealtime()
                }
            }
        }
    }

    DisposableEffect(Unit) { onDispose { tracker.reset() } }
}

private fun WebView.command(action: String, payload: String = "{}") {
    evaluateJavascript("window.postMessage({action:'$action',payload:$payload},'*')", null)
}

private fun WebView.seek(seconds: Double) = command("SEEK", "{seconds:${"%.2f".format(java.util.Locale.ROOT, maxOf(0.0, seconds))}}")

/** The wrapper's reported player state, from `STATE_CHANGE` and `TIME_UPDATE` messages. */
private class WrapperState {
    var state: String = "UNSTARTED"
    var everReported = false
    var pageFinishedAt = 0L
    private var time = 0.0
    private var timeAt = 0L
    private var lastDuration = 0.0
    private var endedReported = false
    private var live = false

    fun reset() { everReported = false; state = "UNSTARTED" }

    fun estimatedTime(): Double =
        if (state == "PLAYING") time + (SystemClock.elapsedRealtime() - timeAt) / 1000.0 else time

    private fun noteTime(payload: JSONObject) {
        val t = payload.optDouble("currentTime", Double.NaN)
        if (t.isFinite()) { time = t; timeAt = SystemClock.elapsedRealtime() }
    }

    fun handle(json: String): YoutubeEvent? {
        val message = runCatching { JSONObject(json) }.getOrNull() ?: return null
        val payload = message.optJSONObject("payload") ?: JSONObject()
        everReported = true
        return when (message.optString("event")) {
            "READY" -> {
                if (payload.optBoolean("isLive")) { live = true; YoutubeEvent.IsLive } else duration(payload)
            }
            "TIME_UPDATE" -> {
                state = payload.optString("state", state)
                noteTime(payload)
                duration(payload)
            }
            "STATE_CHANGE" -> {
                val previous = state
                state = payload.optString("state", state)
                noteTime(payload)
                if (payload.optBoolean("isLive")) live = true
                when {
                    state == "ENDED" && !live && !endedReported -> { endedReported = true; YoutubeEvent.Ended(time.toLong()) }
                    state == "PLAYING" && previous != "PLAYING" -> { endedReported = false; YoutubeEvent.Playing }
                    else -> null
                }
            }
            "CAPTIONS" -> {
                val tracks = payload.optJSONArray("tracks") ?: return null
                YoutubeEvent.Captions((0 until tracks.length()).mapNotNull { i ->
                    val track = tracks.optJSONObject(i) ?: return@mapNotNull null
                    val code = track.optString("languageCode")
                    if (code.isEmpty()) null else CaptionTrack(code, track.optString("displayName", code))
                })
            }
            "ERROR" -> YoutubeEvent.Error(payload.optInt("errorCode", 0))
            else -> null
        }
    }

    private fun duration(payload: JSONObject): YoutubeEvent? {
        val sec = payload.optDouble("duration", 0.0)
        if (live || !(sec > 0) || Math.abs(sec - lastDuration) < 1) return null
        lastDuration = sec
        return YoutubeEvent.Duration(sec)
    }
}

private const val TAG = "LiveYoutube"
private const val WRAPPER_URL = "https://movielistdb-13208.web.app/player/embed.html"
private const val BRIDGE = "SeansLive"
private const val DRIFT_SEC = 3.0
private const val PAUSED_DRIFT_SEC = 1.0
private const val SEEK_GAP_MS = 3_000L
private val STOPPED = setOf("PAUSED", "CUED", "UNSTARTED")
private val LISTENER_JS = """
    (function(){
      if (window.__seansLive) return; window.__seansLive = true;
      window.addEventListener('message', function(e){
        var d = e.data;
        if (!d || d.source !== 'STARTTAB_PLAYER_WRAPPER') return;
        try { $BRIDGE.post(JSON.stringify({event: d.event, payload: d.payload || {}})); } catch (_) {}
      });
    })();
""".trimIndent()
