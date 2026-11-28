package app.seans.tv.live.channel

import java.time.Instant
import java.time.ZoneId

/*
 * Viewer models of `src/pages/live/LiveProgramme.js` (`programmeModel`) and
 * `src/pages/live/LiveStandby.js` (what the standby card says), without the DOM.
 */

enum class SlotStatus { CURRENT, FINISHED, NEXT, LATER, NOT_ON_AIR }

data class ProgrammeRow(
    val item: Channel,
    val startMs: Double,
    val endMs: Double,
    val explicitEnd: Boolean,
    val status: SlotStatus,
    /** 0..100 for the show on air, null otherwise. */
    val progress: Int?,
)

data class ProgrammeModel(
    val rows: List<ProgrammeRow>,
    val next: Channel?,
    val active: Channel?,
    val dayStart: Long,
    val dayEnd: Long,
)

/**
 * Today's programme in the viewer's time zone: every slot that overlaps the local day, the show
 * on air placed by its playback clock (whole minutes), the next one marked.
 */
fun programmeModel(
    items: List<Channel>,
    channel: Channel?,
    position: Position?,
    nowMs: Double,
    zone: ZoneId = ZoneId.systemDefault(),
): ProgrammeModel {
    val today = Instant.ofEpochMilli(nowMs.toLong()).atZone(zone).toLocalDate()
    val dayStart = today.atStartOfDay(zone).toInstant().toEpochMilli()
    val dayEnd = today.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    val active = if (position?.onAir == true && channel != null && channel.mode != ChannelMode.OFF) channel else null
    val sources = items.toMutableList()
    if (active != null && sources.none { it.identity == active.identity }) sources += active
    val next = nextScheduled(items, nowMs)
    fun minute(ms: Double) = if (ms.isFinite()) Math.floor(ms / 60_000) * 60_000 else ms
    val rows = sources.filter { it.mode != ChannelMode.OFF && it.startedAtMs.isFinite() }
        .map { item ->
            val current = active != null && item.identity == active.identity
            // The show on air follows its playback clock, so a seek moves it too.
            val bounds = if (current) playbackBounds(item, nowMs).let { it.copy(startMs = minute(it.startMs), endMs = minute(it.endMs)) }
            else getScheduleBounds(item)
            val ended = bounds.endMs <= nowMs || (item.identity == channel?.identity && position?.state == PositionState.ENDED)
            val status = when {
                current -> SlotStatus.CURRENT
                ended -> SlotStatus.FINISHED
                item.startedAtMs > nowMs -> if (item.identity == next?.identity) SlotStatus.NEXT else SlotStatus.LATER
                else -> SlotStatus.NOT_ON_AIR
            }
            val progress = if (current && bounds.endMs.isFinite()) {
                Math.floor((nowMs - bounds.startMs) / (bounds.endMs - bounds.startMs) * 100).coerceIn(0.0, 100.0).toInt()
            } else null
            ProgrammeRow(item, bounds.startMs, bounds.endMs, bounds.explicitEnd, status, progress)
        }
        .filter { it.startMs < dayEnd && it.endMs > dayStart }
        .sortedWith(compareBy<ProgrammeRow> { it.startMs }.thenBy { it.item.identity })
    return ProgrammeModel(rows, next, active, dayStart, dayEnd)
}

/** Which card the standby screen shows. */
enum class StandbyKind {
    /** No connection to the channel. */
    UNAVAILABLE,
    /** Between shows, a next one is planned: countdown. */
    GAP,
    /** The show ended early (its file was shorter than the slot); a next one is planned. */
    ENDED_WITH_NEXT,
    /** The last show ended and nothing is planned. */
    ENDED,
    /** Nothing on air and nothing planned. */
    EMPTY,
}

data class StandbyModel(
    val kind: StandbyKind,
    val label: String,
    val title: String,
    val text: String,
    /** The countdown line under the card, or the hint when there is no countdown. */
    val next: Channel?,
    val countdownSec: Long?,
    val noTimeHint: String?,
)

/** What `LiveStandby.render` puts on screen, with the extension's Russian strings. */
fun standbyModel(channel: Channel?, position: Position?, next: Channel?, nowMs: Double, unavailable: Boolean): StandbyModel {
    val upcoming = !unavailable && next != null
    val ended = !unavailable && channel?.mode != ChannelMode.OFF && position?.state == PositionState.ENDED
    val kind = when {
        unavailable -> StandbyKind.UNAVAILABLE
        upcoming -> if (ended) StandbyKind.ENDED_WITH_NEXT else StandbyKind.GAP
        ended -> StandbyKind.ENDED
        else -> StandbyKind.EMPTY
    }
    val (label, title, text) = when (kind) {
        StandbyKind.UNAVAILABLE -> Triple(LiveStrings.UNAVAILABLE_LABEL, LiveStrings.UNAVAILABLE_TITLE, LiveStrings.UNAVAILABLE_TEXT)
        StandbyKind.GAP -> Triple(LiveStrings.GAP_LABEL, LiveStrings.GAP_TITLE, LiveStrings.GAP_TEXT)
        StandbyKind.ENDED_WITH_NEXT -> Triple(LiveStrings.ENDED_LABEL, LiveStrings.ENDED_NEXT_TITLE, LiveStrings.ENDED_NEXT_TEXT)
        StandbyKind.ENDED -> Triple(LiveStrings.EMPTY_LABEL, LiveStrings.ENDED_TITLE, LiveStrings.EMPTY_TEXT)
        StandbyKind.EMPTY -> Triple(LiveStrings.EMPTY_LABEL, LiveStrings.EMPTY_TITLE, LiveStrings.EMPTY_TEXT)
    }
    return StandbyModel(
        kind = kind,
        label = label,
        title = title,
        text = text,
        next = if (upcoming) next else null,
        countdownSec = if (upcoming) maxOf(0, Math.ceil((next!!.startedAtMs - nowMs) / 1000).toLong()) else null,
        noTimeHint = if (upcoming) null else if (unavailable) LiveStrings.CONNECTION_HINT else LiveStrings.NO_SHOWS,
    )
}

