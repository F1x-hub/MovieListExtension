package app.seans.tv.sources.collaps

import app.seans.tv.model.SubtitleTrack
import app.seans.tv.sources.internal.SourcesJson
import app.seans.tv.sources.internal.balancedAt
import app.seans.tv.sources.internal.literalAfterKey
import app.seans.tv.sources.internal.normalizeWords
import app.seans.tv.sources.internal.stringAfterKey
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * What one Collaps (Venom balancer) embed page offers, read from its `makePlayer({...})`
 * call as text (the page is never run).
 *
 * - A film: `source: { hls, dash, dasha, audio: {names, order}, cc: [{url, name}] }`.
 * - A series: `playlist: { seasons: [{season, blocked, episodes: [{episode: "1", hls, dash,
 *   dasha, audio, cc, duration, title}]}] }`; seasons come unordered, `episode` is a string.
 *
 * `hls` is an H.264/AAC master playlist (measured on 2026-11-27: up to 720p), `dash` a VP9/Opus
 * WebM MPD (up to 1080p), `dasha` the AV1 variant. Voices are audio renditions of one
 * manifest, in `names` order: HLS `NAME="rus0".."eng6"`, DASH `lang="ru0".."ru6"`.
 */
internal data class CollapsMedia(
    val hls: String?,
    val dash: String?,
    val dashAv1: String?,
    /** Voice names by rendition index. */
    val voices: List<String>,
    /** Rendition indexes in the balancer's display order. */
    val voiceOrder: List<Int>,
    val subtitles: List<SubtitleTrack>,
    val durationSec: Int? = null,
) {
    val playable: Boolean get() = hls != null || dash != null

    /**
     * A stable key per rendition index: the normalized voice name («рус дублированный»), with
     * `#2`, `#3`… for repeated names and `track<n>` for a nameless one. The same voice keeps its
     * key across episodes although its index there differs.
     */
    fun voiceKeys(): List<String> {
        val seen = HashMap<String, Int>()
        return voices.mapIndexed { index, name ->
            val base = normalizeWords(name).ifEmpty { "track${index + 1}" }
            val n = (seen[base] ?: 0) + 1
            seen[base] = n
            if (n == 1) base else "$base#$n"
        }
    }
}

internal data class CollapsEpisode(val season: Int, val episode: Int, val media: CollapsMedia)

