package app.seans.tv.sources.seasonvar

import app.seans.tv.model.SubtitleTrack
import app.seans.tv.sources.internal.SourcesJson
import app.seans.tv.sources.internal.normalizeWords
import java.util.Base64
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.jsoup.Jsoup

internal data class SvSearchResult(val url: String, val title: String, val originalTitle: String)
internal data class SvSeason(val number: Int, val url: String, val episodesCount: Int)
internal data class SvTranslation(val id: String, val name: String, val popularity: Double, val url: String, val active: Boolean)
internal data class SvEpisode(val title: String, val url: String, val subtitle: String?, val rawTitle: String?)

/**
 * Pure port of the extension's `SeasonvarParser.js` parsing: search cards, season tabs, the
 * translation list with its `pl[...]` playlist map, the `#2` link obfuscation and the
 * playlist folders. Network and caching live in [SeasonvarProvider].
 */
internal object SeasonvarParser {
    const val BASE_URL = "https://seasonvar.ru"

    fun absolute(href: String, base: String = BASE_URL): String = when {
        href.startsWith("http://") || href.startsWith("https://") -> href
        href.startsWith("//") -> "https:$href"
        href.startsWith("/") -> base + href
        else -> "$base/$href"
    }

    // ─── Search ───────────────────────────────────────────────────────

    fun parseSearchResults(html: String, base: String = BASE_URL): List<SvSearchResult> =
        Jsoup.parse(html).select(".pgs-search-wrap").mapNotNull { item ->
            val href = item.selectFirst("a")?.attr("href")?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val info = item.selectFirst(".pgs-search-info")
            val anchors = info?.select("a").orEmpty()
            val title = if (info != null) anchors.getOrNull(0)?.text()?.trim().orEmpty() else item.selectFirst("a")!!.text().trim()
            SvSearchResult(url = absolute(href, base), title = title, originalTitle = anchors.getOrNull(1)?.text()?.trim().orEmpty())
        }

    /** 1000 exact, 900 whole words at the start, 800 whole words elsewhere, 0 when a word is missing. */
    fun titleScore(found: String?, target: String?): Int {
        val f = normalizeWords(found)
        val t = normalizeWords(target)
        if (f.isEmpty() || t.isEmpty()) return 0
        if (f == t) return 1000
        val foundWords = f.split(' ')
        val targetWords = t.split(' ')
        if (!targetWords.all { it in foundWords }) return 0
        // Whole-word matches stay valid when the provider adds a franchise prefix («Джек Ричер» for «Ричер»).
        if (foundWords.take(targetWords.size).joinToString(" ") == t) return 900
        return 800
    }

    fun selectBest(results: List<SvSearchResult>, title: String, altName: String?, year: Int?): SvSearchResult? {
        val targets = listOfNotNull(title, altName).filter { it.isNotBlank() }
        return results.mapIndexedNotNull { index, result ->
            val score = targets.maxOfOrNull { maxOf(titleScore(result.title, it), titleScore(result.originalTitle, it)) } ?: 0
            if (score > 0) Triple(result, score, index) else null
        }.sortedWith(compareByDescending<Triple<SvSearchResult, Int, Int>> { it.second }.thenBy { it.third })
            .firstOrNull()?.first
        // Seasonvar cards carry no year, so the extension's year term is always 0 here.
    }

    // ─── Series page ──────────────────────────────────────────────────

    /** The season tabs of a series page, sorted. Empty for a single-season page without tabs. */
    fun parseSeasons(html: String, base: String = BASE_URL): List<SvSeason> {
        val tabs = Jsoup.parse(html).selectFirst(".tabs-result") ?: return emptyList()
        return tabs.select("h2 a").mapNotNull { link ->
            val href = link.attr("href").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val number = Regex("""(\d+)\s*(?:сезон|season)""", RegexOption.IGNORE_CASE).find(link.text())
                ?.groupValues?.get(1)?.toIntOrNull() ?: return@mapNotNull null
            val count = link.selectFirst("span")?.text()?.let {
                Regex("""(\d+)\s*(?:сери|seri)""", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1)?.toIntOrNull()
            } ?: 0
            SvSeason(number, absolute(href, base), count)
        }.distinctBy { it.number }.sortedBy { it.number }
    }