/** «2 ч 24 мин», «45 мин». */
fun formatLength(totalSec: Long): String {
    val minutes = (totalSec + 30) / 60
    val h = minutes / 60
    val m = minutes % 60
    return when {
        h > 0 && m > 0 -> "$h ч ${m.toString().padStart(2, '0')} мин"
        h > 0 -> "$h ч"
        else -> "$m мин"
    }
}

/** The line under a programme title: «С1 · Е2 · Пилот», «Прямой эфир», «2 ч 24 мин». */
fun slotCaption(item: Channel): String? {
    val movie = item.movie
    if (item.mode == ChannelMode.MOVIE && movie != null && movie.isEpisode) {
        return listOfNotNull("С${movie.seasonNumber} · Е${movie.episodeNumber}", movie.episodeTitle?.takeIf { it.isNotEmpty() })
            .joinToString(" · ")
    }
    if (item.isLiveStream) return LiveStrings.STREAM
    return item.mediaDurationSec.takeIf { it > 0 }?.let(::formatLength)
}

/** Title shown for an item: its own, else «Фильм в эфире» / «Эфир». */
fun displayTitle(item: Channel): String =
    item.title.ifEmpty { if (item.mode == ChannelMode.YOUTUBE) LiveStrings.TITLE else LiveStrings.MOVIE_ON_AIR }

/** Russian strings of the extension's `live_page` locale, plus the TV-only lines of the mockup. */
object LiveStrings {
    const val TITLE = "Эфир"
    const val MOVIE_ON_AIR = "Фильм в эфире"
    const val BADGE_LIVE = "В эфире"
    const val BADGE_PAUSED = "Пауза"
    const val LOCK_LINE = "В эфире все смотрят одно и то же: паузы и перемотки нет. Звук, субтитры и качество — ваши."
    const val STREAM = "Прямой эфир"
    const val PROGRAMME = "Программа"
    const val PROGRAMME_TODAY = "Программа на сегодня"
    const val PROGRAMME_EMPTY = "На сегодня пока нет программы"
    const val PROGRAMME_EMPTY_TEXT = "Новые показы появятся здесь, как только будут запланированы."
    const val PROGRAMME_LOADING = "Загружаем программу…"
    const val PROGRAMME_STALE = "Не удалось обновить программу. Показано последнее полученное расписание — время могло измениться."
    const val CONNECTING = "Подключаемся к эфиру…"
    const val STARTS = "начало"
    const val ENDS = "конец"
    const val ABOUT = "О фильме"
    const val SOUND = "Звук"
    const val SOUND_OFF = "Без звука"
    const val VOICE = "Озвучка"
    const val SUBTITLES_OFF = "Выкл"
    const val SUBTITLES = "Субтитры"
    const val NO_SOURCE_TITLE = "Нет источника"
    const val NO_SOURCE_TEXT = "Ни один источник не может показать этот фильм на телевизоре. Эфир продолжается — следующий показ начнётся по программе."
    const val SEARCHING = "Ищем источник…"
    const val YOUTUBE_BLOCKED = "YouTube не даёт показать это видео здесь."
    const val COUNTDOWN = "До следующего показа"
    const val NEXT = "Далее в эфире"
    const val PAUSED_AT = "Пауза на"
    const val UPCOMING_IN = "Начало через"

    const val UNAVAILABLE_LABEL = "Нет соединения"
    const val UNAVAILABLE_TITLE = "Эфир недоступен"
    const val UNAVAILABLE_TEXT = "Не удалось подключиться к каналу. Проверьте соединение и попробуйте позже."
    const val GAP_LABEL = "Между показами"
    const val GAP_TITLE = "Небольшой антракт"
    const val GAP_TEXT = "Оставайтесь на волне. Следующий показ начнётся автоматически."
    const val ENDED_LABEL = "Показ завершён"
    const val ENDED_NEXT_TITLE = "До встречи на следующем сеансе"
    const val ENDED_NEXT_TEXT = "Видео закончилось. Следующий показ начнётся в своё время по программе."
    const val ENDED_TITLE = "Показ завершился"
    const val EMPTY_LABEL = "Канал ожидает программу"
    const val EMPTY_TITLE = "Эфир пока не начался"
    const val EMPTY_TEXT = "Новых показов пока нет. Программа появится здесь, как только будет готова."
    const val CONNECTION_HINT = "Проверьте соединение и попробуйте снова"
    const val NO_SHOWS = "Новых показов пока нет"
}
