package app.seans.tv.sources.animego

import org.jsoup.Jsoup
import org.jsoup.nodes.Document

internal data class AgCard(
    val title: String,
    val originalTitle: String,
    val href: String,
    val animeId: String,
    val year: Int?,
    val kind: String?,
)

internal data class AgResult(
    val title: String,
    val originalTitle: String?,
    val url: String,
    val animeId: String,
    val year: Int?,
    val kind: String?,
    /** The AnimeGo title of a later season, when one was found for it. */
    val seasonNumber: Int? = null,
) {
    val isSeries: Boolean? get() = kind?.let { it != "Фильм" }
}

internal data class AgEpisode(val id: String, val number: Int, val filler: Boolean)
internal data class AgPlayer(val url: String, val translationId: String?, val translation: String?, val provider: String?)
internal data class AgPlayerContent(val episodes: List<AgEpisode>, val players: List<AgPlayer>, val pageCount: Int)

/**
 * Pure port of the extension's `AnimeGoParser.js` matching and markup reading: catalog
 * cards, the title scorer (exact, containment with a year, Russian stems), later-season
 * titles and the player markup (episodes and embeds).
 */
internal object AnimeGoParser {
    const val BASE_URL = "https://animego.me"
    private const val MIN_MATCH_SCORE = 70
    private const val MIN_CONTAINMENT_RATIO = 0.8
    private const val STEM_MATCH_SCORE = 90
    private val RU_ENDING = Regex("(ыми|ими|ого|его|ому|ему|ые|ие|ое|ее|ая|яя|ый|ий|ой|ую|юю|ия|ья|ье|ов|ев|ам|ям|ах|ях|ом|ем|а|я|о|е|ы|и|у|ю|ь)$")
    private val TITLE_QUALIFIER = Regex("""\((?:tv|тв|ova|ona|movie|фильм|сериал)[^)]*\)""", RegexOption.IGNORE_CASE)
    private val ROMAN = listOf("", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x")
    private val RU_ORDINALS = mapOf(2 to "втор", 3 to "трет", 4 to "четв", 5 to "пят", 6 to "шест", 7 to "седьм", 8 to "восьм", 9 to "девят", 10 to "десят")
    val FRAME_HOSTS = listOf("kodikplayer.com", "video.sibnet.ru")

    fun extractAnimeId(value: String?): String? =
        Regex("""/anime/[^/?#]*?-(\d+)(?:[/?#]|$)""").find(value ?: "")?.groupValues?.get(1)

    /** Full title first, then each part of a «Name: Other name» title. Hyphenated words stay whole. */
    fun buildTitleVariants(title: String): List<String> {
        val full = title.trim()
        val parts = full.split(Regex("""\s*[:|]\s+|\s+[—–-]\s+""")).map { it.trim() }.filter { normalizeTitle(it).length >= 3 }
        return (listOf(full) + if (parts.size > 1) parts else emptyList()).filter { it.isNotEmpty() }.distinct()
    }

    fun normalizeTitle(value: String?): String =
        (value ?: "").lowercase().replace(TITLE_QUALIFIER, " ").replace('ё', 'е').replace(Regex("[^a-zа-я0-9]+"), "")

    fun titleStems(value: String?): String =
        (value ?: "").lowercase().replace(TITLE_QUALIFIER, " ").replace('ё', 'е')
            .split(Regex("[^a-zа-я0-9]+")).filter { it.isNotEmpty() }
            .joinToString(" ") { if (it.length > 4) it.replace(RU_ENDING, "") else it }

    /**
     * Exact title matches win; a near-identical containment needs a matching year. Short
     * prefixes («Наруто» in «Наруто: Ураганные хроники») are other titles, and a year more
     * than one off is a remake.
     */
    fun scoreCandidate(normalizedTarget: String, titles: List<String?>, targetYear: Int?, cardYear: Int?, rawTarget: String? = null): Int {
        var titleScore = 0
        val targetStems = rawTarget?.let(::titleStems).orEmpty()
        for (title in titles) {
            val candidate = normalizeTitle(title)
            if (candidate.isEmpty()) continue
            if (candidate == normalizedTarget) {
                titleScore = maxOf(titleScore, 100)
                continue
            }
            val contained = candidate.contains(normalizedTarget) || normalizedTarget.contains(candidate)
            val ratio = minOf(candidate.length, normalizedTarget.length).toDouble() / maxOf(candidate.length, normalizedTarget.length)
            if (contained && ratio >= MIN_CONTAINMENT_RATIO) titleScore = maxOf(titleScore, 40)
            if (targetStems.length >= 5 && titleStems(title) == targetStems) titleScore = maxOf(titleScore, STEM_MATCH_SCORE)
        }
        if (titleScore == 0) return 0
        if (targetYear == null || cardYear == null) return titleScore
        return when (kotlin.math.abs(targetYear - cardYear)) {
            0 -> titleScore + 30
            1 -> titleScore + 10
            else -> titleScore - 40
        }
    }

    fun parseSearchCards(html: String): List<AgCard> = Jsoup.parse(html).select(".ani-grid__item").mapNotNull { card ->
        val link = card.selectFirst(".ani-grid__item-title a[href]") ?: return@mapNotNull null
        val href = link.attr("href")
        val animeId = extractAnimeId(href) ?: return@mapNotNull null
        val labels = card.select(".ani-grid__item-genres__link").map { it.text().trim() }
        AgCard(
            title = link.attr("title").ifBlank { link.text() }.trim(),
            originalTitle = card.selectFirst(".ani-grid__item-body > .fw-lighter")?.text()?.trim().orEmpty(),
            href = href,
            animeId = animeId,
            year = labels.firstOrNull { Regex("^(19|20)\\d{2}$").matches(it) }?.toIntOrNull(),
            kind = labels.firstOrNull { !Regex("^\\d+$").matches(it) },
        )
    }

    fun bestResult(cards: List<AgCard>, targetTitle: String, targetYear: Int?): AgResult? {
        val target = normalizeTitle(targetTitle)
        if (target.isEmpty()) return null
        var best: Pair<Int, AgCard>? = null
        for (card in cards) {
            val score = scoreCandidate(target, listOf(card.title, card.originalTitle), targetYear, card.year, targetTitle)
            if (score < MIN_MATCH_SCORE || (best != null && score <= best.first)) continue
            best = score to card
        }
        return best?.second?.toResult()
    }

    private fun AgCard.toResult(seasonNumber: Int? = null) = AgResult(
        title = title,
        originalTitle = originalTitle.ifBlank { null },
        url = absolute(href),
        animeId = animeId,
        year = year,
        kind = kind,
        seasonNumber = seasonNumber,
    )

    fun absolute(href: String): String = when {
        href.startsWith("http") -> href
        href.startsWith("//") -> "https:$href"
        else -> BASE_URL + (if (href.startsWith("/")) href else "/$href")
    }

    /** «2», «II», «Season 2», «2nd Season», «2 сезон», «сезон 2», «второй сезон» after the base title. */
    fun seasonMarker(season: Int): Regex {
        val suffix = when {
            season % 10 == 2 && season % 100 != 12 -> "nd"
            season % 10 == 3 && season % 100 != 13 -> "rd"
            else -> "th"
        }
        val alternatives = mutableListOf(
            "$season(?!\\d)",
            "season\\s*$season(?!\\d)",
            "$season$suffix\\s+season",
            "$season\\s*сезон",
            "сезон\\s*$season(?!\\d)",
        )
        ROMAN.getOrNull(season)?.takeIf { it.isNotEmpty() }?.let { alternatives += "$it(?![a-z])" }
        RU_ORDINALS[season]?.let { alternatives += "$it[а-я]*\\s+сезон" }
        return Regex("^\\s*[:\\-–—.,]?\\s*(?:${alternatives.joinToString("|")})", RegexOption.IGNORE_CASE)
    }

    /** The card of a later season of [base], or null. [seasonYear] enables subtitle-named seasons. */
    fun findSeasonResult(cards: List<AgCard>, base: AgResult, season: Int, seasonYear: Int? = null): AgResult? {
        val marker = seasonMarker(season)
        fun low(value: String?) = (value ?: "").lowercase().replace('ё', 'е')
        val matches = cards.filter { card ->
            if (card.animeId == base.animeId) return@filter false
            if (base.year != null && card.year != null && card.year < base.year) return@filter false
            listOf(card.title to base.title, card.originalTitle to base.originalTitle).any { (candidate, prefix) ->
                val text = low(candidate)
                val p = low(prefix).trim()
                p.isNotEmpty() && text.startsWith(p) && marker.containsMatchIn(text.substring(p.length))
            }
        }.sortedBy { it.year ?: 0 }
        val card = matches.firstOrNull() ?: findSubtitledSeasonCard(cards, base, seasonYear) ?: return null
        return card.toResult(seasonNumber = season)
    }

    private fun findSubtitledSeasonCard(cards: List<AgCard>, base: AgResult, seasonYear: Int?): AgCard? {
        if (seasonYear == null) return null
        val prefix = base.title.lowercase().replace('ё', 'е').trim()
        fun seriesKind(kind: String?) = kind == null || Regex("^(сериал|ona|tv|тв)$", RegexOption.IGNORE_CASE).matches(kind.trim())
        return cards.filter { card ->
            val title = card.title.lowercase().replace('ё', 'е')
            card.animeId != base.animeId && card.year == seasonYear &&
                title.startsWith(prefix) && Regex("""^\s*[:.]\s*\S""").containsMatchIn(title.substring(prefix.length))
        }.sortedWith(compareByDescending<AgCard> { seriesKind(it.kind) }.thenBy { it.title.length }).firstOrNull()
    }

    /** Episodes and embeds of AnimeGo player markup (`data.content` of a player JSON answer). */
    fun parsePlayerContent(content: String, total: Int? = null, pageSize: Int? = null): AgPlayerContent {
        val doc = Jsoup.parseBodyFragment(content)
        val episodes = doc.select("[data-episode][data-episode-number]").mapNotNull { node ->
            val id = node.attr("data-episode").trim()
            val number = node.attr("data-episode-number").trim().toIntOrNull()
            if (!Regex("^\\d+$").matches(id) || number == null) null
            else AgEpisode(id, number, node.attr("data-episode-type") == "3")
        }
        val kodik = mutableListOf<AgPlayer>()
        val others = mutableListOf<AgPlayer>()
        doc.select("[data-player]").forEach { node ->
            val url = toProviderFrameUrl(node.attr("data-player")) ?: return@forEach
            val player = AgPlayer(
                url = url,
                translationId = node.attr("data-translation-id").ifBlank { null },
                translation = node.attr("data-translation-title").trim().ifBlank { null },
                provider = node.attr("data-provider-title").trim().ifBlank { null },
            )
            (if (isKodikUrl(url)) kodik else others) += player
        }
        val players = (kodik + others).distinctBy { it.url }
        return AgPlayerContent(episodes, players, pageCount(doc, total, pageSize))
    }

    private fun pageCount(doc: Document, total: Int?, pageSize: Int?): Int {
        if (total != null && pageSize != null && pageSize > 0) return (total + pageSize - 1) / pageSize
        val holder = doc.selectFirst("[data-anime-player-episodes-total-value]") ?: return 1
        val t = holder.attr("data-anime-player-episodes-total-value").toIntOrNull()
        val size = holder.attr("data-anime-player-episodes-page-size-value").toIntOrNull()
        return if (t != null && size != null && size > 0) (t + size - 1) / size else 1
    }

    /** Known embed hosts only, as HTTPS. (The extension's `movieExtensionSite` marker is not needed natively.) */
    fun toProviderFrameUrl(raw: String?): String? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null
        val withScheme = if (value.startsWith("//")) "https:$value" else value
        if (!withScheme.startsWith("https://") && !withScheme.startsWith("http://")) return null
        val url = runCatching { java.net.URI(withScheme) }.getOrNull() ?: return null
        val host = url.host?.lowercase() ?: return null
        if (FRAME_HOSTS.none { host == it || host.endsWith(".$it") }) return null
        return "https://" + withScheme.substringAfter("://")
    }

    fun isKodikUrl(url: String): Boolean {
        val host = runCatching { java.net.URI(url).host?.lowercase() }.getOrNull() ?: return false
        return host == "kodikplayer.com" || host.endsWith(".kodikplayer.com")
    }
}
