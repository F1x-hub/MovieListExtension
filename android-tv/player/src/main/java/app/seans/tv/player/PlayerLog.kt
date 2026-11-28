package app.seans.tv.player

/**
 * Logging for the JVM-testable session classes (`android.util.Log` throws in unit tests).
 * Never log URLs, tokens or cookies: a provider key, a host or an error code only.
 */
internal object PlayerLog {
    fun i(tag: String, message: String) {
        runCatching { android.util.Log.i(tag, message) }
    }

    fun w(tag: String, message: String) {
        runCatching { android.util.Log.w(tag, message) }
    }
}
