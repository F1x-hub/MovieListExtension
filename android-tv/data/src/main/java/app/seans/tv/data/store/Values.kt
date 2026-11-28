package app.seans.tv.data.store

import java.time.Instant

/**
 * Lenient readers for Firestore maps and JSON written by different extension versions: a
 * number may be a Long, a Double or a numeric string; a genre may be `"драма"` or
 * `{ name: "драма" }`. A bad value reads as null, never throws.
 */
internal object Values {
    fun long(value: Any?): Long? = when (value) {
        is Long -> value
        is Int -> value.toLong()
        is Double -> if (value.isFinite()) value.toLong() else null
        is Float -> if (value.isFinite()) value.toLong() else null
        is Number -> value.toLong()
        is String -> value.trim().toLongOrNull() ?: value.trim().toDoubleOrNull()?.takeIf { it.isFinite() }?.toLong()
        else -> null
    }

    fun int(value: Any?): Int? = long(value)?.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()

    fun double(value: Any?): Double? = when (value) {
        is Number -> value.toDouble().takeIf { it.isFinite() }
        is String -> value.trim().toDoubleOrNull()?.takeIf { it.isFinite() }
        else -> null
    }

    /** A rating shown on a badge: null for 0 or missing (the extension writes 0 for «no rating»). */
    fun rating(value: Any?): Double? = double(value)?.takeIf { it > 0.0 }

    fun string(value: Any?): String? = (value as? String)?.trim()?.takeIf { it.isNotEmpty() }

    fun bool(value: Any?): Boolean? = value as? Boolean

    @Suppress("UNCHECKED_CAST")
    fun map(value: Any?): Map<String, Any?>? = value as? Map<String, Any?>

    fun list(value: Any?): List<Any?> = value as? List<Any?> ?: emptyList()

    /** `["драма"]` or `[{ name: "драма" }]` → `["драма"]`. */
    fun names(value: Any?): List<String> = list(value).mapNotNull { item ->
        string(item) ?: string(map(item)?.get("name"))
    }

    /** Epoch millis from millis, a Firestore timestamp already converted to millis, or an ISO string. */
    fun millis(value: Any?): Long? = when (value) {
        is Number -> value.toLong()
        is String -> runCatching { Instant.parse(value.trim()).toEpochMilli() }.getOrNull()
        else -> map(value)?.let { m ->
            long(m["seconds"] ?: m["_seconds"])?.let { s -> s * 1000 + (long(m["nanoseconds"] ?: m["_nanoseconds"]) ?: 0) / 1_000_000 }
        }
    }
}
