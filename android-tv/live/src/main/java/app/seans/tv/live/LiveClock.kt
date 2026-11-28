package app.seans.tv.live

import android.os.SystemClock
import android.util.Log
import app.seans.tv.model.ServerClock
import app.seans.tv.network.SeansHttp
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.CacheControl
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import okhttp3.Response

/** One server-time sample: the server instant aimed at the middle of its 1-second `Date`, and the round trip. */
data class ClockSample(val offsetMs: Double, val rttMs: Long)

/**
 * Google's server time, as `CinemaChannelService.syncClock` measures it: the HTTP `Date` header of
 * `HEAD https://firestore.googleapis.com/`, three samples, the lowest round trip wins, +500 ms for
 * the header's 1-second resolution, offsets under 1 s ignored (the clocks then agree well enough).
 *
 * Unlike the extension, time runs on the monotonic clock after a sync: an NTP correction of the
 * TV's wall clock (the TV may be minutes off until NTP syncs, L1) cannot move the channel.
 */
class LiveClock(
    private val sampler: suspend () -> ClockSample,
    private val wallMs: () -> Long = System::currentTimeMillis,
    private val monotonicMs: () -> Long = SystemClock::elapsedRealtime,
    private val log: (String) -> Unit = { Log.i(TAG, it) },
) : ServerClock {

    constructor(http: SeansHttp) : this(sampler = { sampleServerClock(http) })

    private class Base(val serverMs: Long, val monotonicMs: Long)

    @Volatile private var base: Base? = null
    @Volatile private var syncedAtMonotonic = Long.MIN_VALUE
    private val mutex = Mutex()

    /** The applied offset in ms (0 until a sync, or when the TV clock is within 1 s). */
    @Volatile var offsetMs: Long = 0
        private set

    override fun nowMs(): Long {
        val current = base ?: return wallMs()
        return current.serverMs + (monotonicMs() - current.monotonicMs)
    }

    /** Syncs unless a sync succeeded within [maxAgeMs]. Never throws; offline keeps the last offset. */
    suspend fun sync(maxAgeMs: Long = RESYNC_MS) {
        mutex.withLock {
            if (base != null && monotonicMs() - syncedAtMonotonic < maxAgeMs) return
            val samples = mutableListOf<ClockSample>()
            repeat(SAMPLES) { runCatching { samples += sampler() }.onFailure { if (it is kotlinx.coroutines.CancellationException) throw it } }
            if (samples.isEmpty()) {
                log("server clock unavailable; using the TV clock")
                return
            }
            val best = samples.minBy { it.rttMs }.offsetMs
            // Ignore sub-second noise; only correct clocks that are really off.
            val applied = if (Math.abs(best) > 1000) Math.round(best) else 0L
            offsetMs = applied
            base = Base(wallMs() + applied, monotonicMs())
            syncedAtMonotonic = monotonicMs()
            log("server clock offset ${applied} ms (best rtt ${samples.minOf { it.rttMs }} ms)")
        }
    }

    companion object {
        private const val TAG = "LiveClock"
        const val CLOCK_URL = "https://firestore.googleapis.com/"
        private const val SAMPLES = 3
        /** Re-measure when the Live screen opens and the last sync is older than this. */
        const val RESYNC_MS = 10 * 60_000L

        /** One `HEAD` through the app's DoH client, bypassing the HTTP cache. */
        suspend fun sampleServerClock(http: SeansHttp, wallMs: () -> Long = System::currentTimeMillis): ClockSample =
            withContext(Dispatchers.IO) {
                val request = Request.Builder().url(CLOCK_URL).head().cacheControl(CacheControl.FORCE_NETWORK).build()
                val sentAt = wallMs()
                val serverMs = http.client.newCall(request).await().use { response ->
                    response.headers.getDate("Date")?.time ?: throw IOException("NO_DATE_HEADER")
                }
                val receivedAt = wallMs()
                offsetFrom(serverMs, sentAt, receivedAt)
            }

        /** `serverMs + 500 - (sentAt + rtt / 2)`: the header has 1-second resolution, aim at its middle. */
        fun offsetFrom(serverMs: Long, sentAt: Long, receivedAt: Long): ClockSample {
            val rtt = receivedAt - sentAt
            return ClockSample(serverMs + 500 - (sentAt + rtt / 2.0), rtt)
        }

        private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { cancel() }
            enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) = continuation.resumeWithException(e)
                override fun onResponse(call: Call, response: Response) = continuation.resume(response)
            })
        }
    }
}
