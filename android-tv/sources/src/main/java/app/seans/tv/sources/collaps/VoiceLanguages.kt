package app.seans.tv.sources.collaps

/**
 * The balancer names a title's audio renditions by position (`audio.names`), and for some
 * films that list belongs to another release. «Мстители» (KP 263531) carries «Рус.
 * Дублированный, Укр. Дубльований, Ю. Сербин, Eng.Original» over renditions that are English,
 * English, the Russian dub and Russian, so «Рус. Дублированный» played English (heard in the
 * extension on 2026-11-28). The HLS master tags every rendition with its language
 * (`NAME="rus2",LANGUAGE="ru"`), and on other films the tags agree with the names; DASH `lang`
 * values are positional (`ru0`…) and say nothing. The extension does the same in
 * `content-scripts/provider-ad-guard.js` (`alignAudioNamesWithTracks`).
 */
internal object VoiceLanguages {
    private val NAME_LANGUAGES = listOf(
        "ru" to Regex("""^(?:рус|rus)|\(рус""", RegexOption.IGNORE_CASE),
        "uk" to Regex("""^(?:укр|ukr)|\(укр|дубльован""", RegexOption.IGNORE_CASE),
        "en" to Regex("""^(?:eng|англ)|english""", RegexOption.IGNORE_CASE),
    )
    private val TAG_LANGUAGES = mapOf("rus" to "ru", "ukr" to "uk", "eng" to "en")

    /** The language a voice name states, or null for a studio or an author («Ю. Сербин»). */
    fun nameLanguage(name: String): String? =
        NAME_LANGUAGES.firstOrNull { (_, pattern) -> pattern.containsMatchIn(name.trim()) }?.first

    /** Languages of the first audio group, in rendition order, from an HLS master playlist. */
    fun trackLanguages(master: String): List<String?> {
        val tracks = master.lineSequence().map { it.trim() }
            .filter { it.startsWith("#EXT-X-MEDIA:") && it.contains("TYPE=AUDIO") }.toList()
        val group = tracks.firstOrNull()?.let(::groupOf)
        return tracks.filter { groupOf(it) == group }.map { line ->
            val language = Regex("""LANGUAGE="([a-zA-Z]{2,3})""").find(line)?.groupValues?.get(1)?.lowercase()
            if (language != null) TAG_LANGUAGES[language] ?: language
            else Regex("""NAME="([a-zA-Z]{3})""").find(line)?.groupValues?.get(1)?.lowercase()?.let { TAG_LANGUAGES[it] }
        }
    }

    private fun groupOf(line: String): String? = Regex("""GROUP-ID="([^"]*)"""").find(line)?.groupValues?.get(1)

    /**
     * Names placed on the renditions of their language, or null when the names fit already.
     * One stray tag proves nothing: only two or more conflicts, with at least two tagged
     * languages, count as a list from another release. A rendition left without a name is
     * «Дорожка N (en)»; a name with no rendition of its language is dropped.
     */
    fun namesForTracks(names: List<String>, languages: List<String?>): List<String>? {
        if (names.size != languages.size || languages.filterNotNull().toSet().size < 2) return null
        val spoken = names.map(::nameLanguage)
        val conflicts = spoken.indices.count { spoken[it] != null && languages[it] != null && spoken[it] != languages[it] }
        if (conflicts < 2) return null
        val placed = arrayOfNulls<String>(names.size)
        fun place(name: String, language: String) {
            val index = languages.indices.firstOrNull { languages[it] == language && placed[it] == null } ?: return
            placed[index] = name
        }
        names.forEachIndexed { index, name -> spoken[index]?.let { place(name, it) } }
        // A name without a language marker is a voiceover author: Russian in this catalogue.
        names.forEachIndexed { index, name -> if (spoken[index] == null && name.isNotEmpty() && name != "delete") place(name, "ru") }
        return placed.mapIndexed { index, name -> name ?: "Дорожка ${index + 1} (${languages[index] ?: "?"})" }
    }
}
