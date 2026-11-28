package app.seans.tv.live

import android.util.Log
import app.seans.tv.live.channel.Channel
import app.seans.tv.live.channel.ChannelMeta
import app.seans.tv.live.channel.ChannelMode
import app.seans.tv.live.channel.PositionState
import app.seans.tv.live.channel.SlotStatus
import app.seans.tv.live.channel.computePosition
import app.seans.tv.live.channel.coverUrl
import app.seans.tv.live.channel.displayTitle
import app.seans.tv.live.channel.getScheduleBounds
import app.seans.tv.live.channel.normalizeChannel
import app.seans.tv.live.channel.playbackBounds
import app.seans.tv.live.channel.programmeModel
import app.seans.tv.live.channel.projectPausedSchedule
import app.seans.tv.live.channel.resolveChannel
import app.seans.tv.live.channel.slotCaption
import app.seans.tv.model.EpisodeKey
import app.seans.tv.model.LiveNow
import app.seans.tv.model.LiveSlot
import app.seans.tv.model.MediaType
import app.seans.tv.model.ServerClock
import app.seans.tv.model.TitleRef
import app.seans.tv.network.SeansHttp
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * What the two listeners know. [manual] is null until the first `settings/cinemaChannel`
 * snapshot. A cache snapshot is provisional (F6): [confirmed] turns true once both listeners have
 * a server snapshot, or 3 s after subscribing, whichever comes first; until then no player mounts.
 */
data class LiveData(
    val manual: Channel? = null,
    val schedule: List<Channel> = emptyList(),
    val scheduleReady: Boolean = false,
    val scheduleError: Boolean = false,
    val channelError: Boolean = false,
    val confirmed: Boolean = false,
    /** No channel snapshot 12 s after subscribing (offline, blocked). */
    val stalled: Boolean = false,
) {
    val unavailable: Boolean get() = channelError || (manual == null && stalled)
}

private sealed interface Snap<out T> {
    data class Data<T>(val value: T, val fromCache: Boolean) : Snap<T>
    data class Error(val error: Exception) : Snap<Nothing>
}

private enum class Stage { START, GRACE, STALL }

/**
 * The live channel («Эфир»). Reads `settings/cinemaChannel` and `cinemaSchedule` with the
 * extension's query shapes (one document, the whole collection), read-only: the TV never writes
 * the channel, the schedule or the `settings` documents, although the owner is an admin (R3).
 *
 * Two snapshot listeners at most, shared by Home's «Эфир» row and the Live screen through one
 * `stateIn(WhileSubscribed(5_000))`; they stop 5 s after the last collector leaves (M4).
 */
