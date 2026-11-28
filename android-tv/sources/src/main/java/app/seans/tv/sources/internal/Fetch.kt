package app.seans.tv.sources.internal

import app.seans.tv.model.SeansError
import app.seans.tv.network.SeansHttp
import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/** A provider answer, read whole. [finalUrl] is where redirects ended. */
internal class HttpResult(
    val code: Int,
    val body: String,
    val finalUrl: String,
    val contentType: String? = null,
    val server: String? = null,
) {
    val ok: Boolean get() = code in 200..299
}

/**
 * The only way providers talk to the network. Tests replace it with fixtures; the app uses
 * [OkHttpFetcher] on `SeansHttp.client` (DoH, Chrome UA, denylist).
 *
 * Headers are given per request: a provider that must send no Referer simply sets none, and
 * OkHttp adds none by itself.
 */
internal interface Fetcher {
    suspend fun get(url: String, headers: Map<String, String> = emptyMap()): HttpResult
    suspend fun postForm(url: String, form: List<Pair<String, String>>, headers: Map<String, String> = emptyMap()): HttpResult
}

internal class OkHttpFetcher(
    private val client: OkHttpClient,
    private val maxBodyBytes: Long = 4L * 1024 * 1024,
) : Fetcher {
    override suspend fun get(url: String, headers: Map<String, String>): HttpResult =
        execute(Request.Builder().url(url).apply { headers.forEach { (k, v) -> header(k, v) } }.build())

    override suspend fun postForm(url: String, form: List<Pair<String, String>>, headers: Map<String, String>): HttpResult {
        val body = FormBody.Builder().apply { form.forEach { (k, v) -> add(k, v) } }.build()
        return execute(Request.Builder().url(url).post(body).apply { headers.forEach { (k, v) -> header(k, v) } }.build())
    }

    private suspend fun execute(request: Request): HttpResult {
        // Belt and braces: SeansHttp refuses these too, but a parser must never even try.
        if (SeansHttp.isDenied(request.url.host)) throw SeansError(SeansError.Code.PROVIDER_BLOCKED, "Refused host")
        val response = try {
            client.newCall(request).await()
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw mapIo(e)
        }
        return response.use {
            val source = it.body.source()
            // A runaway page must not take the 128 MB heap with it.
            val tooLarge = try { source.request(maxBodyBytes + 1) } catch (e: IOException) { throw mapIo(e) }
            if (tooLarge) throw SeansError(SeansError.Code.PROVIDER_CHANGED, "Response too large")
            HttpResult(
                code = it.code,
                body = try { it.body.string() } catch (e: IOException) { throw mapIo(e) },
                finalUrl = it.request.url.toString(),
                contentType = it.header("Content-Type"),
                server = it.header("Server"),
            )
        }
    }

    private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { runCatching { cancel() } }
        enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                continuation.resume(response) { _, value, _ -> value.close() }
            }

            override fun onFailure(call: Call, e: IOException) {
                continuation.resumeWithException(e)
            }
        })
    }
}

internal fun mapIo(e: IOException): SeansError = when (e) {
    is SocketTimeoutException -> SeansError(SeansError.Code.TIMEOUT, cause = e)
    is InterruptedIOException -> SeansError(SeansError.Code.TIMEOUT, cause = e)
    is UnknownHostException -> SeansError(SeansError.Code.NETWORK, "DNS", cause = e)
    else -> SeansError(SeansError.Code.NETWORK, cause = e)
}

/**
 * Anti-bot interstitials (DDoS-Guard, Cloudflare). They come as 403/503, or as a 200 whose
 * body is a script page instead of the expected content. AnimeGo and Kodik sit behind
 * DDoS-Guard and normally answer 200 with real pages, so the server header alone means
 * nothing; the body decides.
 */
internal object Challenge {
    private val markers = listOf(
        "check.ddos-guard.net",
        "ddos-guard/js-challenge",
        "<title>ddos-guard</title>",
        "__ddg1_",
        "challenges.cloudflare.com",
        "cf-browser-verification",
        "cf_chl_opt",
        "<title>just a moment...</title>",
        "checking your browser before accessing",
    )

    fun isChallenge(result: HttpResult): Boolean {
        val head = result.body.take(8_000).lowercase()
        return markers.any { head.contains(it) }
    }
}

/**
 * The usual status handling: a challenge is [SeansError.Code.PROVIDER_BLOCKED]; 404/410 is
 * "no such title" (null); other failures are errors. Returns the result when it is usable.
 */
internal fun HttpResult.requireUsable(what: String): HttpResult? {
    if (Challenge.isChallenge(this)) throw SeansError(SeansError.Code.PROVIDER_BLOCKED, "$what: challenge page")
    return when {
        ok -> this
        code == 404 || code == 410 -> null
        code == 403 || code == 429 || code == 451 -> throw SeansError(SeansError.Code.PROVIDER_BLOCKED, "$what answered $code")
        code in 500..599 -> throw SeansError(SeansError.Code.NETWORK, "$what answered $code")
        else -> throw SeansError(SeansError.Code.PROVIDER_CHANGED, "$what answered $code")
    }
}

/** Anything a parser throws that is not already a [SeansError] means the markup changed. */
internal fun Throwable.toSeansError(): SeansError = when (this) {
    is SeansError -> this
    is IOException -> mapIo(this)
    else -> SeansError(SeansError.Code.PROVIDER_CHANGED, this::class.simpleName ?: "parse", cause = this)
}

/** Host only, for logs: signed URLs never reach a log line. */
internal fun hostOf(url: String): String = runCatching { java.net.URI(url).host }.getOrNull() ?: "?"
