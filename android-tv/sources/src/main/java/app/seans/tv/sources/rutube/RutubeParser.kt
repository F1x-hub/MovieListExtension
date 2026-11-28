package app.seans.tv.sources.rutube

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

internal data class RtItem(
    val id: String,
    val title: String,
    val durationSec: Int,
    val categoryId: Int? = null,
    val categoryName: String? = null,
    val official: Boolean = false,
    val excluded: Boolean = false,
) {
    companion object {
        fun of(element: JsonElement): RtItem? {
            val obj = element as? JsonObject ?: return null
            fun str(key: String) = (obj[key] as? JsonPrimitive)?.contentOrNull
            fun flag(key: String) = (obj[key] as? JsonPrimitive)?.booleanOrNull == true
            val id = str("id")?.takeIf { Regex("^[a-z0-9_-]{8,80}$", RegexOption.IGNORE_CASE).matches(it) } ?: return null
            val category = obj["category"] as? JsonObject
            return RtItem(
                id = id,
                title = str("title").orEmpty(),
                durationSec = (obj["duration"] as? JsonPrimitive)?.let { it.intOrNull ?: it.longOrNull?.toInt() } ?: 0,
                categoryId = (category?.get("id") as? JsonPrimitive)?.intOrNull,
                categoryName = (category?.get("name") as? JsonPrimitive)?.contentOrNull,
                official = flag("is_official"),
                excluded = flag("is_deleted") || flag("is_livestream") || flag("is_audio") || flag("is_hidden"),
            )
        }
    }
}

internal data class RtTitle(val title: String?, val season: Int?, val episode: Int?, val channelName: String?)

/**
 * Pure port of `RutubeParser.js`: the query cascade, the UGC-noise filter and the scorer
 * (title overlap, year, duration, category). Rutube is user uploads; only a full-length,
 * same-year, non-noise upload may win.
 */
internal object RutubeParser {
    const val BASE_URL = "https://rutube.ru"

    fun buildSearchQueries(title: String, year: Int?): List<String> {
        if (title.isBlank()) return emptyList()
        val clean = title.replace(Regex("""[:;/\\|]"""), " ").replace(Regex("""\s+"""), " ").trim()
        val searchYear = year ?: extractYear(title)
        val queries = buildList {
            if (searchYear != null) add("$clean $searchYear")
            add("$clean фильм")
            add(clean)
        }
        val seen = HashSet<String>()
        return queries.filter { seen.add(it.lowercase()) }
    }

    private const val B = "(?:^|[^a-zа-яё0-9])"
    private const val E = "(?:$|[^a-zа-яё0-9])"
    private val GARBAGE = listOf(
        "${B}(?:обзор[а-яё]*|разбор[а-яё]*|реакци[а-яё]*|рекап[а-яё]*|recap[s]?|пересказ[а-яё]*|мнени[а-яё]*|сюжет[а-яё]*|смысл\\s+концовки|рецензи[а-яё]*|отзыв[а-яё]*|эссе|видеоэссе|разборк[а-яё]*|кинокритик[а-яё]*|впечатлени[а-яё]*|объяснени[а-яё]*)$E",
        "${B}(?:подкаст[а-яё]*|podcast[s]?|интервью|стрим[а-яё]*|stream[s]?|шоу|выпуск[а-яё]*|влог[а-яё]*|vlog[s]?|в\\s+гостях)$E",
        "${B}(?:прохожден[а-яё]*|геймпле[а-яё]*|gameplay|летспле[а-яё]*|letsplay|walkthrough|playthrough)$E",
        "${B}(?:ost|ост|саундтрек[а-яё]*|саундтрэк[а-яё]*|soundtrack[s]?|музык[а-яё]*|песн[а-яё]*|трек[а-яё]*|альбом[а-яё]*|плейлист[а-яё]*|playlist[s]?|клип[а-яё]*|clip[s]?|amv|амв|edit[s]?|эдит[а-яё]*|shorts|шортс|тикток[а-яё]*|tiktok|кавер[а-яё]*|cover[s]?|ремикс[а-яё]*|remix)$E",
        "${B}(?:трейлер[а-яё]*|trailer[s]?|промо|promo|тизер[а-яё]*|teaser[s]?|анонс[а-яё]*|нарезк[а-яё]*|фрагмент[а-яё]*|отрывок|отрывк[а-яё]*|сцен[а-яё]*|вырезанны[а-яё]*\\s+сцен[а-яё]*|топ\\s*\\d+|топ-\\d+|пасхалк[а-яё]*|факт[а-яё]*|секрет[а-яё]*|лучши[а-яё]*\\s+момент[а-яё]*|блуперс[а-яё]*|неудачны[а-яё]*\\s+дубл[а-яё]*)$E",
    ).map { Regex(it, RegexOption.IGNORE_CASE) }

    /** Reviews, reactions, streams, music, trailers, tops… unless the query itself has that word. */
    fun isUgcGarbage(title: String?, query: String = ""): Boolean {
        if (title.isNullOrEmpty()) return true
        val lower = title.lowercase()
        val queryLower = query.lowercase()
        return GARBAGE.any { regex ->
            val match = regex.find(lower) ?: return@any false
            val word = match.value.replace(Regex("[^a-zа-яё0-9]", RegexOption.IGNORE_CASE), "").trim().lowercase()
            !(word.isNotEmpty() && queryLower.contains(word))
        }
    }

    private val STOP_WORDS = setOf("в", "на", "и", "с", "по", "о", "об", "из", "к", "от", "до", "для", "за", "под", "не",
        "the", "a", "an", "of", "in", "on", "at", "to", "for", "with", "by")