    /** «… 5 сезон» from the page title, for a page that has no season tabs. */
    fun pageSeasonNumber(html: String): Int? {
        val doc = Jsoup.parse(html)
        val text = (doc.selectFirst("h1")?.text().orEmpty() + " " + doc.title())
        return Regex("""(\d+)\s*(?:сезон|season)""", RegexOption.IGNORE_CASE).find(text)?.groupValues?.get(1)?.toIntOrNull()
    }

    /**
     * Translations of a season page, trailers dropped, exactly one marked active (the page's
     * `act` item, else the most popular). Throws when the page has no playlist at all.
     */
    fun parseTranslations(html: String, base: String = BASE_URL): List<SvTranslation> {
        val playlists = linkedMapOf<String, String>()
        Regex("""var\s+pl\s*=\s*(\{[\s\S]*?\}|['"][^'"]+['"])""").find(html)?.groupValues?.get(1)?.trim()?.let { init ->
            if (init.startsWith("{")) {
                Regex("""['"]?(\d+)['"]?\s*:\s*['"]([^'"]+)['"]""").findAll(init).forEach { playlists[it.groupValues[1]] = it.groupValues[2] }
            } else {
                playlists["0"] = init.trim('\'', '"')
            }
        }
        Regex("""pl\[['"]?(\d+)['"]?]\s*=\s*['"]([^"']+)['"]""").findAll(html).forEach { playlists[it.groupValues[1]] = it.groupValues[2] }

        val translations = mutableListOf<SvTranslation>()
        Jsoup.parse(html).select(".pgs-trans li[data-translate]").forEach { li ->
            val id = li.attr("data-translate")
            val name = li.text().trim()
            val lower = name.lowercase()
            if ("трейлер" in lower || "тизер" in lower) return@forEach
            val url = playlists[id] ?: return@forEach
            translations += SvTranslation(
                id = id,
                name = name,
                popularity = li.attr("data-translate-percent").toDoubleOrNull() ?: 0.0,
                url = absolute(url, base),
                active = li.hasClass("act") || (translations.isEmpty() && id == "0"),
            )
        }
        if (translations.isEmpty()) {
            playlists.entries.forEachIndexed { index, (id, url) ->
                translations += SvTranslation(
                    id = id,
                    name = if (id == "0") "Стандартный" else "Перевод $id",
                    popularity = if (id == "0") 100.0 else 0.0,
                    url = absolute(url, base),
                    active = index == 0,
                )
            }
        }
        if (translations.isEmpty()) throw IllegalStateException("No playlists found")
        val active = translations.firstOrNull { it.active } ?: translations.maxBy { it.popularity }
        return translations.map { it.copy(active = it.id == active.id) }
    }

    // ─── Playlist ─────────────────────────────────────────────────────

    /** Seasonvar's `#2` links: base64 with `//b2xvbG8=` junk spliced in. A link that does not decode is returned as given. */
    fun decodeUrl(file: String): String {
        return try {
            val clean = file.removePrefix("#2").replace("//b2xvbG8=", "")
            var decoded = String(Base64.getDecoder().decode(padBase64(clean)), Charsets.UTF_8)
            if (decoded.startsWith("//")) decoded = "https:$decoded"
            decoded
        } catch (_: IllegalArgumentException) {
            file
        }
    }

    private fun padBase64(value: String): String {
        val trimmed = value.trim().trimEnd('=')
        return trimmed + "=".repeat((4 - trimmed.length % 4) % 4)
    }

    /** Folders flattened in order; titles as the extension builds them («1 серия», «Folder - 3 серия»). */
    fun parsePlaylist(json: String): List<SvEpisode> = flatten(SourcesJson.parseToJsonElement(json) as? JsonArray ?: JsonArray(emptyList()), "")

