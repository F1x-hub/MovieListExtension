package app.seans.tv.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Provider ratings stay separate, as in the extension: a KP badge never shows a TMDB value. */
@Serializable
data class Ratings(
    val kinopoisk: Double? = null,
    val imdb: Double? = null,
    /** The signed-in user's own score, 1..10 (`ratings/{uid}_{kp}`). */
    val mine: Int? = null,
    /** Average of the extension's users (`movies/{kp}.avgRating`). There is no friends graph. */
    val community: Double? = null,
)

/** What a card, a row item or a search result needs. Keep it small: lists hold many of these. */
@Serializable
data class TitleSummary(
    val ref: TitleRef,
    val title: String,
    val originalTitle: String? = null,
    val year: Int? = null,
    /** Poster URL sized for a card (about 360 px wide). Load with a size limit, never the original. */
    val posterUrl: String? = null,
    /** Wide picture for heroes; may be null, then the UI falls back to the poster. */
    val backdropUrl: String? = null,
    val ratings: Ratings = Ratings(),
    val genres: List<String> = emptyList(),
)

@Serializable
data class EpisodeInfo(
    val key: EpisodeKey,
    val title: String? = null,
    val durationSec: Int? = null,
    val stillUrl: String? = null,
)

@Serializable
data class SeasonInfo(
    val number: Int,
    val episodes: List<EpisodeInfo>,
)

/**
 * The extension's bookmark status (`favorites` collection, one document `${uid}_${kp}` per
 * title, one status per title). Serial names are the stored strings.
 */
@Serializable
enum class BookmarkStatus(val label: String) {
    @SerialName("watching") WATCHING("Смотрю"),
    @SerialName("plan_to_watch") PLAN_TO_WATCH("Буду смотреть"),
    @SerialName("favorite") FAVORITE("Любимое"),
    @SerialName("watched") WATCHED("Просмотрено");

    val storedValue: String get() = when (this) {
        WATCHING -> "watching"
        PLAN_TO_WATCH -> "plan_to_watch"
        FAVORITE -> "favorite"
        WATCHED -> "watched"
    }

    companion object {
        fun fromStored(value: String?): BookmarkStatus? = entries.firstOrNull { it.storedValue == value }
    }
}

@Serializable
data class TitleDetails(
    val summary: TitleSummary,
    val description: String? = null,
    val countries: List<String> = emptyList(),
    val durationMinutes: Int? = null,
    /** «12+», «18+», as Kinopoisk gives it. */
    val ageRating: String? = null,
    /** Empty for films; for series as much as the catalogue knows (sources may know more). */
    val seasons: List<SeasonInfo> = emptyList(),
    /** Null when the title has no bookmark or the user is a guest. */
    val bookmark: BookmarkStatus? = null,
)

/** An item of the «Продолжить» row. */
@Serializable
data class ContinueItem(
    val summary: TitleSummary,
    val position: PlaybackPosition,
)
