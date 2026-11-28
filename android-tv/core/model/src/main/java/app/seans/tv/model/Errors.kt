package app.seans.tv.model

/**
 * Errors that cross module boundaries. The UI maps [code] to a Russian message;
 * [cause] is for logs only and never shown or logged with tokens in it.
 */
class SeansError(
    val code: Code,
    override val message: String = code.name,
    override val cause: Throwable? = null,
) : Exception(message, cause) {
    enum class Code {
        NETWORK,
        TIMEOUT,
        NOT_FOUND,
        UNAUTHORIZED,
        QUOTA_EXHAUSTED,
        PROVIDER_BLOCKED,
        PROVIDER_CHANGED,
        STREAM_EXPIRED,
        UNSUPPORTED,
        UNKNOWN,
    }
}
