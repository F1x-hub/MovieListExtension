package app.seans.tv.sources.internal

import kotlinx.serialization.json.Json

internal val SourcesJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    explicitNulls = false
}

/**
 * The balanced `{...}` or `[...]` that starts at [start] (which must be `{` or `[`), with
 * quotes and escapes respected. Null when it never closes. Used to cut JSON literals out of
 * provider scripts without running them.
 */
internal fun balancedAt(text: String, start: Int): String? {
    if (start !in text.indices) return null
    val open = text[start]
    if (open != '{' && open != '[') return null
    var depth = 0
    var quote: Char? = null
    var i = start
    while (i < text.length) {
        val c = text[i]
        if (quote != null) {
            if (c == '\\') i++ else if (c == quote) quote = null
        } else when (c) {
            '"', '\'' -> quote = c
            '{', '[' -> depth++
            '}', ']' -> {
                depth--
                if (depth == 0) return text.substring(start, i + 1)
            }
        }
        i++
    }
    return null
}

/** The balanced literal that follows `key:` (a JS object key) at or after [from]. */
internal fun literalAfterKey(text: String, key: String, from: Int = 0): String? {
    val match = Regex("""(?<![\w$])$key\s*:\s*([\[{])""").find(text, from) ?: return null
    return balancedAt(text, match.groups[1]!!.range.first)
}

/** A JS string value `key: "..."` (or single-quoted) at or after [from], unescaped minimally. */
internal fun stringAfterKey(text: String, key: String, from: Int = 0, until: Int = text.length): String? {
    val region = text.substring(from.coerceAtMost(text.length), until.coerceIn(from, text.length))
    val match = Regex("""(?<![\w$])$key\s*:\s*(["'])((?:\\.|(?!\1).)*)\1""").find(region) ?: return null
    return match.groupValues[2].replace("\\/", "/").replace("\\\"", "\"").replace("\\'", "'")
}

/** Lowercase, ё→е, everything but letters and digits to single spaces. */
internal fun normalizeWords(value: String?): String =
    (value ?: "").lowercase().replace('ё', 'е').replace(Regex("[^a-zа-я0-9]+"), " ").trim()