    fun tokenize(value: String): List<String> =
        value.lowercase().replace(Regex("[^a-zа-яё0-9]", RegexOption.IGNORE_CASE), " ").split(Regex("\\s+"))
            .filter { it.isNotEmpty() && it !in STOP_WORDS }

    private fun normalize(value: String): String = value.lowercase().replace(Regex("[^a-zа-яё0-9]", RegexOption.IGNORE_CASE), "").trim()

    fun extractYear(value: String?): Int? = Regex("""\b(19|20)\d{2}\b""").find(value ?: "")?.value?.toIntOrNull()

    fun score(item: RtItem, query: String, year: Int?): Int {
        val itemTitle = item.title.trim()
        if (itemTitle.isEmpty()) return -1000
        if (isUgcGarbage(itemTitle)) return -500

        var score = 0
        val target = query.trim().lowercase()
        val candidate = itemTitle.lowercase()
        val targetTokens = tokenize(target)
        val candidateTokens = tokenize(candidate)
        if (targetTokens.isEmpty()) return -1000

        val cleanTarget = normalize(target)
        val cleanCandidate = normalize(candidate)
        if (cleanCandidate == cleanTarget) {
            score += 150
        } else if (cleanCandidate.startsWith(cleanTarget)) {
            score += 100
        } else {
            val matched = targetTokens.count { it in candidateTokens }
            val ratio = matched.toDouble() / targetTokens.size
            score += when {
                ratio == 1.0 -> 80
                ratio >= 0.66 -> 40
                ratio > 0 -> 15
                else -> return -300
            }
            val extraWords = maxOf(0, candidateTokens.size - targetTokens.size)
            if (extraWords > 5) score -= minOf(60, (extraWords - 5) * 5)
        }

        val targetYear = year ?: extractYear(query)
        val candidateYear = extractYear(itemTitle)
        if (targetYear != null) {
            if (candidateYear == targetYear) score += 60
            else if (candidateYear != null && kotlin.math.abs(candidateYear - targetYear) > 1) score -= 50
        }

        val duration = item.durationSec
        score += when {
            duration in 3000..14400 -> 100
            duration in 1200 until 3000 -> 60
            duration in 600 until 1200 -> 10
            duration in 1 until 600 -> -120
            duration > 14400 -> -40
            else -> 0
        }
        if (item.categoryId == 4 || item.categoryName?.lowercase()?.contains("фильм") == true) score += 25
        if (item.official) score += 15
        return score
    }

    /**
     * The best non-excluded candidate with a positive score. The year gate of the extension's
     * `verifySearchResult` applies to films: an upload whose title names a year more than one
     * off is another film (a remake) and is dropped, whatever its score.
     */
    fun pickBest(items: Collection<RtItem>, query: String, year: Int?, film: Boolean = true): Pair<RtItem, Int>? =
        items.asSequence()
            .filter { !it.excluded }
            .filter { item ->
                val found = extractYear(item.title)
                !(film && year != null && found != null && kotlin.math.abs(found - year) > 1)
            }
            .map { it to score(it, query, year) }
            .maxByOrNull { it.second }

    fun parsePageTitle(pageTitle: String?): RtTitle {
        if (pageTitle.isNullOrEmpty()) return RtTitle(null, null, null, null)
        var title = pageTitle
            .replace(Regex("""\s*—\s*смотреть.*$""", RegexOption.IGNORE_CASE), "").trim()
            .replace(Regex("""\s*,?\s*бесплатно\s+опубликованн.*$""", RegexOption.IGNORE_CASE), "").trim()
            .replace(Regex("""\s*в хорошем качестве.*$""", RegexOption.IGNORE_CASE), "").trim()
        var channel: String? = null
        Regex("""\[([^\]]+)]""").find(title)?.let {
            channel = it.groupValues[1].trim()
            title = title.replace(Regex("""\s*\[[^\]]+]\s*"""), " ").trim()
        }
        if (channel == null && Regex("""[«"]([^»"]+)[»"]""").containsMatchIn(title)) {
            channel = Regex("""от\s*[«"]([^»"]+)[»"]""", RegexOption.IGNORE_CASE).find(pageTitle)?.groupValues?.get(1)?.trim()
        }
        val season = Regex("""(\d+)\s*сезон""", RegexOption.IGNORE_CASE).find(title)?.groupValues?.get(1)?.toIntOrNull()
        val episode = Regex("""(\d+)\s*серия""", RegexOption.IGNORE_CASE).find(title)?.groupValues?.get(1)?.toIntOrNull()
        var clean = title
            .replace(Regex("""\d+\s*сезон\s*[-–]?\s*\d*\s*серия""", RegexOption.IGNORE_CASE), "").trim()
            .replace(Regex("""\d+\s*сезон""", RegexOption.IGNORE_CASE), "").trim()
            .replace(Regex("""\d+\s*серия""", RegexOption.IGNORE_CASE), "").trim()
        val slash = clean.indexOf(" / ")
        if (slash > 0) clean = clean.substring(0, slash).trim()
        clean = clean.replace(Regex("""^\s*[-–:]\s*"""), "").replace(Regex("""\s*[-–:]\s*$"""), "").trim()
            .replace(Regex("""\s{2,}"""), " ").trim()
        return RtTitle(clean.ifEmpty { null }, season, episode, channel)
    }

    /** `video_balancer.m3u8`, then `.default`, then `balancer.m3u8`, then a bare string. */
    fun m3u8Of(options: JsonObject): String? {
        fun JsonElement?.field(key: String) = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.contentOrNull
        val balancer = options["video_balancer"]
        return balancer.field("m3u8")
            ?: balancer.field("default")
            ?: options["balancer"].field("m3u8")
            ?: (balancer as? JsonPrimitive)?.contentOrNull
    }
}