internal data class CollapsPage(
    val film: CollapsMedia?,
    val episodes: List<CollapsEpisode>,
    val blocked: Boolean,
) {
    val isSeries: Boolean get() = episodes.isNotEmpty()

    companion object {
        /** Null when the page has no player call at all (markup changed or an error page). */
        fun parse(html: String): CollapsPage? {
            val call = html.lastIndexOf("makePlayer({")
            if (call < 0) return null
            val args = balancedAt(html, call + "makePlayer(".length) ?: return null
            val blocked = Regex("""(?<![\w$])blocked\s*:\s*true""").containsMatchIn(args.take(400))

            val seasonsLiteral = literalAfterKey(args, "seasons")
            if (seasonsLiteral != null) {
                val seasons = SourcesJson.parseToJsonElement(seasonsLiteral).jsonArray
                val episodes = seasons.flatMap { seasonElement ->
                    val season = seasonElement.jsonObject
                    val number = season.int("season") ?: return@flatMap emptyList()
                    if (season["blocked"]?.jsonPrimitive?.booleanOrNull == true) return@flatMap emptyList()
                    (season["episodes"] as? JsonArray).orEmpty().mapNotNull { episodeElement ->
                        val episode = episodeElement as? JsonObject ?: return@mapNotNull null
                        val episodeNumber = episode.str("episode")?.let { leadingInt(it) } ?: return@mapNotNull null
                        val media = mediaOf(episode)
                        if (number < 0 || episodeNumber < 1 || !media.playable) null
                        else CollapsEpisode(number, episodeNumber, media)
                    }
                }.distinctBy { it.season to it.episode }
                    .sortedWith(compareBy({ it.season }, { it.episode }))
                return CollapsPage(film = null, episodes = episodes, blocked = blocked)
            }

            val sourceLiteral = literalAfterKey(args, "source") ?: return CollapsPage(null, emptyList(), blocked)
            val film = filmMedia(sourceLiteral)
            return CollapsPage(film = film.takeIf { it.playable }, episodes = emptyList(), blocked = blocked)
        }

        /** The film's `source` object mixes JS keys and JSON values, so it is read key by key. */
        private fun filmMedia(source: String): CollapsMedia {
            val audio = literalAfterKey(source, "audio")?.let { runCatching { SourcesJson.parseToJsonElement(it) }.getOrNull() }
            val cc = literalAfterKey(source, "cc")?.let { runCatching { SourcesJson.parseToJsonElement(it) }.getOrNull() }
            val (voices, order) = voicesOf(audio)
            return CollapsMedia(
                hls = stringAfterKey(source, "hls")?.takeIf(::isHttps),
                dash = stringAfterKey(source, "dash")?.takeIf(::isHttps),
                dashAv1 = stringAfterKey(source, "dasha")?.takeIf(::isHttps),
                voices = voices,
                voiceOrder = order,
                subtitles = subtitlesOf(cc),
            )
        }

        private fun mediaOf(episode: JsonObject): CollapsMedia {
            val (voices, order) = voicesOf(episode["audio"])
            return CollapsMedia(
                hls = episode.str("hls")?.takeIf(::isHttps),
                dash = episode.str("dash")?.takeIf(::isHttps),
                dashAv1 = episode.str("dasha")?.takeIf(::isHttps),
                voices = voices,
                voiceOrder = order,
                subtitles = subtitlesOf(episode["cc"]),
                durationSec = episode.int("duration")?.takeIf { it > 0 },
            )
        }

        private fun voicesOf(audio: JsonElement?): Pair<List<String>, List<Int>> {
            val obj = audio as? JsonObject ?: return emptyList<String>() to emptyList()
            val names = (obj["names"] as? JsonArray).orEmpty().map { it.jsonPrimitive.contentOrNull?.trim().orEmpty() }
            val order = (obj["order"] as? JsonArray).orEmpty().mapNotNull { it.jsonPrimitive.intOrNull }
                .filter { it in names.indices }.distinct()
            val fullOrder = order + names.indices.filter { it !in order }
            return names to fullOrder
        }

        private fun subtitlesOf(cc: JsonElement?): List<SubtitleTrack> =
            (cc as? JsonArray).orEmpty().mapNotNull { element ->
                val obj = element as? JsonObject ?: return@mapNotNull null
                val url = obj.str("url")?.takeIf(::isHttps) ?: return@mapNotNull null
                val name = obj.str("name")?.trim().orEmpty()
                SubtitleTrack(url = url, language = languageOf(name), label = name.ifEmpty { "Субтитры" })
            }

        /** «Рус. полные - 2», «Eng. full - 3», «Укр. форсовані - 1». */
        fun languageOf(label: String): String {
            val lower = label.lowercase()
            return when {
                lower.startsWith("рус") || lower.startsWith("ru") -> "ru"
                lower.startsWith("укр") || lower.startsWith("ukr") || lower.startsWith("uk") -> "uk"
                lower.startsWith("eng") || lower.startsWith("en") || lower.startsWith("англ") -> "en"
                else -> "und"
            }
        }

        private fun leadingInt(value: String): Int? = Regex("""^\s*(\d{1,4})""").find(value)?.groupValues?.get(1)?.toIntOrNull()

        private fun isHttps(url: String): Boolean = url.startsWith("https://")

        private fun JsonObject.str(key: String): String? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull
        private fun JsonObject.int(key: String): Int? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.let { it.intOrNull ?: it.contentOrNull?.toIntOrNull() }
    }
}

/** The `t=` parameter of a signed balancer URL: its expiry in epoch seconds. */
internal fun signedExpiryMillis(url: String): Long? =
    Regex("""[?&]t=(\d{9,11})(?:&|$)""").find(url)?.groupValues?.get(1)?.toLongOrNull()?.times(1000)