    private fun flatten(items: JsonArray, parentTitle: String): List<SvEpisode> = items.flatMap { element ->
        val item = element as? JsonObject ?: return@flatMap emptyList()
        val folder = item["folder"] as? JsonArray
        val title = item.str("title").orEmpty()
        if (folder != null) return@flatMap flatten(folder, title)
        val file = item.str("file") ?: return@flatMap emptyList()
        var finalTitle = Regex("""^(\d+\s+серия)""").find(title)?.groupValues?.get(1) ?: title
        if (parentTitle.isNotEmpty() && !Regex("""^\d+-\d+\s+серия""").containsMatchIn(parentTitle)) {
            finalTitle = "$parentTitle - $finalTitle"
        }
        val url = toHttps(decodeUrl(file)) ?: return@flatMap emptyList()
        listOf(SvEpisode(title = finalTitle, url = url, subtitle = item.str("subtitle")?.takeIf { it.isNotBlank() }, rawTitle = title))
    }

    /** «Стандартный (LostFilm)» when the default playlist names its studio after a `<br>`. */
    fun studioOf(episodes: List<SvEpisode>): String? {
        val raw = episodes.firstOrNull()?.rawTitle ?: return null
        val studio = Regex("""<br\s*/?>\s*([^<]+)$""", RegexOption.IGNORE_CASE).find(raw)?.groupValues?.get(1)?.trim() ?: return null
        val lower = studio.lowercase()
        return studio.takeIf { it.isNotEmpty() && "серия" !in lower && "стандартный" !in lower }
    }

    /** Formats «1 серия», «3 сезон - 3 серия», «Серия 3», «3». */
    fun extractEpisodeNumber(label: String?): Int? {
        if (label.isNullOrBlank()) return null
        val patterns = listOf(
            Regex("""(?:сезон|season)\D*\d+\D+(?:серия|эпизод|серии|episode)\D*(\d+)""", RegexOption.IGNORE_CASE),
            Regex("""(?:серия|эпизод|серии|episode|ep\.?)\D*(\d+)""", RegexOption.IGNORE_CASE),
            Regex("""(\d+)\s*(?:серия|эпизод|серии|episode|ep)""", RegexOption.IGNORE_CASE),
            Regex("""^(\d+)$"""),
            Regex("""(\d+)"""),
        )
        for (pattern in patterns) {
            val value = pattern.find(if (pattern.pattern == "^(\\d+)$") label.trim() else label)?.groupValues?.get(1)?.toIntOrNull()
            if (value != null && value > 0) return value
        }
        return null
    }

    /** `[ru]https://…vtt?shift=0,[eng]https://…vtt` */
    fun parseSubtitles(value: String?): List<SubtitleTrack> {
        if (value.isNullOrBlank()) return emptyList()
        val labels = mapOf("ru" to "Русский", "rus" to "Русский", "en" to "English", "eng" to "English", "uk" to "Українська", "ukr" to "Українська")
        val languages = mapOf("rus" to "ru", "eng" to "en", "ukr" to "uk")
        return Regex("""\[([a-z0-9_-]+)](https?://[^,]+)""", RegexOption.IGNORE_CASE).findAll(value).mapNotNull {
            val code = it.groupValues[1].lowercase()
            val url = toHttps(it.groupValues[2].trim()) ?: return@mapNotNull null
            SubtitleTrack(url = url, language = languages[code] ?: code, label = labels[code] ?: code.uppercase())
        }.toList()
    }

    /**
     * The app has no cleartext permission, so an `http://` link would fail in ExoPlayer: it is
     * upgraded to `https://` (Seasonvar and its CDN `*.11cdn.org` serve HTTPS, measured
     * 2026-11-27). Anything that is not an absolute HTTP(S) link is dropped (null).
     */
    fun toHttps(url: String): String? = when {
        url.startsWith("https://") -> url
        url.startsWith("http://") -> "https://" + url.removePrefix("http://")
        else -> null
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
}