class LiveModule(
    private val firestore: FirebaseFirestore,
    http: SeansHttp,
) : LiveFeature {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val liveClock = LiveClock(http)

    override val clock: ServerClock get() = liveClock

    private fun nowMs(): Double = liveClock.nowMs().toDouble()

    private val manualFlow: Flow<Snap<Channel>> = callbackFlow {
        val registration = firestore.collection("settings").document("cinemaChannel")
            .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
                if (error != null) {
                    Log.w(TAG, "channel listener failed: ${error.code}")
                    trySend(Snap.Error(error))
                    return@addSnapshotListener
                }
                if (snapshot == null) return@addSnapshotListener
                val channel = normalizeChannel(if (snapshot.exists()) plain(snapshot.data) else null)
                trySend(Snap.Data(channel, snapshot.metadata.isFromCache))
            }
        awaitClose { registration.remove() }
    }

    private val scheduleFlow: Flow<Snap<List<Channel>>> = callbackFlow {
        val registration = firestore.collection("cinemaSchedule")
            .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
                if (error != null) {
                    Log.w(TAG, "schedule listener failed: ${error.code}")
                    trySend(Snap.Error(error))
                    return@addSnapshotListener
                }
                if (snapshot == null) return@addSnapshotListener
                val items = snapshot.documents
                    .map { normalizeChannel(plain(it.data), ChannelMeta.schedule(it.id)) }
                    .filter { it.mode != ChannelMode.OFF }
                    .sortedWith { a, b -> a.startedAtMs.compareTo(b.startedAtMs) }
                trySend(Snap.Data(items, snapshot.metadata.isFromCache))
            }
        awaitClose { registration.remove() }
    }

    private val stages: Flow<Stage> = flow {
        emit(Stage.START)
        delay(PROVISIONAL_MS)
        emit(Stage.GRACE)
        delay(STALL_MS - PROVISIONAL_MS)
        emit(Stage.STALL)
    }

    private data class Acc(
        val manual: Channel? = null,
        val manualFromServer: Boolean = false,
        val manualError: Boolean = false,
        val schedule: List<Channel> = emptyList(),
        val scheduleFromServer: Boolean = false,
        val scheduleReady: Boolean = false,
        val scheduleError: Boolean = false,
        val stage: Stage = Stage.START,
    ) {
        fun toLiveData() = LiveData(
            manual = manual,
            schedule = schedule,
            scheduleReady = scheduleReady,
            scheduleError = scheduleError,
            channelError = manualError,
            confirmed = (manualFromServer && (scheduleFromServer || scheduleError)) || stage != Stage.START,
            stalled = stage == Stage.STALL,
        )
    }

    /** The listeners' state; Home and the Live screen share it. A new subscription starts from scratch. */
    internal val data: StateFlow<LiveData> = merge(
        manualFlow.map { snap -> { acc: Acc ->
            when (snap) {
                is Snap.Data -> acc.copy(manual = snap.value, manualFromServer = !snap.fromCache, manualError = false)
                is Snap.Error -> acc.copy(manualError = true)
            }
        } },
        scheduleFlow.map { snap -> { acc: Acc ->
            when (snap) {
                is Snap.Data -> acc.copy(schedule = snap.value, scheduleFromServer = !snap.fromCache, scheduleReady = true, scheduleError = false)
                is Snap.Error -> acc.copy(scheduleError = true)
            }
        } },
        stages.map { stage -> { acc: Acc -> acc.copy(stage = stage) } },
    )
        .scan(Acc()) { acc, update -> update(acc) }
        .map { it.toLiveData() }
        .distinctUntilChanged()
        .onStart { scope.launch { liveClock.sync() } }
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), LiveData())

    /** Re-measures the server clock when the Live screen opens (at most every 10 minutes). */
    internal suspend fun syncClock() = liveClock.sync()

    /** A tick on each server-time second: shows start and end by time alone. */
    internal val ticks: Flow<Long> = flow {
        while (true) {
            val now = liveClock.nowMs()
            emit(now)
            delay(1000 - now % 1000)
        }
    }

    override fun now(): Flow<LiveNow?> =
        combine(data, ticks) { live, _ -> liveNow(live, nowMs()) }.distinctUntilChanged()

    override fun programme(): Flow<List<LiveSlot>> =
        combine(data, ticks) { live, _ -> programmeSlots(live, nowMs()) }.distinctUntilChanged()

    companion object {
        private const val TAG = "LiveModule"
        /** A cache snapshot is trusted for display only; the player mounts after a server one or this long (F6). */
        const val PROVISIONAL_MS = 3_000L
        /** No snapshot at all this long: «Эфир недоступен» (`live.js` stall timer). */
        const val STALL_MS = 12_000L

        /** Firestore values to plain Kotlin: timestamps become [Date], the rest is unchanged. */
        internal fun plain(value: Any?): Any? = when (value) {
            is Timestamp -> value.toDate()
            is Map<*, *> -> value.entries.associate { (k, v) -> k to plain(v) }
            is List<*> -> value.map(::plain)
            else -> value
        }

        internal fun minute(ms: Double) = if (ms.isFinite()) Math.floor(ms / 60_000) * 60_000 else ms

        internal fun Channel.titleRef(): TitleRef? {
            val movie = movie ?: return null
            if (mode != ChannelMode.MOVIE) return null
            return TitleRef.ofOrNull(movie.kinopoiskId, if (movie.isEpisode) MediaType.SERIES else MediaType.MOVIE, movie.tmdbId)
        }

        internal fun Channel.episodeKey(): EpisodeKey? =
            movie?.takeIf { it.isEpisode }?.let { EpisodeKey.ofOrNull(it.seasonNumber, it.episodeNumber) }

        /** Home's «Эфир» card: the show on air or the next one; null when off or ended. */
        internal fun liveNow(live: LiveData, nowMs: Double): LiveNow? {
            val manual = live.manual ?: return null
            val channel = resolveChannel(manual, live.schedule, nowMs)
            val position = computePosition(channel, nowMs)
            if (channel.mode == ChannelMode.OFF || position.state == PositionState.OFF || position.state == PositionState.ENDED) return null
            val bounds = if (position.onAir) playbackBounds(channel, nowMs).let { it.copy(startMs = minute(it.startMs), endMs = minute(it.endMs)) }
            else getScheduleBounds(channel)
            if (!bounds.startMs.isFinite()) return null
            return LiveNow(
                title = displayTitle(channel),
                ref = channel.titleRef(),
                episode = channel.episodeKey(),
                posterUrl = coverUrl(channel).ifEmpty { null },
                startsAt = bounds.startMs.toLong(),
                endsAt = bounds.endMs.takeIf { it.isFinite() }?.toLong(),
                isYoutube = channel.mode == ChannelMode.YOUTUBE,
            )
        }

        /** Today's programme from now on, the show on air first. */
        internal fun programmeSlots(live: LiveData, nowMs: Double, zone: ZoneId = ZoneId.systemDefault()): List<LiveSlot> {
            val manual = live.manual ?: return emptyList()
            val channel = resolveChannel(manual, live.schedule, nowMs)
            val position = computePosition(channel, nowMs)
            val items = projectPausedSchedule(live.schedule, channel, nowMs)
            return programmeModel(items, channel, position, nowMs, zone).rows
                .filter { it.status == SlotStatus.CURRENT || it.status == SlotStatus.NEXT || it.status == SlotStatus.LATER }
                .map { row ->
                    LiveSlot(
                        title = displayTitle(row.item),
                        startsAt = row.startMs.toLong(),
                        endsAt = row.endMs.takeIf { it.isFinite() }?.toLong(),
                        ref = row.item.titleRef(),
                        episode = row.item.episodeKey(),
                        caption = slotCaption(row.item),
                    )
                }
        }
    }
}
